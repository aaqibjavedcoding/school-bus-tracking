import { Op } from 'sequelize';
import type {
  DeviceTokenRegisterRequest,
  DeviceTokenResponse,
  DeviceTokenUnregisterResponse,
} from '@school-bus-tracking/shared-types';
import { DeviceToken } from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { NOTIFICATIONS_DEVICE_TOKENS_REPOSITORY } from './notifications.constants';

/**
 * Device-token registration for OS-level push notifications.
 *
 * Every method derives the tenant and the user **only** from the verified JWT
 * (`(school_id, user_id)`): a client can never register, refresh or remove a
 * device token against another account or another school. Re-registering the
 * same token under a different user moves the row's ownership atomically, so
 * a device signed out by one user and signed in by another never keeps
 * receiving the previous user's notifications.
 */
export class DeviceTokensService {
  constructor(
    private readonly deviceTokens: typeof DeviceToken,
  ) {}

  /**
   * `POST /api/v1/notifications/devices` — register or refresh a token.
   *
   * Idempotent: the same device re-registering (login, app start, token
   * refresh) updates the existing row instead of creating a duplicate. A row
   * that is soft-deleted (or belongs to another user) is re-claimed by the
   * caller.
   */
  async register(
    actor: AuthenticatedRequestUser,
    dto: DeviceTokenRegisterRequest,
  ): Promise<DeviceTokenResponse> {
    const now = new Date();
    const existing = await this.deviceTokens.findOne({ where: { token: dto.token } });

    if (existing) {
      await existing.update({
        school_id: actor.school_id,
        user_id: actor.id,
        platform: dto.platform,
        is_active: true,
        last_seen_at: now,
      });
      return toResponse(existing);
    }

    const created = await this.deviceTokens.create({
      school_id: actor.school_id,
      user_id: actor.id,
      platform: dto.platform,
      token: dto.token,
      is_active: true,
      last_seen_at: now,
    });
    return toResponse(created);
  }

  /**
   * `DELETE /api/v1/notifications/devices/:token` — logout unregister.
   *
   * Deactivates only the caller's own row (same JWT scope as register) and is
   * idempotent: unregistering an unknown or already-inactive token still
   * answers success so logout never surfaces an error to the user.
   */
  async unregister(
    actor: AuthenticatedRequestUser,
    token: string,
  ): Promise<DeviceTokenUnregisterResponse> {
    await this.deviceTokens.update(
      { is_active: false },
      {
        where: {
          school_id: actor.school_id,
          user_id: actor.id,
          token,
        },
      },
    );
    return { removed: true };
  }

  /**
   * Every active push token of one user — the recipient list of push delivery.
   * Owned by the notification service; never exposed over HTTP.
   */
  async findActiveTokenStrings(schoolId: string, userId: string): Promise<string[]> {
    const rows = await this.deviceTokens.findAll({
      where: { school_id: schoolId, user_id: userId, is_active: true },
      attributes: ['token'],
      order: [['last_seen_at', 'DESC']],
    });
    return rows.map((row) => row.token);
  }

  /**
   * Deactivates tokens FCM reported as unregistered / invalid so they can
   * never be targeted again. No-op when the list is empty.
   */
  async deactivateTokens(schoolId: string, userId: string, tokens: string[]): Promise<void> {
    if (tokens.length === 0) {
      return;
    }
    await this.deviceTokens.update(
      { is_active: false },
      {
        where: {
          school_id: schoolId,
          user_id: userId,
          token: { [Op.in]: tokens },
          is_active: true,
        },
      },
    );
  }
}

/** Explicit projection — ORM internals never leak into a response. */
function toResponse(row: DeviceToken): DeviceTokenResponse {
  return {
    id: row.id,
    school_id: row.school_id,
    user_id: row.user_id,
    platform: row.platform,
    token: row.token,
    is_active: row.is_active,
    last_seen_at: toIsoString(row.last_seen_at),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
