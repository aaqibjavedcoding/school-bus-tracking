import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { AssistedSessionService } from './assisted-session.service';
import { AUDIT_ACTIONS, AUDIT_CONTEXT_ASSISTED_MANAGEMENT, AUDIT_ENTITY_TYPES } from '../../audit';
import type { ManagedSchoolContext } from './admin-manage.constants';

const SCHOOL: ManagedSchoolContext = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ABC School',
  code: 'ABC',
  is_active: true,
};
const ACTOR = { userId: '22222222-2222-4222-8222-222222222222' };

/** In-memory AssistedManagementSession repository. */
function sessionsStub() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    async create(attributes: Record<string, unknown>) {
      const row = { id: `session-${rows.length + 1}`, ...attributes };
      rows.push(row);
      return row;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find(
        (row) =>
          row.school_id === where.school_id &&
          row.actor_user_id === where.actor_user_id &&
          (where.ended_at === null ? row.ended_at === null : row.ended_at === where.ended_at),
      ) ?? null,
    findAll: async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter(
        (row) =>
          row.school_id === where.school_id &&
          row.actor_user_id === where.actor_user_id &&
          row.ended_at === null,
      ),
    update: async (patch: Record<string, unknown>, options: { where: { id: string[] } }) => {
      for (const row of rows) {
        if (options.where.id.includes(row.id as string)) {
          Object.assign(row, patch);
        }
      }
      return [1];
    },
  };
}

function auditStub() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    log: async (input: Record<string, unknown>) => {
      events.push(input);
    },
  };
}

describe('AssistedSessionService', () => {
  let sessions: ReturnType<typeof sessionsStub>;
  let audit: ReturnType<typeof auditStub>;
  let service: AssistedSessionService;

  beforeEach(() => {
    sessions = sessionsStub();
    audit = auditStub();
    service = new AssistedSessionService(sessions as never, audit as never, null);
  });

  it('opens a session with the Super Admin actor and the managed school', async () => {
    const created = await service.start(SCHOOL, ACTOR, { ip_address: '203.0.113.9' });

    assert.equal(created.school_id, SCHOOL.id);
    assert.equal(created.actor_user_id, ACTOR.userId);
    assert.equal(created.ended_at, null);
    assert.equal(created.ip_address, '203.0.113.9');
    assert.ok(created.started_at instanceof Date);

    assert.equal(audit.events.length, 1);
    const event = audit.events[0];
    assert.equal(event.school_id, SCHOOL.id);
    assert.equal(event.actor_user_id, ACTOR.userId);
    assert.equal(event.action, AUDIT_ACTIONS.ASSISTED_SESSION_START);
    assert.equal(event.entity_type, AUDIT_ENTITY_TYPES.ASSISTED_MANAGEMENT_SESSION);
    assert.equal(event.entity_id, created.id);
    assert.equal(
      (event.metadata as Record<string, unknown>).context,
      AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
    );
    assert.equal((event.metadata as Record<string, unknown>).managed_school_name, 'ABC School');
  });

  it('supersedes a still-open session instead of accumulating open rows', async () => {
    const first = await service.start(SCHOOL, ACTOR);
    const second = await service.start(SCHOOL, ACTOR);

    assert.notEqual(first.id, second.id);
    assert.equal(first.end_reason, 'superseded');
    assert.ok(first.ended_at instanceof Date);
    assert.equal(second.end_reason, null);
    assert.equal(await service.findOpenSessionId(SCHOOL.id, ACTOR.userId), second.id);
  });

  it('ends the open session as `exit` and audits the close', async () => {
    const opened = await service.start(SCHOOL, ACTOR);
    audit.events.length = 0;

    const closed = await service.end(SCHOOL, ACTOR);
    assert.equal(closed?.id, opened.id);
    assert.equal(closed?.end_reason, 'exit');
    assert.ok(closed?.ended_at instanceof Date);

    const event = audit.events.find((e) => e.action === AUDIT_ACTIONS.ASSISTED_SESSION_END);
    assert.ok(event, 'session end audited');
    assert.equal(event.school_id, SCHOOL.id);
    assert.equal(event.actor_user_id, ACTOR.userId);
    assert.equal(
      (event.metadata as Record<string, unknown>).context,
      AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
    );
    assert.equal(await service.findOpenSessionId(SCHOOL.id, ACTOR.userId), null);
  });

  it('is idempotent on exit: no open session means no fabricated close event', async () => {
    const closed = await service.end(SCHOOL, ACTOR);
    assert.equal(closed, null);
    assert.equal(audit.events.length, 0);
  });

  it('keeps sessions of different schools and actors separate', async () => {
    const schoolB: ManagedSchoolContext = { ...SCHOOL, id: '33333333-1111-4111-8111-111111111111' };
    const actorB = { userId: '44444444-1111-4111-8111-111111111111' };

    await service.start(SCHOOL, ACTOR);
    const b = await service.start(schoolB, actorB);

    assert.equal(await service.findOpenSessionId(SCHOOL.id, ACTOR.userId), 'session-1');
    assert.equal(await service.findOpenSessionId(schoolB.id, actorB.userId), b.id);
    assert.equal(await service.findOpenSessionId(schoolB.id, ACTOR.userId), null);
  });
});
