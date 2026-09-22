'use client';

/**
 * Crew mobile-login controls (Mobile-UX Phase 4 — staff page wiring).
 *
 * The modal presents the two admin actions that mint a credential for a
 * DRIVER/CONDUCTOR phone:
 *
 * - **PIN**: an administrator types a fresh 4-digit PIN, confirms it, and
 *   the modal POSTs it to `PUT /drivers/:id/pin` / `PUT /conductors/:id/pin`.
 *   The PIN is held in local state only and is **never** echoed back,
 *   re-rendered, written to a log line or returned by the server — the API
 *   contract confirms `pin_hash` and the plaintext is unrecoverable, so the
 *   modal collapses to a "PIN set" badge once the response comes back.
 * - **QR**: an administrator triggers `POST /drivers/:id/pairing-qr` and the
 *   server returns a short-lived pairing payload. The modal renders it as a
 *   vector QR (the helpers in `./crew-login.ts` already encode the matrix
 *   and the SVG path) and ticks a `m:ss` countdown from the response's
 *   `expires_at`. When the countdown lapses the QR is hidden and the
 *   "Regenerate" button is the only path forward.
 *
 * Pure logic (QR matrix, SVG path, countdown clamp, PIN validation, badge
 * tone) lives in `./crew-login.ts`; this file is the thin component over it.
 * All payload formats are the shared contract (`encodeCrewPairingPayload` in
 * `@school-bus-tracking/validation`) so the admin console and the mobile
 * scanner cannot disagree about the wire format.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CrewPairingResponse, CrewPinSetResponse, StaffResponse } from '@school-bus-tracking/shared-types';
import { CREW_PIN_LENGTH } from '@school-bus-tracking/validation';
import { Badge, Button, ConfirmDialog, Field, Modal, PasswordInput } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { getApiErrorMessage } from '../../lib/errors';
import {
  normalizePinInput,
  pairingCountdown,
  pinBadge,
  qrToSvg,
  validatePinDraft,
} from './crew-login';

export type CrewLoginModalMode = 'pin' | 'qr';

/**
 * What the staff row already knows about the person's mobile-login state.
 *
 * Both actions are available regardless of the current state: an admin can
 * re-issue a PIN at any time (the server `forget`s the lockout too — see
 * `CrewAuthService.setPin` and the docs/security section on lockouts), and
 * can regenerate a QR while one is still live (the server supersedes the
 * old row atomically).
 */
export interface CrewLoginModalProps {
  open: boolean;
  /** What the modal is currently showing. */
  mode: CrewLoginModalMode;
  /** The crew member the modal acts on. Required when `open` is `true`. */
  person: StaffResponse | null;
  /** Called when the user closes the modal; never triggers any API call. */
  onClose: () => void;
  /**
   * Submit a brand-new PIN. The parent must call `PUT /drivers/:id/pin` (or
   * the conductor equivalent). Returning a `CrewPinSetResponse` switches the
   * modal into the "PIN set" view; throwing keeps the form in place and
   * surfaces the error inline.
   */
  onSubmitPin: (person: StaffResponse, pin: string) => Promise<CrewPinSetResponse>;
  /**
   * Mint a new pairing QR. The parent must call `POST /drivers/:id/pairing-qr`
   * (or the conductor equivalent) and return the server payload. Throwing
   * surfaces the error inline and leaves the modal ready for a retry.
   */
  onCreatePairing: (person: StaffResponse) => Promise<CrewPairingResponse>;
}

/**
 * Live state of the modal — the values that drive the form and the QR view.
 * Kept in component state (not React context) so every open/close cycle
 * starts from a clean slate.
 */
interface ModalState {
  // PIN form
  pin: string;
  confirm: string;
  pinTouched: boolean;
  // Inline API feedback (a thrown error surfaces as `error`; success flips `savedAt`).
  error: string | null;
  savedAt: string | null;
  // QR view
  pairing: CrewPairingResponse | null;
  // Single timer for the countdown; cleared on unmount and on regenerate.
  nowMs: number;
}

const INITIAL_STATE: ModalState = {
  pin: '',
  confirm: '',
  pinTouched: false,
  error: null,
  savedAt: null,
  pairing: null,
  nowMs: Date.now(),
};

export const CrewLoginModal: React.FC<CrewLoginModalProps> = ({
  open,
  mode,
  person,
  onClose,
  onSubmitPin,
  onCreatePairing,
}) => {
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [state, setState] = useState<ModalState>(INITIAL_STATE);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state whenever the modal opens or its target person changes.
  // (Re-using the modal across rows was the source of a previous "stale
  // PIN for the wrong driver" bug; the dependency on `person?.id` makes
  // every open a clean slate.)
  useEffect(() => {
    if (open) {
      setState({ ...INITIAL_STATE, nowMs: Date.now() });
      setBusy(false);
      setConfirmReset(false);
    }
  }, [open, person?.id]);

  // 1 Hz ticker for the countdown, only when the modal is open and showing a
  // live pairing. The hook is unconditional so React's rules-of-hooks stay
  // satisfied; the body short-circuits when there is nothing to tick.
  useEffect(() => {
    if (!open || mode !== 'qr' || !state.pairing) return undefined;
    const handle = window.setInterval(() => {
      setState((current) => ({ ...current, nowMs: Date.now() }));
    }, 1000);
    return () => window.clearInterval(handle);
  }, [open, mode, state.pairing]);

  const badge = useMemo(() => (person ? pinBadge(person) : null), [person]);
  const countdown = useMemo(
    () => pairingCountdown(state.pairing?.expires_at ?? null, state.nowMs),
    [state.pairing, state.nowMs],
  );

  const onPinChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizePinInput(event.target.value);
    setState((current) => ({
      ...current,
      pin: normalized,
      pinTouched: true,
      error: null,
    }));
  }, []);

  const onConfirmChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizePinInput(event.target.value);
    setState((current) => ({ ...current, confirm: normalized, error: null }));
  }, []);

  const submitPin = useCallback(async () => {
    if (!person) return;
    const pinError = validatePinDraft(state.pin);
    if (pinError) {
      setState((current) => ({ ...current, error: pinError }));
      return;
    }
    if (state.pin !== state.confirm) {
      setState((current) => ({ ...current, error: 'PIN entries do not match' }));
      return;
    }
    setBusy(true);
    try {
      const response = await onSubmitPin(person, state.pin);
      // Wipe the plaintext PIN from state as soon as the response comes back.
      // The modal collapses to a "PIN set" badge; the user can no longer read
      // back what they typed and cannot reach it again until they reopen.
      setState((current) => ({
        ...current,
        pin: '',
        confirm: '',
        pinTouched: false,
        error: null,
        savedAt: response.pin_updated_at,
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: getApiErrorMessage(error) }));
    } finally {
      setBusy(false);
    }
  }, [person, state.pin, state.confirm, onSubmitPin]);

  const submitPairing = useCallback(async () => {
    if (!person) return;
    setBusy(true);
    try {
      const response = await onCreatePairing(person);
      setState((current) => ({
        ...current,
        pairing: response,
        error: null,
        nowMs: Date.now(),
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: getApiErrorMessage(error) }));
    } finally {
      setBusy(false);
    }
  }, [person, onCreatePairing]);

  const onConfirmReset = useCallback(() => {
    setConfirmReset(false);
    setState((current) => ({ ...current, pin: '', confirm: '', pinTouched: false, error: null }));
  }, []);

  // ── Render guards ───────────────────────────────────────────────────────

  if (!open || !person) return null;

  // ── PIN view ────────────────────────────────────────────────────────────
  if (mode === 'pin') {
    const pinIsSet = state.savedAt !== null;
    const pinIsAlreadySet = badge?.label === 'PIN set' && !pinIsSet;
    const pinIsUnknown = badge?.label === 'PIN unknown';
    const showPinForm = !pinIsSet && (confirmReset || !pinIsAlreadySet);

    return (
      <Modal
        title={`Mobile PIN — ${person.first_name} ${person.last_name}`}
        description="The PIN is entered on the driver's or conductor's phone after they scan the pairing QR."
        open={open}
        onClose={onClose}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="muted">Current status:</span>
            <Badge tone={badge?.tone ?? 'neutral'}>{badge?.label ?? 'Unknown'}</Badge>
            {badge?.caption ? <span className="muted">— {badge.caption}</span> : null}
          </div>

          {pinIsAlreadySet ? (
            <div
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                padding: '0.85rem',
              }}
            >
              <p style={{ margin: 0 }}>
                A PIN is already set for this account. You cannot read it back; set a new one only if the
                crew member has lost it.
              </p>
              <div>
                <Button variant="secondary" onClick={() => setConfirmReset(true)} disabled={busy}>
                  Reset PIN
                </Button>
              </div>
            </div>
          ) : null}

          {showPinForm ? (
            <>
              <Field
                id="crew-pin"
                label={`New ${CREW_PIN_LENGTH}-digit PIN`}
                hint={`Must be exactly ${CREW_PIN_LENGTH} digits. The PIN is never stored in plain text and never returned by the API.`}
                error={state.pinTouched && state.pin.length > 0 ? validatePinDraft(state.pin) ?? undefined : undefined}
              >
                <PasswordInput
                  ref={pinInputRef}
                  id="crew-pin"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={CREW_PIN_LENGTH}
                  value={state.pin}
                  onChange={onPinChange}
                  placeholder="••••"
                />
              </Field>
              <Field
                id="crew-pin-confirm"
                label="Confirm PIN"
                error={
                  state.confirm.length > 0 && state.confirm !== state.pin
                    ? 'PIN entries do not match'
                    : undefined
                }
              >
                <PasswordInput
                  id="crew-pin-confirm"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={CREW_PIN_LENGTH}
                  value={state.confirm}
                  onChange={onConfirmChange}
                  placeholder="••••"
                />
              </Field>
              {state.error ? (
                <p className="field-error" role="alert" style={{ margin: 0 }}>
                  {state.error}
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitPin()}
                  disabled={busy || state.pin.length !== CREW_PIN_LENGTH || state.pin !== state.confirm}
                >
                  {busy ? 'Saving…' : pinIsUnknown ? 'Set PIN' : 'Reset PIN'}
                </Button>
              </div>
            </>
          ) : null}

          {pinIsSet ? (
            <div
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                padding: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Badge tone="success">PIN set</Badge>
                <span className="muted">
                  Last set: {state.savedAt ? formatDateTime(state.savedAt) : 'just now'}
                </span>
              </div>
              <p style={{ margin: 0 }}>
                The PIN is hashed server-side and is unrecoverable. Close this dialog or reset the PIN again
                if the crew member has lost it.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : null}
        </div>
        <ConfirmDialog
          open={confirmReset}
          title="Reset the PIN?"
          message="The crew member will need to be told the new PIN, or you will need to generate a pairing QR for their next login."
          confirmLabel="Reset"
          busy={busy}
          onCancel={() => setConfirmReset(false)}
          onConfirm={onConfirmReset}
        />
      </Modal>
    );
  }

  // ── QR view ─────────────────────────────────────────────────────────────

  // The QR payload the server returned (prefixed per
  // `encodeCrewPairingPayload`). The matrix helpers in `crew-login.ts`
  // produce a scannable square plus the SVG path; the modal wraps it in a
  // `viewBox` with the required quiet zone on every edge.
  const qrPayload = state.pairing?.payload ?? '';
  const svg = qrPayload ? qrToSvg(qrPayload) : null;

  return (
    <Modal
      title={`Pairing QR — ${person.first_name} ${person.last_name}`}
      description="The driver or conductor scans this code on their phone to pair the device. The code is single-use and short-lived."
      open={open}
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', alignItems: 'center' }}>
        {!state.pairing ? (
          <>
            <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
              Generate a fresh pairing QR. The crew member has 5 minutes (default TTL) to scan it before it
              expires.
            </p>
            {state.error ? (
              <p className="field-error" role="alert" style={{ margin: 0 }}>
                {state.error}
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void submitPairing()} disabled={busy}>
                {busy ? 'Generating…' : 'Generate QR'}
              </Button>
            </div>
          </>
        ) : countdown.expired ? (
          <>
            <Badge tone="warning">QR expired</Badge>
            <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
              This code can no longer be redeemed. Generate a fresh one when the crew member is ready to
              scan.
            </p>
            {state.error ? (
              <p className="field-error" role="alert" style={{ margin: 0 }}>
                {state.error}
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button onClick={() => void submitPairing()} disabled={busy}>
                {busy ? 'Generating…' : 'Regenerate'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Badge tone="success">QR live — {countdown.label} remaining</Badge>
            {svg ? (
              <svg
                role="img"
                aria-label="Pairing QR code"
                viewBox={`0 0 ${svg.size} ${svg.size}`}
                width={240}
                height={240}
                style={{
                  background: '#ffffff',
                  padding: 0,
                  border: '1px solid var(--border, #e2e8f0)',
                }}
              >
                <rect x={0} y={0} width={svg.size} height={svg.size} fill="#ffffff" />
                <path d={svg.path} fill="#000000" shapeRendering="crispEdges" />
              </svg>
            ) : null}
            <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
              Have the crew member open the app and choose &ldquo;QR scan&rdquo; on the login screen. The code
              is single-use and cannot be recovered.
            </p>
            {state.error ? (
              <p className="field-error" role="alert" style={{ margin: 0 }}>
                {state.error}
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button onClick={() => void submitPairing()} disabled={busy}>
                {busy ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
