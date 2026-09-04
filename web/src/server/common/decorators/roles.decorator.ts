import { UserRole } from '@school-bus-tracking/shared-types';
import { SetMetadata } from '../../framework';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
