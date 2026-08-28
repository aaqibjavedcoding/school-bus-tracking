'use client';

import React, { useMemo, useState } from 'react';
import {
  TripAttendanceStatus,
  type TripStudentAttendanceResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { getApiErrorMessage } from '../../lib/errors';
import { attendanceStatusLabel, attendanceTone, formatTime, fullName } from '../../lib/format';
import { Badge, Button, useToast } from '../../components/ui';

export const ManifestList: React.FC<{
  manifest: TripStudentManifestResponse;
  canRecord?: boolean;
  large?: boolean;
  onChange: (manifest: TripStudentManifestResponse) => void;
}> = ({ manifest, canRecord = false, large = false, onChange }) => {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const result: Array<{
      stop_id: string;
      stop_name: string;
      sequence: number;
      items: TripStudentAttendanceResponse[];
    }> = [];
    for (const item of manifest.items) {
      const last = result[result.length - 1];
      if (last && last.stop_id === item.stop_id) {
        last.items.push(item);
      } else {
        result.push({
          stop_id: item.stop_id,
          stop_name: item.stop_name,
          sequence: item.stop_sequence_number,
          items: [item],
        });
      }
    }
    return result;
  }, [manifest.items]);

  const act = async (studentId: string, action: 'board' | 'drop') => {
    setBusyId(studentId);
    try {
      const envelope =
        action === 'board'
          ? await apiClient.boardTripStudent(manifest.trip_id, studentId)
          : await apiClient.dropTripStudent(manifest.trip_id, studentId);
      if (!envelope.data) throw new Error(envelope.message || 'Attendance update failed');
      const updated = envelope.data;
      const nextItems = manifest.items.map((item) =>
        item.student_id === studentId && updated ? updated : item,
      );
      const summary = {
        total: nextItems.length,
        pending: nextItems.filter((item) => item.status === TripAttendanceStatus.PENDING).length,
        boarded: nextItems.filter((item) => item.status === TripAttendanceStatus.BOARDED).length,
        dropped: nextItems.filter((item) => item.status === TripAttendanceStatus.DROPPED).length,
      };
      onChange({ ...manifest, items: nextItems, summary });
      toast.push(action === 'board' ? 'Student boarded.' : 'Student dropped off.', 'success');
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  if (manifest.items.length === 0) {
    return (
      <div className="empty">
        <h3>No students on this trip</h3>
        <p className="muted">Assign home stops on the route to build a manifest.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        {manifest.summary.boarded} on board · {manifest.summary.pending} waiting ·{' '}
        {manifest.summary.dropped} dropped
      </p>
      {groups.map((group) => (
        <section key={group.stop_id} className="card">
          <h3>
            Stop {group.sequence}: {group.stop_name}
          </h3>
          {group.items.map((item) => (
            <div key={item.student_id} className="manifest-item">
              <div>
                <strong>{fullName(item)}</strong>
                <div className="muted">
                  {item.admission_number}
                  {item.grade_level ? ` · ${item.grade_level}` : ''}
                  {item.boarded_at ? ` · boarded ${formatTime(item.boarded_at)}` : ''}
                  {item.dropped_at ? ` · dropped ${formatTime(item.dropped_at)}` : ''}
                </div>
              </div>
              <div className="row">
                <Badge tone={attendanceTone(item.status)}>
                  {attendanceStatusLabel(item.status)}
                </Badge>
                {canRecord && item.status === TripAttendanceStatus.PENDING ? (
                  <Button
                    size={large ? 'touch' : 'md'}
                    disabled={busyId === item.student_id}
                    onClick={() => void act(item.student_id, 'board')}
                  >
                    Board
                  </Button>
                ) : null}
                {canRecord && item.status === TripAttendanceStatus.BOARDED ? (
                  <Button
                    variant="success"
                    size={large ? 'touch' : 'md'}
                    disabled={busyId === item.student_id}
                    onClick={() => void act(item.student_id, 'drop')}
                  >
                    Drop
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
};
