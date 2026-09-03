import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUDIT_ACTIONS, AUDIT_CONTEXT_ASSISTED_MANAGEMENT } from '../../audit';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import type { ManagedSchoolContext } from './admin-manage.constants';

const SCHOOL: ManagedSchoolContext = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ABC School',
  code: 'ABC',
  is_active: true,
};
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-1111-4111-8111-111111111111';

function auditStub() {
  const events: Array<Record<string, unknown>> = [];
  return { events, log: async (input: Record<string, unknown>) => void events.push(input) };
}

function sessionsStub(openSessionId: string | null = 'session-1') {
  return { findOpenSessionId: async () => openSessionId };
}

function makeContext(options: {
  method: string;
  url: string;
  managedSchool?: ManagedSchoolContext;
  user?: { id?: string } | null;
}) {
  const request = {
    method: options.method,
    originalUrl: options.url,
    url: options.url,
    user: options.user === undefined ? { id: ACTOR_ID } : options.user,
    managedSchool: options.managedSchool,
  } as unknown as Request & { managedSchool?: ManagedSchoolContext; user?: { id?: string } };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => Object,
    } as unknown as ExecutionContext,
  };
}

function intercept(
  interceptor: AssistedMutationAuditInterceptor,
  context: ExecutionContext,
  payload: unknown,
) {
  const downstream: CallHandler = { handle: () => of(payload) };
  let observed: unknown;
  interceptor.intercept(context, downstream).subscribe({ next: (value) => (observed = value) });
  return observed;
}

describe('AssistedMutationAuditInterceptor', () => {
  let audit: ReturnType<typeof auditStub>;
  let interceptor: AssistedMutationAuditInterceptor;

  beforeEach(() => {
    audit = auditStub();
    interceptor = new AssistedMutationAuditInterceptor(audit as never, sessionsStub() as never);
  });

  it('audits a created student with the Super Admin actor and the managed school', async () => {
    const { context } = makeContext({
      method: 'POST',
      url: `/api/v1/admin/schools/${SCHOOL.id}/manage/students`,
      managedSchool: SCHOOL,
    });

    const observed = intercept(interceptor, context, {
      success: true,
      data: { id: STUDENT_ID, first_name: 'Ayaan' },
    });

    assert.deepEqual(observed, { success: true, data: { id: STUDENT_ID, first_name: 'Ayaan' } });
    // The audit write is fire-and-forget; give it a tick.
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(audit.events.length, 1);
    const event = audit.events[0];
    assert.equal(event.school_id, SCHOOL.id, 'managed school is the tenant');
    assert.equal(event.actor_user_id, ACTOR_ID, 'Super Admin stays the actor');
    assert.equal(event.action, AUDIT_ACTIONS.ASSISTED_MUTATION);
    assert.equal(event.entity_type, 'student');
    assert.equal(event.entity_id, STUDENT_ID);
    const metadata = event.metadata as Record<string, unknown>;
    assert.equal(metadata.context, AUDIT_CONTEXT_ASSISTED_MANAGEMENT);
    assert.equal(metadata.assisted_session_id, 'session-1');
    assert.equal(metadata.resource, 'students');
    assert.equal(metadata.verb, 'POST');
    assert.equal(metadata.managed_school_name, 'ABC School');
  });

  it('derives the entity id from the URL when the payload has none (delete)', async () => {
    const { context } = makeContext({
      method: 'DELETE',
      url: `/api/v1/admin/schools/${SCHOOL.id}/manage/students/${STUDENT_ID}`,
      managedSchool: SCHOOL,
    });

    intercept(interceptor, context, { success: true, data: { id: STUDENT_ID, deleted: true } });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(audit.events[0].entity_id, STUDENT_ID);
    assert.equal((audit.events[0].metadata as Record<string, unknown>).verb, 'DELETE');
  });

  it('never audits read-only requests', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { context } = makeContext({
        method,
        url: `/api/v1/admin/schools/${SCHOOL.id}/manage/students`,
        managedSchool: SCHOOL,
      });
      intercept(interceptor, context, { success: true, data: [] });
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(audit.events.length, 0);
  });

  it('skips the self-auditing import, export, report and session paths', async () => {
    for (const path of ['imports', 'exports', 'reports', 'session']) {
      const { context } = makeContext({
        method: 'POST',
        url: `/api/v1/admin/schools/${SCHOOL.id}/manage/${path}/students/commit`.replace(
          '/students/commit',
          path === 'session' ? '/end' : '',
        ),
        managedSchool: SCHOOL,
      });
      intercept(interceptor, context, { success: true, data: { id: STUDENT_ID } });
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(audit.events.length, 0);
  });

  it('does nothing without a guarded managed-school context', async () => {
    const { context } = makeContext({
      method: 'POST',
      url: `/api/v1/admin/schools/${SCHOOL.id}/manage/students`,
      managedSchool: undefined,
    });
    intercept(interceptor, context, { success: true, data: { id: STUDENT_ID } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(audit.events.length, 0);
  });

  it('keeps the response flowing when the audit write fails', async () => {
    const failing = { log: async () => Promise.reject(new Error('audit db down')) };
    const failingInterceptor = new AssistedMutationAuditInterceptor(
      failing as never,
      sessionsStub() as never,
    );
    const { context } = makeContext({
      method: 'PATCH',
      url: `/api/v1/admin/schools/${SCHOOL.id}/manage/students/${STUDENT_ID}`,
      managedSchool: SCHOOL,
    });

    const observed = intercept(failingInterceptor, context, {
      success: true,
      data: { id: STUDENT_ID },
    });
    assert.deepEqual(observed, { success: true, data: { id: STUDENT_ID } });
  });
});
