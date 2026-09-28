/**
 * Run one safe marketing delivery sweep (manual, Render Cron, or scheduler).
 * Output is deliberately restricted to numeric metrics; no message, address,
 * token, provider transcript, or environment value is printed.
 */
import { loadEnvFilesEarly, bootstrapDatabase } from '../src/server/database/bootstrap';
import { getContainer } from '../src/server/container';

// Cron output is a machine-readable aggregate only. This also suppresses
// provider warnings whose upstream text could include addresses or SMTP data.
process.env.LOG_SILENT = 'true';

async function main(): Promise<void> {
  loadEnvFilesEarly();
  const sequelize = await bootstrapDatabase();
  if (!sequelize) throw new Error('database unavailable');
  await sequelize.authenticate();

  try {
    const summary = await getContainer().marketingDeliveryWorker().runOnce();
    if (summary.fatalError) throw new Error('delivery sweep failed');
    process.stdout.write(
      `${JSON.stringify({
        skipped: summary.skipped,
        claimed: summary.claimed,
        sent: summary.sent,
        retrying: summary.retrying,
        failed: summary.failed,
        suppressed: summary.suppressed,
        expired: summary.expired,
        cancelled: summary.cancelled,
        rateLimited: summary.rateLimited,
      })}\n`,
    );
  } finally {
    await sequelize.close();
    getContainer().sequelize = null;
  }
}

main().catch(() => {
  // Never include the underlying exception: database/provider errors can
  // contain connection strings or SMTP details.
  process.stderr.write('Marketing worker failed during configuration or database startup.\n');
  process.exitCode = 1;
});
