/**
 * App Router entry point for `/api/v1/conductors/:id/pairing-qr`.
 *
 * Mints the short-lived, single-use QR pairing code for a crew member
 * (Mobile-UX Phase 4). The plaintext token is returned once and only its
 * SHA-256 digest is stored, so there is no "show it again".
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { postConductorsByIdPairingQr } from '../../../../../../server/api/staff';

export const POST = createRouteHandler(postConductorsByIdPairingQr);
