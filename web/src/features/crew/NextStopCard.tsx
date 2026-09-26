'use client';

import React, { useMemo } from 'react';
import type {
  StopResponse,
  TripEtaResponse,
  TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';
import { Badge, Button, Card } from '../../components/ui';
import { formatDistanceMeters } from '../../lib/format';
import { type CrewMessageParams } from './crew-i18n';
import { summarizeStopKids, stopCounterOf, type ArrivalLike } from './crew-progress';
import { buildCrewRouteUrl, isNavigableStop } from './navigation';

/**
 * Next-stop card — the first thing the crew sees on `/crew` (web counterpart
 * of mobile's `TripNavigationCard` + `NextStopKidCard`).
 *
 * Stop name, "Stop 4 of 8", server-computed distance/ETA (never invented
 * client-side: both come from the trip's ETA summary), who is waiting there,
 * and the **Navigate** hand-off. Navigate opens the same Google Maps URL-API
 * deep link the mobile app builds — turn-by-turn to the next stop with the
 * remaining stops as waypoints; a link, never a paid map SDK.
 */
export const NextStopCard: React.FC<{
  t: (key: string, params?: CrewMessageParams) => string;
  stops: StopResponse[];
  nextStop: StopResponse | null;
  eta: TripEtaResponse | null;
  students: TripStudentAttendanceResponse[];
  arrivals: ArrivalLike[];
}> = ({ t, stops, nextStop, eta, students, arrivals }) => {
  const counter = useMemo(
    () => (nextStop ? stopCounterOf(stops, nextStop.id) : null),
    [stops, nextStop],
  );
  const kids = useMemo(
    () => (nextStop ? summarizeStopKids(students, nextStop.id) : null),
    [students, nextStop],
  );
  const etaItem = useMemo(
    () => (nextStop ? (eta?.items.find((item) => item.stop_id === nextStop.id) ?? null) : null),
    [eta, nextStop],
  );

  const navigateUrl = useMemo(() => {
    if (!nextStop) return null;
    const upcoming = stops.filter(
      (stop) =>
        stop.sequence_number > nextStop.sequence_number &&
        !arrivals.some((arrival) => arrival.stop_id === stop.id) &&
        isNavigableStop(stop),
    );
    return buildCrewRouteUrl(nextStop, upcoming);
  }, [stops, nextStop, arrivals]);

  if (stops.length === 0) {
    return (
      <Card title={t('nextStop.title')}>
        <p className="muted">{t('nextStop.noStops')}</p>
      </Card>
    );
  }

  if (!nextStop) {
    return (
      <Card title={t('nextStop.title')}>
        <p className="muted">{t('nextStop.allDone')}</p>
      </Card>
    );
  }

  return (
    <Card title={t('nextStop.title')} className="next-stop-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p className="next-stop-name">{nextStop.name}</p>
          {counter && counter.position > 0 ? (
            <p className="muted" style={{ margin: '0.15rem 0 0' }}>
              {t('nextStop.stopOf', { position: counter.position, total: counter.total })}
            </p>
          ) : null}
        </div>
        {navigateUrl ? (
          <a
            className="btn btn-primary btn-lg"
            href={navigateUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('nextStop.navigate')}
          </a>
        ) : (
          <Button variant="secondary" size="lg" disabled>
            {t('nextStop.navigate')}
          </Button>
        )}
      </div>

      <div className="row" style={{ gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <Badge tone="info">
          {t('nextStop.distance')}:{' '}
          {etaItem && etaItem.distance_meters !== null
            ? formatDistanceMeters(etaItem.distance_meters)
            : t('nextStop.etaUnavailable')}
        </Badge>
        <Badge tone="info">
          {t('nextStop.eta')}:{' '}
          {etaItem && etaItem.eta_minutes !== null
            ? t('nextStop.etaMinutes', { count: etaItem.eta_minutes })
            : t('nextStop.etaUnavailable')}
        </Badge>
      </div>

      {kids ? (
        <div style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {kids.waiting > 0
              ? t('nextStop.kidsWaiting', { count: kids.waiting })
              : t('nextStop.kidsDone')}
          </p>
          {kids.waitingNames.length > 0 ? (
            <ul className="next-stop-kids">
              {kids.waitingNames.map((name, index) => (
                <li key={`${index}-${name}`}>{name}</li>
              ))}
              {kids.hiddenWaiting > 0 ? (
                <li className="muted">{t('nextStop.moreKids', { count: kids.hiddenWaiting })}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
        {navigateUrl ? t('nextStop.navigateHint') : t('nextStop.noCoordinates')}
      </p>
    </Card>
  );
};
