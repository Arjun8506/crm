import { refreshSession } from './api';
import { setCredentials } from '../features/auth/authSlice';

// Authenticated file download (the API needs the bearer token, so a plain <a href> cannot be used).
export async function fetchAuthed(store, url, { method = 'POST', body } = {}) {
  const send = () => fetch(`/api/v1${url}`, {
    method, credentials: 'include',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'orgcrm', Authorization: `Bearer ${store.getState().auth.accessToken}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (session) { store.dispatch(setCredentials(session)); res = await send(); }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || 'Download failed');
  }
  return res;
}

export async function downloadFile(store, url, body, fallbackName, method = 'POST') {
  const res = await fetchAuthed(store, url, { method, body: method === 'POST' ? (body ?? {}) : undefined });
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const name = (encoded && decodeURIComponent(encoded)) || /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
