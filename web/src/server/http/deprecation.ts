/**
 * RFC 9745 (`Deprecation`) + RFC 8594 (`Sunset`) retirement signals, shared by
 * the route runtime and the specs.
 *
 * A deprecated endpoint announces its successor and its sunset date on *every*
 * response, so an API client that still calls the legacy surface can warn and
 * migrate without a surprise cut-off. A surface whose writes are permanently
 * closed (the retired `route_assignments` roster — `docs/operating-model.md`
 * §6.3, Phase 4) additionally answers every non-read verb with 410 Gone.
 */
import { GoneException } from '../framework';

export interface DeprecationDeclaration {
  /** HTTP-date (RFC 7231, GMT) marking the planned end of the surface. */
  sunset: string;
  /** Successor resource path, emitted via `Link: <…>; rel="success-version"`. */
  successor?: string;
  /** When true, state-changing verbs on this route permanently fail with 410. */
  retiredWrite?: boolean;
  /** Human-readable message carried by the 410 error body. */
  retiredMessage?: string;
}

/** Sets the Deprecation / Sunset / Link headers on one outgoing header set. */
export function applyDeprecationHeaders(
  headers: Headers,
  declaration: DeprecationDeclaration,
): void {
  headers.set('Deprecation', 'true');
  headers.set('Sunset', declaration.sunset);
  if (declaration.successor) {
    headers.set('Link', `<${declaration.successor}>; rel="success-version"`);
  }
}

/** Throws 410 Gone when a retired endpoint receives a state-changing verb. */
export function assertEndpointNotRetired(
  declaration: DeprecationDeclaration | undefined,
  method: string,
): void {
  if (declaration?.retiredWrite && method !== 'GET' && method !== 'HEAD') {
    throw new GoneException(
      declaration.retiredMessage ?? 'This endpoint has been retired and no longer accepts writes.',
    );
  }
}
