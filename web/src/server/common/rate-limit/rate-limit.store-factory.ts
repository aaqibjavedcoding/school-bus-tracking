import { Logger } from '../../framework';
import { MemoryRateLimitStore, RateLimitStore } from './rate-limit.store';

/**
 * Message used when a deployment asks for a distributed store that this phase
 * intentionally does not ship. Failing fast is the safe behaviour: silently
 * falling back to process-local counters would multiply every configured
 * limit by the number of API instances without anyone noticing.
 */
export const REDIS_RATE_LIMIT_UNAVAILABLE_MESSAGE =
  'RATE_LIMIT_STORE=redis is not implemented in this phase. Use RATE_LIMIT_STORE=memory (single instance) — see docs/security.md for the distributed-limiter production dependency.';

/** Builds the configured store behind the {@link RateLimitStore} abstraction. */
export function createRateLimitStore(
  store: string,
  logger = new Logger('RateLimit'),
): RateLimitStore {
  if (store === 'redis') {
    throw new Error(REDIS_RATE_LIMIT_UNAVAILABLE_MESSAGE);
  }
  if (store !== 'memory') {
    throw new Error(`Unknown RATE_LIMIT_STORE="${store}". Supported values: memory.`);
  }
  logger.log('Rate limiting uses the process-local memory store (single API instance).');
  return new MemoryRateLimitStore();
}
