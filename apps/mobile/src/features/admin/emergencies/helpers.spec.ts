import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMERGENCY_STATUS_TRANSITIONS,
  EmergencyStatus,
  OPEN_EMERGENCY_STATUS_VALUES,
  isEmergencyStatusTransitionAllowed,
} from '@school-bus-tracking/shared-types';
import {
  emergencyActionLabel,
  emergencyStatusTone,
  isEmergencyActive,
  nextEmergencyActions,
} from './helpers.ts';

/**
 * The UI actions are the lifecycle the API enforces — these tests pin the two
 * together so the mobile buttons can never offer a transition the backend
 * would reject with a 409.
 */
describe('emergency lifecycle helpers', () => {
  it('offers acknowledge / resolve / cancel for an open alert', () => {
    assert.deepEqual(nextEmergencyActions(EmergencyStatus.OPEN), [
      EmergencyStatus.ACKNOWLEDGED,
      EmergencyStatus.RESOLVED,
      EmergencyStatus.CANCELLED,
    ]);
  });

  it('offers only resolve / cancel once acknowledged', () => {
    assert.deepEqual(nextEmergencyActions(EmergencyStatus.ACKNOWLEDGED), [
      EmergencyStatus.RESOLVED,
      EmergencyStatus.CANCELLED,
    ]);
  });

  it('offers nothing for a terminal alert', () => {
    assert.deepEqual(nextEmergencyActions(EmergencyStatus.RESOLVED), []);
    assert.deepEqual(nextEmergencyActions(EmergencyStatus.CANCELLED), []);
  });

  it('never offers a transition the shared contract forbids', () => {
    for (const from of Object.values(EmergencyStatus)) {
      for (const to of nextEmergencyActions(from)) {
        assert.equal(
          isEmergencyStatusTransitionAllowed(from, to),
          true,
          `${from} → ${to} is offered by the UI but rejected by the contract`,
        );
      }
      // …and the contract's allowed set is exactly what the UI offers.
      assert.deepEqual(
        [...nextEmergencyActions(from)].sort(),
        [...EMERGENCY_STATUS_TRANSITIONS[from]].sort(),
      );
    }
  });

  it('labels actions in plain operator language', () => {
    assert.equal(emergencyActionLabel(EmergencyStatus.ACKNOWLEDGED), 'Acknowledge');
    assert.equal(emergencyActionLabel(EmergencyStatus.RESOLVED), 'Resolve');
    assert.equal(emergencyActionLabel(EmergencyStatus.CANCELLED), 'Cancel alert');
  });

  it('tones open alerts as danger and closed ones as success', () => {
    assert.equal(emergencyStatusTone(EmergencyStatus.OPEN), 'danger');
    assert.equal(emergencyStatusTone(EmergencyStatus.ACKNOWLEDGED), 'warning');
    assert.equal(emergencyStatusTone(EmergencyStatus.RESOLVED), 'success');
    assert.equal(emergencyStatusTone(EmergencyStatus.CANCELLED), 'success');
  });

  it('agrees with the shared "needs attention" status list', () => {
    const active = Object.values(EmergencyStatus).filter(isEmergencyActive);
    assert.deepEqual(active.sort(), [...OPEN_EMERGENCY_STATUS_VALUES].sort());
  });
});
