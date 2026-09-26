'use client';

import React, { useMemo, useState } from 'react';
import type {
  StopResponse,
  TripEtaResponse,
  TripStopArrivalResponse,
  TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';
import { withIdempotencyKey } from '@school-bus-tracking/api-client';
import { Badge, Button, Card, Textarea, useToast } from '../../components/ui';
import { getApiErrorMessage, unwrapEnvelope } from '../../lib/errors';
import { formatDistanceMeters } from '../../lib/format';
import { generateIdempotencyKey } from '../../lib/idempotency';
import { apiClient } from '../../services/api';
import { type CrewMessageParams } from './crew-i18n';
import { stopStateOf, summarizeStopKids } from './crew-progress';

/**
 * Stops table of the crew console — one row per route stop with its number,
 * name, children count, live ETA, arrival state and the two crew actions.
 *
 * **Arrived** and **Skip** call the crew stop-marking endpoints of PR 4/5
 * (`POST /trips/:tripId/stops/:stopId/arrive|skip`) through the existing
 * api-client methods. Every press mints one idempotency key, so the client's
 * own retry/refresh replays can never record a stop twice; a stop the
 * geofence already recorded answers `created: false` and is reported as
 * "already recorded", never as an error.
 *
 * The skip reason is required (min 3 characters, same rule the server
 * enforces) and captured in a small inline form — no browser `prompt()`,
 * which mobile browsers on a dashboard mount handle badly.
 */

const SKIP_REASON_MIN_LENGTH = 3;

export const CrewStopsPanel: React.FC<{
  t: (key: string, params?: CrewMessageParams) => string;
  tripId: string;
  stops: StopResponse[];
  nextStopId: string | null;
  eta: TripEtaResponse | null;
  students: TripStudentAttendanceResponse[];
  arrivals: TripStopArrivalResponse[];
  onArrivalRecorded: (arrival: TripStopArrivalResponse) => void;
}> = ({ t, tripId, stops, nextStopId, eta, students, arrivals, onArrivalRecorded }) => {
  const toast = useToast();
  const [busyStopId, setBusyStopId] = useState<string | null>(null);
  const [skippingStopId, setSkippingStopId] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState('');
  const [skipError, setSkipError] = useState<string | null>(null);

  const sortedStops = useMemo(
    () => [...stops].sort((a, b) => a.sequence_number - b.sequence_number),
    [stops],
  );
  const etaByStop = useMemo(() => {
    const map = new Map<string, { distance_meters: number | null; eta_minutes: number | null }>();
    for (const item of eta?.items ?? []) {
      map.set(item.stop_id, {
        distance_meters: item.distance_meters,
        eta_minutes: item.eta_minutes,
      });
    }
    return map;
  }, [eta]);

  const markArrived = async (stop: StopResponse) => {
    setBusyStopId(stop.id);
    try {
      const result = unwrapEnvelope(
        await apiClient.markTripStopArrived(
          tripId,
          stop.id,
          withIdempotencyKey(generateIdempotencyKey()),
        ),
      );
      onArrivalRecorded(result.arrival);
      toast.push(
        t(result.created ? 'stops.toast.recorded' : 'stops.toast.alreadyRecorded', {
          number: result.stop_sequence_number,
        }),
        'success',
      );
    } catch (error) {
      toast.push(getApiErrorMessage(error, t('stops.toast.failed')), 'danger');
    } finally {
      setBusyStopId(null);
    }
  };

  const confirmSkip = async (stop: StopResponse) => {
    const reason = skipReason.trim();
    if (reason.length < SKIP_REASON_MIN_LENGTH) {
      setSkipError(t('stops.skip.reasonTooShort'));
      return;
    }
    setSkipError(null);
    setBusyStopId(stop.id);
    try {
      const result = unwrapEnvelope(
        await apiClient.skipTripStop(
          tripId,
          stop.id,
          { reason },
          withIdempotencyKey(generateIdempotencyKey()),
        ),
      );
      onArrivalRecorded(result.arrival);
      toast.push(t('stops.toast.skipped', { number: result.stop_sequence_number }), 'success');
      setSkippingStopId(null);
      setSkipReason('');
    } catch (error) {
      toast.push(getApiErrorMessage(error, t('stops.toast.failed')), 'danger');
    } finally {
      setBusyStopId(null);
    }
  };

  const stateBadge = (state: 'arrived' | 'skipped' | 'pending', isNext: boolean) => {
    if (state === 'arrived') return <Badge tone="success">{t('stops.status.arrived')}</Badge>;
    if (state === 'skipped') return <Badge tone="warning">{t('stops.status.skipped')}</Badge>;
    if (isNext) return <Badge tone="info">{t('stops.status.next')}</Badge>;
    return <Badge tone="neutral">{t('stops.status.pending')}</Badge>;
  };

  return (
    <Card title={t('stops.title')} description={t('stops.description')}>
      <div className="table-wrap">
        <table className="data crew-stops-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t('stops.header.stop')}</th>
              <th scope="col">{t('stops.header.kids')}</th>
              <th scope="col">{t('stops.header.eta')}</th>
              <th scope="col">{t('stops.header.status')}</th>
              <th scope="col">{t('stops.header.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedStops.map((stop) => {
              const state = stopStateOf(stop.id, arrivals, eta?.items);
              const isNext = stop.id === nextStopId;
              const kids = summarizeStopKids(students, stop.id);
              const liveEta = etaByStop.get(stop.id) ?? null;
              const busy = busyStopId === stop.id;
              const skipOpen = skippingStopId === stop.id;
              return (
                <React.Fragment key={stop.id}>
                  <tr className={isNext ? 'crew-stop-next-row' : undefined}>
                    <td>{stop.sequence_number}</td>
                    <td>{stop.name}</td>
                    <td>
                      {kids.total}
                      {kids.waiting > 0 ? (
                        <span className="muted">
                          {' '}
                          · {t('stops.status.pending')}: {kids.waiting}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {state === 'pending' && liveEta && liveEta.eta_minutes !== null
                        ? `${t('nextStop.etaMinutes', { count: liveEta.eta_minutes })} · ${formatDistanceMeters(liveEta.distance_meters)}`
                        : '—'}
                    </td>
                    <td>{stateBadge(state, isNext)}</td>
                    <td>
                      {state === 'pending' ? (
                        <div className="table-actions">
                          <Button
                            variant="success"
                            disabled={busy}
                            onClick={() => void markArrived(stop)}
                          >
                            {t('stops.action.arrived')}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setSkippingStopId(skipOpen ? null : stop.id);
                              setSkipReason('');
                              setSkipError(null);
                            }}
                          >
                            {t('stops.action.skip')}
                          </Button>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                  {skipOpen && state === 'pending' ? (
                    <tr className="crew-skip-row">
                      <td colSpan={6}>
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor={`skip-reason-${stop.id}`}>
                            {t('stops.skip.reasonLabel')}
                          </label>
                          <Textarea
                            id={`skip-reason-${stop.id}`}
                            rows={2}
                            value={skipReason}
                            placeholder={t('stops.skip.reasonPlaceholder')}
                            onChange={(event) => setSkipReason(event.target.value)}
                          />
                          {skipError ? (
                            <span className="field-error" role="alert">
                              {skipError}
                            </span>
                          ) : null}
                          <div className="row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                            <Button
                              variant="danger"
                              disabled={busy}
                              onClick={() => void confirmSkip(stop)}
                            >
                              {t('stops.skip.confirm')}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setSkippingStopId(null);
                                setSkipReason('');
                                setSkipError(null);
                              }}
                            >
                              {t('stops.skip.cancel')}
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
