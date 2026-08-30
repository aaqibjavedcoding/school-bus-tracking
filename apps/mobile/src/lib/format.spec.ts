import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  attendanceStatusLabel,
  boardingStatusLabel,
  formatDistanceMeters,
  formatEtaMinutes,
  formatTime,
  formatRelative,
  tripStatusLabel,
  utcDateOnly,
} from './format.ts';
import { TripAttendanceStatus, TripStatus } from '@school-bus-tracking/shared-types';

/**
 * Deterministic formatting guards. Times are constructed from local
 * components so the tests pass in every timezone the runner may use.
 */
describe('time formatting', () => {
  it('formats a local afternoon time as a 12-hour clock', () => {
    assert.equal(formatTime(new Date(2026, 7, 29, 16, 5)), '4:05 PM');
    assert.equal(formatTime(new Date(2026, 7, 29, 0, 2)), '12:02 AM');
    assert.equal(formatTime(new Date(2026, 7, 29, 12, 0)), '12:00 PM');
  });

  it('renders a dash for missing or invalid values', () => {
    assert.equal(formatTime(null), '—');
    assert.equal(formatTime('garbage'), '—');
  });

  it('produces the UTC calendar day the trips date filter expects', () => {
    assert.equal(utcDateOnly(new Date(Date.UTC(2026, 7, 29, 23, 59))), '2026-08-29');
  });
});

describe('distance and eta formatting', () => {
  it('renders metres below a kilometre and km above', () => {
    assert.equal(formatDistanceMeters(650.4), '650 m');
    assert.equal(formatDistanceMeters(1234), '1.2 km');
    assert.equal(formatDistanceMeters(null), '—');
  });

  it('renders approximate minutes and never invents an ETA', () => {
    assert.equal(formatEtaMinutes(1), '~1 minute');
    assert.equal(formatEtaMinutes(7), '~7 minutes');
    assert.equal(formatEtaMinutes(null), null);
  });
});

describe('relative formatting', () => {
  const now = Date.UTC(2026, 7, 29, 12, 0, 0);

  it('buckets ages coarsely', () => {
    assert.equal(formatRelative(new Date(now - 2_000).toISOString(), now), 'Just now');
    assert.equal(formatRelative(new Date(now - 30_000).toISOString(), now), '30s ago');
    assert.equal(formatRelative(new Date(now - 5 * 60_000).toISOString(), now), '5m ago');
    assert.equal(formatRelative(new Date(now - 3 * 3_600_000).toISOString(), now), '3h ago');
    assert.equal(formatRelative(null, now), 'No GPS yet');
  });
});

describe('status labels', () => {
  it('labels every trip lifecycle state', () => {
    assert.equal(tripStatusLabel(TripStatus.SCHEDULED), 'Scheduled');
    assert.equal(tripStatusLabel(TripStatus.BOARDING), 'Boarding');
    assert.equal(tripStatusLabel(TripStatus.IN_PROGRESS), 'In Progress');
    assert.equal(tripStatusLabel(TripStatus.COMPLETED), 'Completed');
    assert.equal(tripStatusLabel(TripStatus.CANCELLED), 'Cancelled');
  });

  it('labels attendance for crew and parent surfaces', () => {
    assert.equal(attendanceStatusLabel(TripAttendanceStatus.PENDING), 'Waiting');
    assert.equal(attendanceStatusLabel(TripAttendanceStatus.BOARDED), 'On board');
    assert.equal(attendanceStatusLabel(TripAttendanceStatus.DROPPED), 'Dropped off');
    assert.equal(boardingStatusLabel(null), 'Not boarded');
    assert.equal(boardingStatusLabel(TripAttendanceStatus.BOARDED), 'Boarded');
  });
});
