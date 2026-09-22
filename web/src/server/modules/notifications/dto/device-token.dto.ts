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
  @IsString({ message: 'Please enter a valid device token.' })
  @IsNotEmpty({ message: 'Please enter the device token.' })
  @MaxLength(DEVICE_TOKEN_MAX_LENGTH, {
    message: `Please enter at most ${DEVICE_TOKEN_MAX_LENGTH} characters for the device token.`,
  })
  @Transform(trimToken)
  token!: string;

  @IsIn(DEVICE_PLATFORM_VALUES, {
    message: `Please select a valid device platform (one of: ${DEVICE_PLATFORM_VALUES.join(', ')}).`,
  })
  platform!: DevicePlatform;
}
