import * as bcrypt from 'bcryptjs';
import { getContainer } from '../src/server/container';
import { bootstrapDatabase, loadEnvFilesEarly } from '../src/server/database/bootstrap';
import {
  normalizeSuperAdminEmail,
  SUPER_ADMIN_ROLE_VALUE,
  updatePasswordHashForExactlyOneSuperAdmin,
  validateSuperAdminPassword,
} from '../src/server/database/super-admin-password';
import { User } from '../src/server/database/models';

const SAFE_ERRORS = new Set([
  'SUPER_ADMIN_EMAIL is required.',
  'NEW_SUPER_ADMIN_PASSWORD is required.',
  'The platform super-admin password must be at least 16 characters.',
  'The platform super-admin password must not equal the email address.',
  'Expected exactly one matching SUPER_ADMIN account.',
  'Expected exactly one SUPER_ADMIN account to be updated.',
  'Database connection is unavailable.',
]);

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) {
    return error.message;
  }
  return 'Super admin password rotation failed.';
}

async function main(): Promise<void> {
  const email = normalizeSuperAdminEmail(process.env.SUPER_ADMIN_EMAIL);
  const password = process.env.NEW_SUPER_ADMIN_PASSWORD;
  if (password === undefined || password.length === 0) {
    throw new Error('NEW_SUPER_ADMIN_PASSWORD is required.');
  }
  validateSuperAdminPassword(email, password);

  const passwordHash = await bcrypt.hash(password, 12);
  const sequelize = await bootstrapDatabase();
  if (!sequelize) {
    throw new Error('Database connection is unavailable.');
  }

  try {
    await sequelize.transaction(async (transaction) => {
      await updatePasswordHashForExactlyOneSuperAdmin(
        {
          async findSuperAdminsByEmail(matchingEmail) {
            const matches = await User.unscoped().findAll({
              where: { role: SUPER_ADMIN_ROLE_VALUE, email: matchingEmail },
              attributes: ['id'],
              transaction,
              lock: transaction.LOCK.UPDATE,
            });
            return matches.map(({ id }) => ({ id }));
          },
          async updatePasswordHash(id, matchingEmail, hash) {
            const [updatedCount] = await User.unscoped().update(
              { password_hash: hash },
              {
                where: { id, role: SUPER_ADMIN_ROLE_VALUE, email: matchingEmail },
                transaction,
              },
            );
            return updatedCount;
          },
        },
        email,
        passwordHash,
      );
    });
  } finally {
    try {
      await sequelize.close();
    } finally {
      getContainer().sequelize = null;
    }
  }

  process.stdout.write('updated\n');
}

// Prevent routine bootstrap logs from appearing alongside the one-word result.
process.env.LOG_SILENT = 'true';
process.env.DB_LOGGING = 'false';
loadEnvFilesEarly();

main().catch((error: unknown) => {
  process.stderr.write(`${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
