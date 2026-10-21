import { api } from '../../services/api';
import { clearCredentials, setCredentials, setUser } from './authSlice';

export const authApi = api.injectEndpoints({
  endpoints: (b) => ({
    login: b.mutation({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      onQueryStarted: async (_a, { dispatch, queryFulfilled }) => {
        dispatch(setCredentials((await queryFulfilled).data));
      },
    }),
    signup: b.mutation({
      query: (body) => ({ url: '/auth/signup', method: 'POST', body }),
      onQueryStarted: async (_a, { dispatch, queryFulfilled }) => {
        dispatch(setCredentials((await queryFulfilled).data));
      },
    }),
    logout: b.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      onQueryStarted: async (_a, { dispatch, queryFulfilled }) => {
        try {
          await queryFulfilled;
        } finally {
          dispatch(clearCredentials());
          dispatch(api.util.resetApiState());
        }
      },
    }),
    updateProfile: b.mutation({
      query: (body) => ({ url: '/users/me', method: 'PATCH', body }),
      onQueryStarted: async (_a, { dispatch, queryFulfilled }) => {
        dispatch(setUser((await queryFulfilled).data.user));
      },
    }),
  }),
});

export const { useLoginMutation, useSignupMutation, useLogoutMutation, useUpdateProfileMutation } = authApi;
