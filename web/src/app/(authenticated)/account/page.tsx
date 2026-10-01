'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Button, Card, PageHeader, useToast } from '../../../components/ui';
import { useAuth } from '../../../features/auth/AuthProvider';
import {
  PROFILE_PHOTO_ACCEPT_ATTRIBUTE,
  PROFILE_PHOTO_REMOVED_MESSAGE,
  PROFILE_PHOTO_UPDATED_MESSAGE,
  avatarPresentation,
  hasProfilePhoto,
  profilePhotoFileError,
} from '../../../features/account/profile-photo';
import { useProfilePhoto } from '../../../features/account/useProfilePhoto';
import { fullName, roleLabel } from '../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../lib/errors';
import { apiClient } from '../../../services/api';

/**
 * `/account` — the signed-in user's own account.
 *
 * Small on purpose: the photo, and the four read-only facts that identify
 * whose account this is. Name, email, role and school are **not** editable
 * here — changing them is an administrative action with its own audit trail
 * (`/staff`, `/admin/schools`), and a self-service page that silently
 * rewrote them would be a different feature with different rules.
 *
 * ### The photo
 *
 * - the bytes come from the server (`useProfilePhoto`), not from a local
 *   copy, so the photo is there after a sign-out, in another browser and on
 *   the phone;
 * - the file is pre-checked against the **same** limits and the **same**
 *   sentences the API enforces (`features/account/profile-photo.ts` mirrors
 *   `server/modules/account/account.constants.ts`), so a rejection never
 *   surprises anyone and a 2 MB photo is not uploaded twice to be told so;
 * - a confirmed change is pushed straight into the session
 *   (`applyProfilePhoto`), which is what makes the sidebar chip update
 *   immediately rather than at the next refresh;
 * - **Remove** stays available whenever the session knows of a photo, and
 *   `DELETE` is idempotent server-side.
 *
 * Nothing on this page carries an account id: `PUT`/`DELETE
 * /account/me/photo` resolve the account from the verified JWT, so there is
 * nothing here to point at someone else.
 */
export default function AccountPage() {
  const { user, applyProfilePhoto } = useAuth();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoUrl = useProfilePhoto(user);
  const avatar = avatarPresentation(user, photoUrl);
  const showsPhoto = hasProfilePhoto(user);

  const upload = useCallback(
    async (file: File | undefined) => {
      const invalid = profilePhotoFileError(file ?? null);
      if (invalid) {
        setError(invalid);
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const result = unwrapEnvelope(await apiClient.setAccountPhoto(file as File));
        applyProfilePhoto(
          result?.profile_photo_key ?? null,
          result?.profile_photo_updated_at ?? null,
        );
        toast.push(PROFILE_PHOTO_UPDATED_MESSAGE, 'success');
      } catch (cause) {
        setError(getApiErrorMessage(cause));
      } finally {
        setBusy(false);
        // Let the same file be chosen again after a failure.
        if (fileInput.current) fileInput.current.value = '';
      }
    },
    [applyProfilePhoto, toast],
  );

  const remove = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await apiClient.clearAccountPhoto();
      applyProfilePhoto(null, null);
      toast.push(PROFILE_PHOTO_REMOVED_MESSAGE, 'success');
    } catch (cause) {
      setError(getApiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [applyProfilePhoto, toast]);

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="My account"
        description="Your profile photo and the details your school has on record."
      />

      <Card
        title="Profile photo"
        description="A JPEG or PNG up to 2 MB. Drivers and conductors see this on their phone; parents see it next to the crew on the live-trip screen."
      >
        <div className="row" style={{ alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          {avatar.kind === 'photo' ? (
            // A plain <img>, not next/image: the bytes are an authenticated
            // object URL created in the browser, not a static asset the
            // image optimizer could fetch on its own.
            <img
              src={avatar.src}
              alt={`${fullName(user)} profile photo`}
              width={96}
              height={96}
              style={{ width: 96, height: 96, borderRadius: '999px', objectFit: 'cover' }}
            />
          ) : (
            <span
              className="avatar"
              aria-hidden="true"
              style={{ width: 96, height: 96, fontSize: '1.6rem' }}
            >
              {avatar.initials}
            </span>
          )}

          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <input
              ref={fileInput}
              id="profile-photo-file"
              type="file"
              accept={PROFILE_PHOTO_ACCEPT_ATTRIBUTE}
              hidden
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <Button disabled={busy} onClick={() => fileInput.current?.click()}>
              {showsPhoto ? 'Replace photo' : 'Upload photo'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !showsPhoto}
              onClick={() => void remove()}
            >
              Remove photo
            </Button>
          </div>
        </div>

        {error ? (
          <p className="field-error" role="alert" style={{ marginTop: '0.85rem' }}>
            {error}
          </p>
        ) : null}
      </Card>

      <Card
        title="Details"
        description="Held by your school. Ask a school administrator to change any of these."
      >
        <dl className="detail-grid">
          <div>
            <dt className="muted">Name</dt>
            <dd>{fullName(user)}</dd>
          </div>
          <div>
            <dt className="muted">Email</dt>
            <dd>{user.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="muted">Role</dt>
            <dd>{roleLabel(user.role)}</dd>
          </div>
          <div>
            <dt className="muted">School</dt>
            <dd>{user.school_id ?? 'Platform'}</dd>
          </div>
        </dl>
      </Card>
    </>
  );
}
