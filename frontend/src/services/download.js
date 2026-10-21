import { refreshSession } from './api';
import { setCredentials } from '../features/auth/authSlice';

// Authenticated file download (the API needs the bearer token, so a plain <a href> cannot be used).
export async function downloadFile(store, url, body, fallbackName) {
  const send = () => fetch(`/api/v1${url}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'orgcrm', Authorization: `Bearer ${store.getState().auth.accessToken}` },
    body: JSON.stringify(body),
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
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
