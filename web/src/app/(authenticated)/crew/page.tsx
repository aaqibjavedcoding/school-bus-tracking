'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TripStatus,
  type StopResponse,
  type TripStopArrivalResponse,
} from '@school-bus-tracking/shared-types';
import { isTripTrackingActive } from '@school-bus-tracking/validation';
import { Badge, Card, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { ManifestList } from '../../../features/attendance/ManifestList';
import {
  CREW_LANGUAGES,
  CREW_LANGUAGE_LABELS,
  isCrewLanguage,
  useCrewLanguage,
} from '../../../features/crew/crew-i18n';
import {
  appendTrailPoint,
  deriveNextStop,
  type TrailPoint,
} from '../../../features/crew/crew-progress';
import { CrewStopsPanel } from '../../../features/crew/CrewStopsPanel';
import { NextStopCard } from '../../../features/crew/NextStopCard';
import { SosPanel } from '../../../features/crew/SosPanel';
import { TripTrackerView } from '../../../features/tracking/TripTracker';
import {
  useCrewLocationShare,
  useLiveTripTracking,
} from '../../../features/tracking/useLiveTripTracking';
import { TripStatusActions } from '../../../features/trips/TripStatusActions';
import { useLoad } from '../../../hooks/useLoad';
import { useAuth } from '../../../features/auth/AuthProvider';
import { unwrapEnvelope } from '../../../lib/errors';
import {
  formatDateTime,
  tripStatusLabel,
  tripStatusTone,
  schoolDateOnly,
} from '../../../lib/format';
import { apiClient } from '../../../services/api';

function pickTodaysTrip<T extends { status: TripStatus; scheduled_start_at: string }>(
  trips: T[],
): T | null {
  const rank: Record<string, number> = {
    [TripStatus.IN_PROGRESS]: 0,
    [TripStatus.BOARDING]: 1,
    [TripStatus.SCHEDULED]: 2,
    [TripStatus.COMPLETED]: 3,
    [TripStatus.CANCELLED]: 4,
  };
  return (
    [...trips].sort((a, b) => {
      const byStatus = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (byStatus !== 0) return byStatus;
      return a.scheduled_start_at.localeCompare(b.scheduled_start_at);
    })[0] ?? null
  );
}

export default function CrewPage() {
  const { user } = useAuth();
  const { language, setLanguage, t } = useCrewLanguage();
  const { data, loading, error, reload, setData } = useLoad(async () => {
    const trips = unwrapEnvelope(
      await apiClient.listTrips({
        page: 1,
        limit: 20,
        date: schoolDateOnly(user?.school_timezone),
      }),
    ).items;
    const trip = pickTodaysTrip(trips);
    if (!trip) {
      return {
        trip: null,
        stops: [] as StopResponse[],
        manifest: null,
        arrivals: [] as TripStopArrivalResponse[],
        trips,
      };
    }
    const [stops, manifest, arrivals] = await Promise.all([
      apiClient.listRouteStops(trip.route_id),
      apiClient.listTripStudents(trip.id),
      // The crew's own arrived/skipped record — tolerated to fail: the table
      // still renders from the live ETA summary alone.
      apiClient.getTripArrivals(trip.id).catch(() => null),
    ]);
    return {
      trip,
      trips,
      stops: unwrapEnvelope(stops).items,
      manifest: unwrapEnvelope(manifest),
      arrivals: arrivals ? unwrapEnvelope(arrivals).items : [],
    };
  }, [user?.school_timezone]);

  const tripId = data?.trip?.id ?? null;
  const sharing = Boolean(data?.trip && isTripTrackingActive(data.trip.status));
  const gpsError = useCrewLocationShare(tripId, sharing);

  // One live subscription for the whole page: the next-stop card, the stops
  // table and the map all read the same socket-pushed ETA snapshot.
  const live = useLiveTripTracking(tripId);

  // Driven path: seeded from the server's location history, then extended by
  // every live fix — a separate line from the straight planned polyline.
  const [trail, setTrail] = useState<readonly TrailPoint[]>([]);
  useEffect(() => {
    setTrail([]);
    if (!tripId) return;
    let cancelled = false;
    void apiClient
      .getTripLocationHistory(tripId, { limit: 500 })
      .then((envelope) => {
        if (cancelled || !envelope.data) return;
        const points = envelope.data.items.map((item) => ({
          latitude: item.latitude,
          longitude: item.longitude,
        }));
        setTrail((current) => (current.length > points.length ? current : points));
      })
      .catch(() => {
        // No history yet (or endpoint unavailable) — the trail simply starts
        // from the first live fix.
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);
  useEffect(() => {
    if (!live.fix) return;
    const { latitude, longitude } = live.fix;
    setTrail((current) => appendTrailPoint(current, { latitude, longitude }));
  }, [live.fix]);

  const arrivals = useMemo(() => data?.arrivals ?? [], [data]);
  const nextStop = useMemo(
    () => (data ? deriveNextStop(data.stops, live.eta, arrivals) : null),
    [data, live.eta, arrivals],
  );

  const handleArrivalRecorded = useCallback(
    (arrival: TripStopArrivalResponse) => {
      setData((current) => {
        if (!current) return current;
        const rest = current.arrivals.filter((existing) => existing.stop_id !== arrival.stop_id);
        return { ...current, arrivals: [...rest, arrival] };
      });
    },
    [setData],
  );

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={10} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState
          message={error || "Could not load today's trip"}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const languagePicker = (
    <label className="crew-language-picker">
      <span className="sr-only">{t('lang.label')}</span>
      <select
        className="select"
        aria-label={t('lang.label')}
        value={language}
        onChange={(event) => {
          if (isCrewLanguage(event.target.value)) setLanguage(event.target.value);
        }}
      >
        {CREW_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {CREW_LANGUAGE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );

  if (!data.trip || !data.manifest) {
    return (
      <div className="page">
        <PageHeader
          title="Today's trip"
          description="No trip is assigned to you for today."
          actions={languagePicker}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Today's trip"
        description={`Scheduled ${formatDateTime(data.trip.scheduled_start_at)}`}
        actions={
          <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
            <Badge tone={tripStatusTone(data.trip.status)}>
              {tripStatusLabel(data.trip.status)}
            </Badge>
            {languagePicker}
          </div>
        }
      />
      <NextStopCard
        t={t}
        stops={data.stops}
        nextStop={nextStop}
        eta={live.eta}
        students={data.manifest.items}
        arrivals={arrivals}
      />
      <Card title="Trip status" description="Use these controls at the stop and on the road.">
        <TripStatusActions
          large
          trip={data.trip}
          onUpdated={(trip) => setData({ ...data, trip })}
        />
        {sharing ? (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Sharing this device's GPS with families and the school office.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            GPS sharing starts automatically when the trip is boarding or in progress.
          </p>
        )}
        {gpsError ? <p className="field-error">{gpsError}</p> : null}
      </Card>
      <SosPanel tripId={data.trip.id} />
      <CrewStopsPanel
        t={t}
        tripId={data.trip.id}
        stops={data.stops}
        nextStopId={nextStop?.id ?? null}
        eta={live.eta}
        students={data.manifest.items}
        arrivals={arrivals}
        onArrivalRecorded={handleArrivalRecorded}
      />
      <Card title={t('map.title')}>
        <TripTrackerView
          tripId={data.trip.id}
          stops={data.stops}
          nextStopId={nextStop?.id ?? null}
          trail={trail}
          mapControls={{
            fitRouteLabel: t('map.fitRoute'),
            followBusLabel: t('map.followBus'),
          }}
          plannedLineNote={t('map.legend.planned')}
          trailNote={t('map.legend.trail')}
          {...live}
        />
        <p className="muted" style={{ margin: '0.6rem 0 0' }}>
          {t('map.legend.planned')} {t('map.legend.trail')} {t('map.legend.next')}
        </p>
      </Card>
      <Card title="Passenger manifest">
        <ManifestList
          large
          canRecord
          manifest={data.manifest}
          onChange={(manifest) => setData({ ...data, manifest })}
        />
      </Card>
    </div>
  );
}
