import {
  isValidTripLocationUpdatePayload,
  toTripLocationUpdatePayload,
  GPS_REJECTION_MESSAGES,
  type ExpoLocationLikeFix,
} from '../src/gps/fix-mapping';
import { tripLocationUpdateSchema } from '@school-bus-tracking/validation';

/**
 * The GPS wire contract (Task 23 §E): what the driver's phone sends is the
 * shared `trip:location:update` payload and *nothing else* — no tenant id,
 * no role, no actor. The payload builder is also the unit converter
 * (m/s → km/h) and the place where unreported fields are dropped rather
 * than invented.
 */

const TRIP_ID = '3f2b7a10-9a3e-4d47-9e6a-5d9c6f1e2b34';

const fix = (overrides: Partial<ExpoLocationLikeFix['coords']> = {}): ExpoLocationLikeFix => ({
  coords: {
    latitude: 40.7128,
    longitude: -74.006,
    accuracy: 8.4,
    altitude: 11,
    heading: 91.6,
    speed: 5.556, // m/s → 20 km/h
    ...overrides,
  },
  timestamp: Date.parse('2026-08-29T06:30:00.000Z'),
});

describe('toTripLocationUpdatePayload', () => {
  it('produces the schema-valid socket payload', () => {
    const payload = toTripLocationUpdatePayload(TRIP_ID, fix());
    const parsed = tripLocationUpdateSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(isValidTripLocationUpdatePayload(payload)).toBe(true);
    expect(payload).toMatchObject({
      trip_id: TRIP_ID,
      latitude: 40.7128,
      longitude: -74.006,
      recorded_at: '2026-08-29T06:30:00.000Z',
      speed: 20,
      accuracy: 8,
      heading: 92,
    });
  });

  it('carries NO identity fields: no school_id, role, parent_id, driver_id', () => {
    const payload = toTripLocationUpdatePayload(TRIP_ID, fix()) as unknown as Record<
      string,
      unknown
    >;
    for (const forbidden of [
      'school_id',
      'role',
      'parent_id',
      'driver_id',
      'user_id',
      'is_active',
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('drops unreported values instead of inventing them', () => {
    const payload = toTripLocationUpdatePayload(
      TRIP_ID,
      fix({ accuracy: null, speed: null, heading: null }),
    ) as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty('accuracy');
    expect(payload).not.toHaveProperty('speed');
    expect(payload).not.toHaveProperty('heading');
    const parsed = tripLocationUpdateSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('treats negative speed (device coasting sentinel) and NaN as unreported', () => {
    const payload = toTripLocationUpdatePayload(TRIP_ID, fix({ speed: -1 })) as unknown as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('speed');
    const nanPayload = toTripLocationUpdatePayload(
      TRIP_ID,
      fix({ accuracy: Number.NaN }),
    ) as unknown as Record<string, unknown>;
    expect(nanPayload).not.toHaveProperty('accuracy');
  });

  it('falls back to wall clock when the fix has no timestamp', () => {
    const payload = toTripLocationUpdatePayload(TRIP_ID, { coords: fix().coords });
    expect(Number.isNaN(Date.parse(payload.recorded_at))).toBe(false);
  });
});

describe('server rejection reasons', () => {
  it('has a human message for every rejection the gateway can answer', () => {
    const reasons = [
      'unauthenticated',
      'unauthorized',
      'trip_not_found',
      'trip_not_open',
      'invalid_payload',
      'invalid_timestamp',
      'future_timestamp',
      'throttled',
    ] as const;
    for (const reason of reasons) {
      expect(typeof GPS_REJECTION_MESSAGES[reason]).toBe('string');
      expect(GPS_REJECTION_MESSAGES[reason].length).toBeGreaterThan(8);
    }
  });
});
