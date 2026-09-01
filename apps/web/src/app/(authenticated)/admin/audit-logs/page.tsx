'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { apiClient } from '@/services/api';
import { Card } from '@/components/Card';

/**
 * Audit Log UI for Super Admin.
 *
 * Displays platform-level audit events with:
 * - Action, actor, entity, timestamp, school, safe metadata
 * - Filters by action, entity type, school, date range
 * - Pagination
 *
 * Never exposes secrets (passwords, tokens, etc.).
 */

interface AuditLogEntry {
  id: string;
  school_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditLogResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (actionFilter) params.set('action', actionFilter);
      if (entityFilter) params.set('entity_type', entityFilter);

      const response = await apiClient.get<AuditLogResponse>(
        `/audit-logs?${params.toString()}`,
      );

      if (response.data) {
        setLogs(response.data.items);
        setTotal(response.data.total);
        setTotalPages(response.data.totalPages);
      } else {
        setError(response.error?.message ?? 'Failed to load audit logs');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Only Super Admin should see this page.
  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="p-6">
        <Card title="Audit Logs">
          <div className="text-center py-8">
            <p className="text-gray-600">Access denied. Super Admin only.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <span className="text-sm text-gray-500">{total} events</span>
      </div>

      {/* Filters */}
      <Card title="Filters">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Action
            </label>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">All actions</option>
              <option value="school.create">School Create</option>
              <option value="school.update">School Update</option>
              <option value="school.activate">School Activate</option>
              <option value="school.deactivate">School Deactivate</option>
              <option value="student.create">Student Create</option>
              <option value="student.update">Student Update</option>
              <option value="student.deactivate">Student Deactivate</option>
              <option value="emergency.sos">Emergency SOS</option>
              <option value="emergency.acknowledge">Emergency Acknowledge</option>
              <option value="emergency.resolve">Emergency Resolve</option>
              <option value="auth.login">Login</option>
              <option value="auth.password_reset">Password Reset</option>
              <option value="subscription.assign">Subscription Assign</option>
              <option value="subscription.change">Subscription Change</option>
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Entity Type
            </label>
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">All entities</option>
              <option value="school">School</option>
              <option value="user">User</option>
              <option value="student">Student</option>
              <option value="guardian">Guardian</option>
              <option value="bus">Bus</option>
              <option value="route">Route</option>
              <option value="trip">Trip</option>
              <option value="document">Document</option>
              <option value="emergency">Emergency</option>
              <option value="plan">Plan</option>
              <option value="subscription">Subscription</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Error state */}
      {error && (
        <Card title="Error">
          <div className="text-center py-4">
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchLogs}
              className="mt-2 text-blue-600 hover:underline text-sm"
            >
              Retry
            </button>
          </div>
        </Card>
      )}

      {/* Loading state */}
      {loading && (
        <Card title="Loading">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-2 text-gray-500">Loading audit logs...</p>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && logs.length === 0 && (
        <Card title="Audit Logs">
          <div className="text-center py-8">
            <p className="text-gray-500">No audit logs found.</p>
          </div>
        </Card>
      )}

      {/* Audit log table */}
      {!loading && logs.length > 0 && (
        <Card title="Audit Events">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">
                    Timestamp
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">
                    Action
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">
                    Actor
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">
                    Entity
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">
                    School
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">
                    Request ID
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-600">
                      {formatTimestamp(log.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-700">
                      {log.actor_name ?? log.actor_user_id ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {log.entity_type}
                      {log.entity_id && (
                        <span className="text-xs text-gray-400 ml-1">
                          ({log.entity_id.slice(0, 8)}…)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {log.school_id ? log.school_id.slice(0, 8) + '…' : '—'}
                    </td>
                    <td className="py-3 px-4 text-gray-400 font-mono text-xs">
                      {log.request_id ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between py-3 px-4 border-t">
              <span className="text-sm text-gray-500">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString();
  } catch {
    return isoString;
  }
}
