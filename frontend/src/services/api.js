import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { clearCredentials, setCredentials } from '../features/auth/authSlice';

const BASE = '/api/v1';

// One shared in-flight refresh for all callers. Refresh tokens are single-use, so this also
// protects against React StrictMode running the bootstrap effect twice.
let refreshing = null;
export function refreshSession() {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'orgcrm' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: BASE,
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Requested-With', 'orgcrm');
    return headers;
  },
});

const baseQueryWithReauth = async (args, api, extra) => {
  let result = await rawBaseQuery(args, api, extra);
  const url = typeof args === 'string' ? args : args.url;
  if (result.error?.status === 401 && !url.startsWith('/auth/')) {
    const session = await refreshSession();
    if (session) {
      api.dispatch(setCredentials(session));
      result = await rawBaseQuery(args, api, extra);
    } else {
      api.dispatch(clearCredentials());
    }
  }
  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Workspace', 'Account', 'Members', 'Dataform', 'Records'],
  endpoints: () => ({}),
});

export const errorMessage = (err, fallback = 'Something went wrong') =>
  err?.data?.error?.message || (err?.status === 'FETCH_ERROR' ? 'Cannot reach the server' : fallback);
