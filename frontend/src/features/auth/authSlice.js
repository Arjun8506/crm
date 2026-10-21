import { createSlice } from '@reduxjs/toolkit';

// The access token lives in memory only; the refresh token is an httpOnly cookie.
const empty = { accessToken: null, user: null, account: null, role: null, permissions: [] };

const authSlice = createSlice({
  name: 'auth',
  initialState: { status: 'loading', ...empty },
  reducers: {
    setCredentials: (s, { payload }) => {
      s.status = 'authenticated';
      s.accessToken = payload.accessToken;
      s.user = payload.user;
      s.account = payload.account;
      s.role = payload.role;
      s.permissions = payload.permissions;
    },
    setUser: (s, { payload }) => { s.user = payload; },
    setAccount: (s, { payload }) => { s.account = payload; },
    clearCredentials: () => ({ status: 'unauthenticated', ...empty }),
  },
});

export const { setCredentials, setUser, setAccount, clearCredentials } = authSlice.actions;
export default authSlice.reducer;

export const selectAuth = (s) => s.auth;
export const selectCan = (permission) => (s) =>
  s.auth.permissions.includes('*') || s.auth.permissions.includes(permission);
