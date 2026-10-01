'use client';
import React, { useRef, useState } from 'react';
import { Button, Card, PageHeader } from '../../../components/ui';
import { useAuth } from '../../../features/auth/AuthProvider';
import { apiClient } from '../../../services/api';

export default function AccountPage() {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`;
  async function upload(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024) { setMessage('Choose a JPEG or PNG no larger than 2 MB.'); return; }
    setBusy(true); try { await apiClient.setAccountPhoto(file); setMessage('Photo updated.'); } finally { setBusy(false); }
  }
  async function remove() { setBusy(true); try { await apiClient.clearAccountPhoto(); setMessage('Photo removed.'); } finally { setBusy(false); } }
  return <><PageHeader title="My account" /><Card><div style={{ fontSize: 48, fontWeight: 700 }}>{initials}</div><p>{user?.first_name} {user?.last_name}</p><p>{user?.email ?? '—'}</p><p>{user?.role} · {user?.school_id ?? 'Platform'}</p><input ref={input} hidden type="file" accept="image/jpeg,image/png" onChange={e => void upload(e.target.files?.[0])} /><Button disabled={busy} onClick={() => input.current?.click()}>Upload photo</Button>{user?.profile_photo_key && <Button disabled={busy} onClick={() => void remove()}>Remove photo</Button>}<p>{message}</p></Card></>;
}
