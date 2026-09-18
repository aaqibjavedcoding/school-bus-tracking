'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Corrective patch — per-device outbox state, so a partially delivered
 * notification keeps retrying only the devices that still owe a delivery.
 *
 * Phase 2 stored a single `delivered_tokens` array, which the worker
 * *overwrote* on every attempt and interpreted as "any accepted device = row
 * sent". A device that failed transiently next to an accepted one therefore
 * was never retried, and nothing durable recorded which devices were still
 * owed the push.
 *
 * New column (the smallest state change that fixes it):
 *
 * - `delivery_pending_tokens` — the device tokens that were targeted and are
 *   still owed a provider-accepted delivery. Written in the same transaction
 *   as each attempt's outcome, so it survives restarts and is visible to any
 *   other instance. `NULL` means "no attempt made yet" (all currently active
 *   devices are targeted on the first attempt) — which also keeps every
 *   pre-existing row valid without a backfill.
 *
 * `delivered_tokens` keeps its meaning (provider-accepted devices only) but is
 * now *accumulated* across attempts instead of overwritten. No column is
 * rewritten, no existing row is invalidated, and no already-merged migration
 * is touched.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.addColumn('notifications', 'delivery_pending_tokens', {
    type: DataTypes.ARRAY(DataTypes.STRING(1024)),
    allowNull: true,
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.removeColumn('notifications', 'delivery_pending_tokens');
}
