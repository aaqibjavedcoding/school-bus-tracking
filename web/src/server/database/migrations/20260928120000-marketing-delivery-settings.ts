import type { QueryInterface } from 'sequelize';

/** Durable singleton settings and worker heartbeat for marketing delivery. */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE marketing_delivery_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      daily_send_cap INTEGER NOT NULL DEFAULT 500 CHECK (daily_send_cap BETWEEN 1 AND 10000),
      per_minute_send_cap INTEGER NOT NULL DEFAULT 60 CHECK (per_minute_send_cap BETWEEN 1 AND 300),
      delivery_timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
      allowed_window_start TIME NULL,
      allowed_window_end TIME NULL,
      last_worker_run_at TIMESTAMPTZ NULL,
      last_worker_claimed INTEGER NOT NULL DEFAULT 0,
      last_worker_sent INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT marketing_delivery_window_pair CHECK (
        (allowed_window_start IS NULL AND allowed_window_end IS NULL) OR
        (allowed_window_start IS NOT NULL AND allowed_window_end IS NOT NULL)
      )
    )
  `);
  await queryInterface.sequelize.query(`
    CREATE TABLE marketing_delivery_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_id UUID NOT NULL REFERENCES email_campaign_recipients(id) ON DELETE CASCADE,
      campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await queryInterface.sequelize.query(`
    CREATE INDEX marketing_delivery_attempts_attempted_at_idx
      ON marketing_delivery_attempts (attempted_at)
  `);
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS marketing_delivery_attempts');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS marketing_delivery_settings');
}
