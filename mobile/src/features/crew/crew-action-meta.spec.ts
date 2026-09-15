import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TripStatus } from '@school-bus-tracking/shared-types';

import { attendanceActionMeta, transitionActionMeta } from './crew-action-meta.ts';

test('each forward trip transition keeps its stable icon and tone', () => {
  assert.deepEqual(transitionActionMeta(TripStatus.BOARDING), { icon: 'people', tone: 'success' });
  assert.deepEqual(transitionActionMeta(TripStatus.IN_PROGRESS), {
    icon: 'navigate',
    tone: 'primary',
  });
  assert.deepEqual(transitionActionMeta(TripStatus.COMPLETED), {
    icon: 'checkmark-done',
    tone: 'neutral',
  });
});

test('unhandled statuses fall back to a neutral forward action', () => {
  assert.deepEqual(transitionActionMeta(TripStatus.SCHEDULED), {
    icon: 'arrow-forward',
    tone: 'primary',
  });
});

test('boarding reads green (good to go), dropping reads neutral', () => {
  assert.deepEqual(attendanceActionMeta('board'), { icon: 'log-in', tone: 'success' });
  assert.deepEqual(attendanceActionMeta('drop'), { icon: 'log-out', tone: 'neutral' });
});

test('every tone resolves to a filled Button tone', () => {
  const tones = new Set<string>();
  for (const status of Object.values(TripStatus)) {
    tones.add(transitionActionMeta(status).tone);
  }
  for (const tone of tones) {
    assert.ok(['primary', 'success', 'danger', 'neutral'].includes(tone));
  }
});
