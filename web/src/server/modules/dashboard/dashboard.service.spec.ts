import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { DashboardService } from './dashboard.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface CountCall {
  where: Record<string, unknown>;
}

/** Records every count() call and replays a canned total per repository. */
function makeCountingModel(total: number, calls: CountCall[]) {
  return {
    count: async (options: { where?: Record<string, unknown> } = {}) => {
      calls.push({ where: (options.where ?? {}) as Record<string, unknown> });
      return total;
    },
  } as never;
}

describe('DashboardService.stats', () => {
  it('issues exactly four COUNT queries — students, buses, routes, trips', async () => {
    const studentCalls: CountCall[] = [];
    const busCalls: CountCall[] = [];
    const routeCalls: CountCall[] = [];
    const tripCalls: CountCall[] = [];

    const service = new DashboardService(
      makeCountingModel(120, studentCalls),
      makeCountingModel(8, busCalls),
      makeCountingModel(15, routeCalls),
      makeCountingModel(2, tripCalls),
    );

    const stats = await service.stats(SCHOOL_A);

    assert.equal(stats.students, 120);
    assert.equal(stats.buses, 8);
    assert.equal(stats.routes, 15);
    assert.equal(stats.active_trips, 2);
    assert.equal(studentCalls.length, 1);
    assert.equal(busCalls.length, 1);
    assert.equal(routeCalls.length, 1);
    assert.equal(tripCalls.length, 1);
    assert.ok(stats.generated_at.length > 0);
    assert.equal(Number.isNaN(Date.parse(stats.generated_at)), false);
  });

  it('pins every COUNT to the authenticated school', async () => {
    const calls: CountCall[] = [];
    const model = () => makeCountingModel(1, calls);

    const service = new DashboardService(model(), model(), model(), model());
    await service.stats(SCHOOL_A);

    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.equal(call.where.school_id, SCHOOL_A);
    }
  });

  it("counts live trips as today's boarding/in-progress runs", async () => {
    const tripCalls: CountCall[] = [];
    const noop = () => makeCountingModel(0, []);

    const service = new DashboardService(noop(), noop(), noop(), makeCountingModel(3, tripCalls));
    await service.stats(SCHOOL_A);

    const where = tripCalls[0].where;
    const statuses = (where.status as Record<symbol, unknown>)[
      Op.in as unknown as symbol
    ] as string[];
    assert.deepEqual([...statuses].sort(), ['BOARDING', 'IN_PROGRESS']);
    // The live count is scoped to today's UTC window like the card it feeds.
    const scheduled = where.scheduled_start_at as Record<symbol, Date>;
    const start = scheduled[Op.gte as unknown as symbol] as Date;
    const end = scheduled[Op.lt as unknown as symbol] as Date;
    assert.equal(end.getTime() - start.getTime(), 86_400_000);
    assert.equal(start.getUTCHours(), 0);
  });

  it("never leaks another tenant's totals", async () => {
    const calls: CountCall[] = [];
    const model = (total: number) => makeCountingModel(total, calls);

    const service = new DashboardService(model(50), model(4), model(6), model(0));

    const stats = await service.stats(SCHOOL_B);

    // The stats answer whatever each COUNT returns, but every one of the
    // four queries was pinned to the caller's school id — a Super Admin or
    // neighbouring tenant's id can never widen the count.
    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.equal(call.where.school_id, SCHOOL_B);
    }
    assert.equal(stats.students, 50);
  });
});
