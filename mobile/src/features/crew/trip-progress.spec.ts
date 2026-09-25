import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { StopResponse, TripEtaResponse, TripStopEta } from '@school-bus-tracking/shared-types';
import { deriveTripProgress } from './navigation-stop.ts';
import {
  advanceTripFrontier,
  deriveTripProgressForTrip,
  effectiveFrontier,
  etaForTrip,
  initialTripFrontier,
  stopsForRoute,
} from './trip-progress.ts';

/**
 * T1 — **the cross-trip progress frontier**.
 *
 * A crew day is several trips. The moment trip A completes, `pickCrewTrip`
 * selects trip B on the very next reload, and every piece of trip-A state the
 * screen kept has to stop applying. It did not: the frontier lived in a
 * `useRef` that survived the trip switch, so trip B was derived with trip A's
 * frontier. Two field failures follow from that one line:
 *
 * - trip A finished at frontier 6 and trip B has 5 stops ⇒ "no candidates
 *   ahead of frontier 6" ⇒ **no next stop at all**: the Navigate button
 *   disappears, the kids card empties, the voice goes quiet, and the server's
 *   own `next_stop` is rejected as "behind frontier, ignored";
 * - a smaller stale frontier (say 1) is worse — it is *plausible*, so trip B
 *   quietly opens on its **second** stop and the driver drives past a stop
 *   full of children.
 *
 * Both need an app force-close to recover. These specs pin the fix: the
 * frontier is scoped to a trip id, the server's `next_stop` stays the source
 * of truth, and the client frontier is only the safety net against a backward
 * jump **inside** one trip.
 */

const stop = (overrides: Partial<StopResponse> = {}): StopResponse =>
  ({
    id: 'stop-1',
    school_id: 'school-1',
    route_id: 'route-1',
    name: 'Main gate',
    sequence_number: 1,
    latitude: 19.076,
    longitude: 72.8777,
    arrival_time: null,
    departure_time: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as StopResponse;

const etaItem = (overrides: Partial<TripStopEta> = {}): TripStopEta => ({
  stop_id: 'stop-1',
  stop_name: 'Main gate',
  sequence_number: 1,
  distance_meters: 100,
  eta_minutes: 1,
  arrived: false,
  ...overrides,
});

const etaResponse = (
  tripId: string,
  items: TripStopEta[],
  next: TripStopEta | null = null,
): TripEtaResponse =>
  ({
    trip_id: tripId,
    school_id: 'school-1',
    trip_status: 'IN_PROGRESS' as never,
    tracking_state: 'active' as never,
    latest: null,
    speed_kmh: 20,
    speed_source: 'gps',
    current_stop: items.find((item) => item.arrived) ?? null,
    next_stop: next,
    items,
    eta_available: true,
    warnings: [],
  }) as TripEtaResponse;

/** A route of `count` stops, ids `${prefix}1..${prefix}${count}`. */
const route = (prefix: string, count: number, routeId = `route-${prefix}`): StopResponse[] =>
  Array.from({ length: count }, (_, index) =>
    stop({
      id: `${prefix}${index + 1}`,
      route_id: routeId,
      name: `Stop ${prefix.toUpperCase()} ${index + 1}`,
      sequence_number: index + 1,
    }),
  );

/** An ETA where the first `arrived` stops are reached and the rest are not. */
const etaAfter = (tripId: string, stops: StopResponse[], arrived: number): TripEtaResponse => {
  const items = stops.map((item) =>
    etaItem({
      stop_id: item.id,
      stop_name: item.name ?? 'Stop',
      sequence_number: item.sequence_number,
      arrived: item.sequence_number <= arrived,
      distance_meters: item.sequence_number <= arrived ? null : item.sequence_number * 100,
    }),
  );
  const next = items.find((item) => !item.arrived) ?? null;
  return etaResponse(tripId, items, next);
};

describe('trip-scoped progress frontier (T1)', () => {
  it('documents the bug: a stale frontier from another trip kills the next stop', () => {
    const tripB = route('b', 5);
    const tripBEta = etaAfter('trip-B', tripB, 0);

    // Exactly what the screen did before the fix: trip A left the ref at 6 and
    // trip B was derived with it. The server's own next stop is rejected…
    const leaked = deriveTripProgress(tripB, tripBEta, 'b1', 6);
    assert.equal(leaked.nextStop, null, 'the bug: trip B shows no next stop');
    assert.ok(leaked.reason.includes('behind frontier'), 'server next_stop was ignored');
    assert.ok(leaked.reason.includes('no candidates ahead of frontier 6'), leaked.reason);
  });

  it('trip A finished at frontier 6 → trip B opens on its FIRST stop', () => {
    const tripA = route('a', 6);
    const finished = deriveTripProgressForTrip(initialTripFrontier(), {
      tripId: 'trip-A',
      stops: tripA,
      eta: etaAfter('trip-A', tripA, 6),
    });
    assert.equal(finished.progress.nextStop, null, 'trip A is complete');
    assert.equal(finished.frontierState.frontier, 6);
    assert.equal(finished.frontierState.tripId, 'trip-A');

    // The reload lands: pickCrewTrip now returns trip B, whose ETA knows about
    // no arrivals at all. The remembered frontier must not follow the driver.
    const tripB = route('b', 5);
    const opened = deriveTripProgressForTrip(finished.frontierState, {
      tripId: 'trip-B',
      stops: tripB,
      eta: etaAfter('trip-B', tripB, 0),
    });

    assert.equal(opened.progress.frontier, 0, 'frontier restarts with the trip');
    assert.equal(opened.progress.nextStop?.id, 'b1', 'trip B starts at its first stop');
    assert.equal(opened.frontierState.tripId, 'trip-B');
    assert.ok(opened.progress.reason.includes('trusted'), opened.progress.reason);
  });

  it('a smaller stale frontier can never shift trip B onto its second stop', () => {
    const tripA = route('a', 3);
    const partWay = deriveTripProgressForTrip(initialTripFrontier(), {
      tripId: 'trip-A',
      stops: tripA,
      eta: etaAfter('trip-A', tripA, 1),
    });
    assert.equal(partWay.frontierState.frontier, 1);

    const tripB = route('b', 5);
    const opened = deriveTripProgressForTrip(partWay.frontierState, {
      tripId: 'trip-B',
      stops: tripB,
      eta: etaAfter('trip-B', tripB, 0),
    });
    assert.equal(opened.progress.nextStop?.id, 'b1', 'not b2 — the driver must not skip a stop');
  });

  it('trip B with no ETA at all still opens on its first stop', () => {
    const tripA = route('a', 6);
    const finished = deriveTripProgressForTrip(initialTripFrontier(), {
      tripId: 'trip-A',
      stops: tripA,
      eta: etaAfter('trip-A', tripA, 6),
    });
    const tripB = route('b', 5);
    const opened = deriveTripProgressForTrip(finished.frontierState, {
      tripId: 'trip-B',
      stops: tripB,
      eta: null,
    });
    assert.equal(opened.progress.nextStop?.id, 'b1');
  });

  it('the frontier still never retreats inside one trip', () => {
    const trip = route('a', 4);
    let state = initialTripFrontier();

    const atTwo = deriveTripProgressForTrip(state, {
      tripId: 'trip-A',
      stops: trip,
      eta: etaAfter('trip-A', trip, 2),
    });
    assert.equal(atTwo.progress.frontier, 2);
    assert.equal(atTwo.progress.nextStop?.id, 'a3');
    state = atTwo.frontierState;

    // An out-of-order push says only stop 1 was reached. Monotonicity holds.
    const outOfOrder = deriveTripProgressForTrip(state, {
      tripId: 'trip-A',
      stops: trip,
      eta: etaAfter('trip-A', trip, 1),
    });
    assert.equal(outOfOrder.progress.frontier, 2, 'frontier must not retreat');
    assert.equal(outOfOrder.progress.nextStop?.id, 'a3', 'next stays ahead of the frontier');
    assert.equal(outOfOrder.frontierState, state, 'an unchanged frontier keeps its identity');
  });

  it('completing a trip and returning to it re-derives from the server, not from memory', () => {
    const trip = route('a', 3);
    const complete = deriveTripProgressForTrip(initialTripFrontier(), {
      tripId: 'trip-A',
      stops: trip,
      eta: etaAfter('trip-A', trip, 3),
    });
    assert.equal(complete.progress.nextStop, null);

    const otherTrip = route('b', 2);
    const elsewhere = deriveTripProgressForTrip(complete.frontierState, {
      tripId: 'trip-B',
      stops: otherTrip,
      eta: etaAfter('trip-B', otherTrip, 0),
    });

    // Back on trip A: the server still says every stop is reached, so the trip
    // is still complete — the answer comes from the ETA, not a remembered 3.
    const again = deriveTripProgressForTrip(elsewhere.frontierState, {
      tripId: 'trip-A',
      stops: trip,
      eta: etaAfter('trip-A', trip, 3),
    });
    assert.equal(again.progress.frontier, 3);
    assert.equal(again.progress.nextStop, null);
  });

  it('a trip with no stops at all reports nothing to drive to', () => {
    const opened = deriveTripProgressForTrip(initialTripFrontier(), {
      tripId: 'trip-A',
      stops: [],
      eta: null,
    });
    assert.equal(opened.progress.nextStop, null);
    assert.equal(opened.progress.reason, 'no stops in route');
  });
});

describe('an ETA payload belongs to the trip it was computed for', () => {
  it('drops a stale ETA while the screen is showing the next trip', () => {
    // `useLiveTripTracking` keeps the previous trip's ETA until the new
    // snapshot lands, and both trips can share a route — so trip A's arrivals
    // would otherwise pin trip B's frontier.
    const shared = route('a', 5, 'route-shared');
    const tripAEta = etaAfter('trip-A', shared, 5);

    const scoped = deriveTripProgressForTrip(initialTripFrontier(), {
      tripId: 'trip-B',
      stops: shared,
      eta: tripAEta,
      serverNextStopId: tripAEta.next_stop?.stop_id ?? null,
    });

    assert.equal(scoped.progress.frontier, 0, 'trip A arrivals do not belong to trip B');
    assert.equal(scoped.progress.nextStop?.id, 'a1', 'trip B opens on the shared route first stop');
    assert.equal(etaForTrip(tripAEta, 'trip-B'), null);
    assert.equal(etaForTrip(tripAEta, 'trip-A'), tripAEta);
    assert.equal(etaForTrip(null, 'trip-A'), null);
    assert.equal(etaForTrip(tripAEta, null), null, 'no trip means no ETA to show');
  });

  it('keeps a matching ETA, and one whose origin is unknown cannot be disproved', () => {
    const stops = route('a', 2);
    const eta = etaAfter('trip-A', stops, 0);
    assert.equal(etaForTrip(eta, 'trip-A'), eta);
    const unlabelled = { ...eta, trip_id: undefined as unknown as string };
    assert.equal(etaForTrip(unlabelled, 'trip-A'), unlabelled);
  });
});

describe('the frontier state machine', () => {
  it('starts empty and scoped to no trip', () => {
    assert.deepEqual(initialTripFrontier(), { tripId: null, frontier: 0 });
    assert.equal(effectiveFrontier(initialTripFrontier(), 'trip-A'), 0);
  });

  it('only ever advances within a trip and resets across trips', () => {
    const state = advanceTripFrontier(initialTripFrontier(), 'trip-A', 3);
    assert.deepEqual(state, { tripId: 'trip-A', frontier: 3 });
    assert.equal(advanceTripFrontier(state, 'trip-A', 1), state, 'never retreats');
    assert.equal(advanceTripFrontier(state, 'trip-A', 3), state, 'no needless re-render');
    assert.deepEqual(advanceTripFrontier(state, 'trip-A', 4), { tripId: 'trip-A', frontier: 4 });
    assert.deepEqual(advanceTripFrontier(state, 'trip-B', 0), { tripId: 'trip-B', frontier: 0 });
    assert.equal(effectiveFrontier(state, 'trip-B'), 0, 'another trip starts from zero');
    assert.equal(effectiveFrontier(state, 'trip-A'), 3);
    assert.equal(effectiveFrontier(state, null), 0);
  });

  it('ignores a frontier that is not a number', () => {
    const state = advanceTripFrontier(initialTripFrontier(), 'trip-A', 2);
    assert.equal(advanceTripFrontier(state, 'trip-A', Number.NaN), state);
    assert.equal(advanceTripFrontier(state, 'trip-A', -5), state);
  });

  it('a null trip carries no frontier', () => {
    assert.deepEqual(advanceTripFrontier({ tripId: 'trip-A', frontier: 4 }, null, 4), {
      tripId: null,
      frontier: 0,
    });
  });
});

describe('stops belong to the route they were loaded for', () => {
  it('ignores the previous route while the new one is still loading', () => {
    const loaded = { route_id: 'route-a', items: route('a', 3, 'route-a') };
    assert.equal(stopsForRoute(loaded, 'route-a'), loaded.items);
    assert.deepEqual(stopsForRoute(loaded, 'route-b'), []);
    assert.deepEqual(stopsForRoute(loaded, null), []);
    assert.deepEqual(stopsForRoute(null, 'route-a'), []);
    assert.deepEqual(stopsForRoute({ route_id: null, items: [] }, null), []);
  });
});

/**
 * Source guard, in the family of `crew-feedback-wiring.spec.ts`: the selector
 * above is only worth having if the screen actually routes through it. The bug
 * was a `useRef` mutated during render, which no unit test of a pure function
 * can see.
 */
describe('the crew trip screen is wired to the trip-scoped frontier', () => {
  const screen = readFileSync(`${process.cwd()}/app/(crew)/trip.tsx`, 'utf8');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('derives progress through `deriveTripProgressForTrip`', () => {
    assert.ok(
      code.includes("from '../../src/features/crew/trip-progress.ts'"),
      'the screen must import the trip-scoped selector',
    );
    assert.ok(code.includes('deriveTripProgressForTrip('), 'the screen must call the selector');
  });

  it('keeps no frontier ref and mutates nothing during render', () => {
    assert.ok(!/frontierRef/.test(code), 'frontierRef is the bug — it survived a trip switch');
    assert.ok(!/\.current\s*=/.test(code), 'the frontier must not be assigned during render');
    assert.ok(
      !/derived\.nextStop\s*:\s*derived\.nextStop/.test(code),
      'the dead ternary must stay deleted',
    );
  });

  it('hands the navigation card the trip-scoped frontier and the scoped ETA', () => {
    assert.ok(code.includes('previousFrontier={progress.frontier}'), 'trip-scoped frontier');
    assert.ok(code.includes('eta={eta}'), 'the card must not read the previous trip ETA');
  });
});
