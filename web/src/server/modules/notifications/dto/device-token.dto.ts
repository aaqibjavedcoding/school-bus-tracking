import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  DEVICE_PLATFORM_VALUES,
  type DevicePlatform,
  type DeviceTokenRegisterRequest,
} from '@school-bus-tracking/shared-types';
import { DEVICE_TOKEN_MAX_LENGTH } from '../notifications.constants';

const trimToken = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `POST /api/v1/notifications/devices` (any school role).
 *
 * Deliberately contains no `school_id` and no `user_id`: the API derives both
 * from the verified JWT, so a client can only register a device against its
 * own account. The `token` is the device's own native push token (FCM/APNs)
 * — the only identity a caller could "forge" is its own device.
 */
export class RegisterDeviceTokenDto implements DeviceTokenRegisterRequest {
  @IsString({ message: 'token must be a string' })
  @IsNotEmpty({ message: 'token is required' })
  @MaxLength(DEVICE_TOKEN_MAX_LENGTH, {
    message: `token must be at most ${DEVICE_TOKEN_MAX_LENGTH} characters`,
  })
  @Transform(trimToken)
  token!: string;

  @IsIn(DEVICE_PLATFORM_VALUES, {
    message: `platform must be one of: ${DEVICE_PLATFORM_VALUES.join(', ')}`,
  })
  platform!: DevicePlatform;
}
