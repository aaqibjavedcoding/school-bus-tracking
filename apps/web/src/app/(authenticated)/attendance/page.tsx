'use client';

import React, { useState } from 'react';
import { Card, ErrorState, PageHeader, Select, Skeleton } from '../../../components/ui';
import { ManifestList } from '../../../features/attendance/ManifestList';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { formatDateTime, tripStatusLabel, utcDateOnly } from '../../../lib/format';
import { apiClient } from '../../../services/api';

export default function AttendancePage() {
  const [tripId, setTripId] = useState('');
  const trips = useLoad(async () => {
    const list = unwrapEnvelope(
      await apiClient.listTrips({ page: 1, limit: 50, date: utcDateOnly() }),
    );
    const first = list.items[0]?.id ?? '';
    if (!tripId && first) setTripId(first);
    return list.items;
  }, []);

  const manifest = useLoad(async () => {
    const id = tripId || trips.data?.[0]?.id;
    if (!id) return null;
    return unwrapEnvelope(await apiClient.listTripStudents(id));
  }, [tripId, trips.data?.[0]?.id]);

  return (
    <div className="page">
      <PageHeader title="Attendance" description="Board and drop students for today's trips." />
      {trips.loading ? (
        <Skeleton lines={6} />
      ) : trips.error ? (
        <ErrorState message={trips.error} onRetry={() => void trips.reload()} />
      ) : (
        <Card>
          <Select
            value={tripId}
            placeholder="Select trip"
            onChange={(event) => setTripId(event.target.value)}
            options={(trips.data ?? []).map((trip) => ({
              value: trip.id,
              label: `${tripStatusLabel(trip.status)} · ${formatDateTime(trip.scheduled_start_at)}`,
            }))}
          />
        </Card>
      )}
      {manifest.loading ? (
        <Skeleton lines={8} />
      ) : manifest.error ? (
        <ErrorState message={manifest.error} onRetry={() => void manifest.reload()} />
      ) : manifest.data ? (
        <ManifestList
          manifest={manifest.data}
          canRecord
          onChange={(next) => manifest.setData(next)}
        />
      ) : (
        <p className="muted">Pick a trip to see its manifest.</p>
      )}
    </div>
  );
}
