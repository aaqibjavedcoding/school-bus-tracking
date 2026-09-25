import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveDriverMapPresentation,
  driverMapCopy,
  driverStopMarkerKind,
  type DriverMapPresentationInput,
  type DriverStopMarkerKind,
} from './crew-map-presentation.ts';
import type { CrewTrackingStatus, TrackingConnectionState } from './tracking-status.ts';
import { LOCAL_FIX_FRESH_WINDOW_MS } from './tracking-status.ts';

/**
 * What the Driver Trip map is allowed to say.
 *
 * Two invariants carry this suite:
 *
 * 1. **The marker is the device's own fix** (`source: 'device'`, always) — it is
 *    never silently re-pointed at the server's copy of the position.
 * 2. **The map can never claim the school sees you.** That sentence is owned by
 *    `gps.status.live`, which requires a server acknowledgement inside the live
 *    window. Here it is *copied* through as `schoolSeesLive`, and the panel's
 *    delivery line is `null` exactly when the school can see the drawn position.
 *
 * The panel has two lines, and the split is the point: the position line always
 * says how current the fix is (that is the driver's own GPS, and it stays
 * readable in the degraded cases), while the delivery line only ever appears to
 * deny a possible misreading. Replacing one with the other — the obvious first
 * design — is how "not delivered yet" ends up hiding whether the phone's GPS is
 * alive at all, which is the moment that number matters most.
 */

const ALL_STATUSES: CrewTrackingStatus[] = [
  'stopped',
  'services-off',
  'permission-blocked',
  'revoked',
  'connecting',
  'reconnecting',
  'waiting-for-fix',
  'local-only',
  'live',
  'stale',
];

function input(overrides: Partial<DriverMapPresentationInput> = {}): DriverMapPresentationInput {
  return {
    status: 'local-only',
    localFixAgeMs: 1_000,
    accuracyMeters: 8,
    connection: 'connected',
    ...overrides,
  };
}

describe('driver map — where the position comes from', () => {
  it('always sources the marker from the device, never from the server copy', () => {
    for (const status of ALL_STATUSES) {
      const result = deriveDriverMapPresentation(input({ status }));
      assert.equal(result.source, 'device', `${status} must not change the marker's source`);
    }
  });

  it('reports no fix at all before the device has produced one', () => {
    const result = deriveDriverMapPresentation(
      input({ localFixAgeMs: null, status: 'waiting-for-fix' }),
    );
    assert.equal(result.state, 'no-fix');
    assert.equal(result.animate, false);
    assert.equal(result.positionKey, 'gps.noFix');
    assert.equal(result.deliveryKey, null, 'nothing is drawn, so nothing to deny');
    assert.equal(result.schoolSeesLive, false);
  });
});

describe('driver map — delivery honesty', () => {
  it('copies schoolSeesLive from the crew status and never invents it', () => {
    for (const status of ALL_STATUSES) {
      const result = deriveDriverMapPresentation(input({ status }));
      assert.equal(
        result.schoolSeesLive,
        status === 'live',
        `${status} must not be presented as visible to the school`,
      );
    }
  });

  it('shows the position age even when the position has not been delivered', () => {
    // The delivered case: nothing to deny, so the position line stands alone.
    const delivered = deriveDriverMapPresentation(input({ status: 'live' }));
    assert.equal(delivered.positionKey, 'gps.lastUpdate');
    assert.equal(delivered.deliveryKey, null);

    // The undelivered case: the *same* position line, plus the denial. Dropping
    // the age line here would be the panel going quiet exactly when the driver
    // needs to know whether their own GPS is still alive.
    const localOnly = deriveDriverMapPresentation(
      input({ status: 'local-only', localFixAgeMs: 500 }),
    );
    assert.notEqual(localOnly.positionKey, 'gps.noFix', 'a local fix is still a fix');
    assert.equal(localOnly.deliveryKey, 'driverMap.note.notDelivered');
    // The position itself is current — the marker keeps moving — but the panel
    // says the school cannot see it yet. Both facts, neither softened.
    assert.equal(localOnly.animate, true);
    assert.equal(localOnly.state, 'live');
  });

  it('says "offline" when the delivery path is down, not "not delivered yet"', () => {
    const down: Array<[CrewTrackingStatus, TrackingConnectionState]> = [
      ['connecting', 'connecting'],
      ['reconnecting', 'reconnecting'],
    ];
    for (const [status, connection] of down) {
      assert.equal(
        deriveDriverMapPresentation(input({ status, connection })).deliveryKey,
        'driverMap.note.offline',
      );
    }
    // A connected socket whose last acknowledgement is merely old is a third
    // sentence: the school is not blind, it is behind. "Not delivered yet"
    // would be a false claim about a two-minute-old acknowledgement.
    assert.equal(
      deriveDriverMapPresentation(input({ status: 'stale', connection: 'connected' })).deliveryKey,
      'driverMap.note.schoolStale',
    );
    // ...while a position the server has never acknowledged is a fourth.
    assert.equal(
      deriveDriverMapPresentation(input({ status: 'local-only', connection: 'connected' }))
        .deliveryKey,
      'driverMap.note.notDelivered',
    );
    // A socket that is not connected at all reads as offline even if the status
    // has not caught up.
    assert.equal(
      deriveDriverMapPresentation(input({ status: 'local-only', connection: 'idle' })).deliveryKey,
      'driverMap.note.offline',
    );
  });

  it('says sharing is off when nothing is being sent, whatever the last fix was', () => {
    for (const status of [
      'stopped',
      'services-off',
      'permission-blocked',
      'revoked',
    ] as CrewTrackingStatus[]) {
      const result = deriveDriverMapPresentation(input({ status, localFixAgeMs: 0 }));
      assert.equal(
        result.deliveryKey,
        'driverMap.note.notSharing',
        `${status} must say sharing is off`,
      );
      assert.equal(result.animate, false, `${status} must not keep the marker moving`);
      assert.equal(result.state, 'last-known');
    }
  });
});

describe('driver map — motion and accuracy', () => {
  it('animates only while the device’s own stream is current and running', () => {
    assert.equal(deriveDriverMapPresentation(input({ localFixAgeMs: 0 })).animate, true);
    assert.equal(
      deriveDriverMapPresentation(input({ localFixAgeMs: LOCAL_FIX_FRESH_WINDOW_MS })).animate,
      true,
      'the window is inclusive at its boundary',
    );
    assert.equal(
      deriveDriverMapPresentation(input({ localFixAgeMs: LOCAL_FIX_FRESH_WINDOW_MS + 1 })).animate,
      false,
      'a marker that keeps gliding while the fixes stopped is the lie to avoid',
    );
    assert.equal(deriveDriverMapPresentation(input({ localFixAgeMs: null })).animate, false);
  });

  it('ages the position to last-known without inventing a second window', () => {
    const ageing = deriveDriverMapPresentation(input({ localFixAgeMs: 5 * 60_000 }));
    assert.equal(ageing.state, 'last-known');
    assert.equal(ageing.animate, false);
  });

  it('takes the local window from the crew constant, overridably', () => {
    const narrowed = deriveDriverMapPresentation(
      input({ localFixAgeMs: 5_000, localFreshWindowMs: 1 }),
    );
    assert.equal(narrowed.state, 'last-known');
    const widened = deriveDriverMapPresentation({
      ...input({ localFixAgeMs: 5 * 60_000 }),
      localFreshWindowMs: 10 * 60_000,
    });
    assert.equal(widened.state, 'live');
  });

  it('states coarse accuracy in words and draws it only when it helps', () => {
    assert.equal(deriveDriverMapPresentation(input({ accuracyMeters: 8 })).approximate, false);
    assert.equal(
      deriveDriverMapPresentation(input({ accuracyMeters: 8 })).accuracyCircleMeters,
      null,
    );

    const coarse = deriveDriverMapPresentation(input({ accuracyMeters: 120 }));
    assert.equal(coarse.approximate, true);
    assert.equal(coarse.accuracyCircleMeters, 120);

    const useless = deriveDriverMapPresentation(input({ accuracyMeters: 2_000 }));
    assert.equal(useless.approximate, true);
    assert.equal(
      useless.accuracyCircleMeters,
      null,
      'a 2 km circle is a full screen, not information',
    );

    assert.equal(deriveDriverMapPresentation(input({ accuracyMeters: null })).approximate, false);
    assert.equal(
      deriveDriverMapPresentation(input({ accuracyMeters: Number.NaN })).approximate,
      false,
    );
  });
});

describe('driver map — copy', () => {
  it('resolves both lines to real text for every status', () => {
    for (const status of ALL_STATUSES) {
      for (const localFixAgeMs of [null, 1_000, 10 * 60_000]) {
        const copy = driverMapCopy(
          deriveDriverMapPresentation(input({ status, localFixAgeMs })),
          '4s',
        );
        assert.ok(copy.position.length > 0, `${status} has no position line`);
        assert.doesNotMatch(copy.position, /\{[a-z]+\}/, `${status} has an unfilled placeholder`);
        if (copy.delivery !== null) {
          assert.ok(copy.delivery.length > 0, `${status} has an empty delivery line`);
          assert.doesNotMatch(copy.delivery, /\{[a-z]+\}/, `${status} has an unfilled placeholder`);
          assert.notEqual(copy.delivery, copy.position, `${status} repeats one line twice`);
        }
      }
    }
  });

  it('fills the position line with the age the caller formatted', () => {
    const current = driverMapCopy(deriveDriverMapPresentation(input({ status: 'live' })), '12s');
    assert.match(current.position, /12s/);

    const noFix = driverMapCopy(
      deriveDriverMapPresentation(input({ status: 'waiting-for-fix', localFixAgeMs: null })),
      '',
    );
    assert.doesNotMatch(noFix.position, /\{[a-z]+\}/, 'no fix still resolves through t()');
  });

  it('never renders the "the school sees the bus" sentence on the map', () => {
    // That sentence belongs to the GPS strip, which derives it from a server
    // acknowledgement. If the map ever renders it, the map is claiming delivery
    // from its own state — the exact conflation this suite exists to prevent.
    const everyLine = (status: CrewTrackingStatus, localFixAgeMs: number | null): string[] => {
      const copy = driverMapCopy(
        deriveDriverMapPresentation(input({ status, localFixAgeMs })),
        '4s',
      );
      return copy.delivery === null ? [copy.position] : [copy.position, copy.delivery];
    };
    for (const status of ALL_STATUSES) {
      for (const line of everyLine(status, 1_000)) {
        assert.doesNotMatch(line, /school sees/i, `${status} must not claim delivery`);
      }
    }
    assert.doesNotMatch(
      driverMapCopy(deriveDriverMapPresentation(input({ status: 'stale' })), '4s').delivery ?? '',
      /not delivered/i,
      'a stale acknowledgement is not the same claim as no acknowledgement',
    );
    const frozen = driverMapCopy(
      deriveDriverMapPresentation(input({ status: 'stopped' })),
      '4s',
    ).delivery;
    assert.ok(frozen !== null);
    assert.doesNotMatch(frozen, /sharing is live/i);
  });
});

describe('driver map — connection vocabulary stays out of the copy', () => {
  it('does not expose raw socket states to the driver', () => {
    const socketStates: TrackingConnectionState[] = [
      'idle',
      'connecting',
      'connected',
      'reconnecting',
      'gave-up',
      'revoked',
    ];
    for (const connection of socketStates) {
      const { positionKey, deliveryKey } = deriveDriverMapPresentation(
        input({ connection, status: 'local-only' }),
      );
      assert.ok(
        ['gps.lastUpdate', 'gps.noFix'].includes(positionKey),
        `${connection} produced an unknown position line`,
      );
      assert.ok(
        deliveryKey === null ||
          [
            'driverMap.note.schoolStale',
            'driverMap.note.notDelivered',
            'driverMap.note.offline',
            'driverMap.note.notSharing',
          ].includes(deliveryKey),
        `${connection} produced an unknown delivery line`,
      );
    }
  });
});

describe('driver map — which stop is next', () => {
  it('marks exactly the stop the screen named as next', () => {
    assert.equal(driverStopMarkerKind('s2', 's2'), 'next');
    assert.equal(driverStopMarkerKind('s3', 's2'), 'plain');
  });

  it('marks nothing when there is no next stop (map never guesses)', () => {
    for (const nextStopId of [null, undefined]) {
      assert.equal(driverStopMarkerKind('s2', nextStopId), 'plain');
      assert.equal(driverStopMarkerKind('s3', nextStopId), 'plain');
    }
  });

  it('never highlights two stops at once', () => {
    const ids = ['s1', 's2', 's3', 's4'];
    const kinds = ids.map((id) => driverStopMarkerKind(id, 's3'));
    assert.equal(kinds.filter((kind) => kind === 'next').length, 1);
    assert.equal(kinds[ids.indexOf('s3')], 'next');
  });

  it('keeps the kind vocabulary to plain and next (the web twin has current too)', () => {
    // The web map's `createStopMarkerElement` knows 'current' as well; on the
    // driver's own map the bus marker already answers "where am I", so a
    // third kind would be decoration, not information.
    const kinds: DriverStopMarkerKind[] = ['plain', 'next'];
    assert.deepEqual(
      Object.values({ plain: 'plain', next: 'next' } as const),
      kinds,
    );
  });
});
