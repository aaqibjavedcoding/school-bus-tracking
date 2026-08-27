import type { ModelCtor } from 'sequelize-typescript';
import type { BaseModel } from './base.model';

export { BaseModel } from './base.model';
export type { BaseModelAttributes } from './base.model';

/**
 * Concrete Sequelize model registry.
 *
 * Domain models are registered here as they are introduced in upcoming
 * Phase 2 tasks (e.g. Tenant, School, User, Bus, Route, Stop, Student).
 * The schema itself is migration-driven — models are never synced.
 */
export const models: ModelCtor<BaseModel>[] = [];
