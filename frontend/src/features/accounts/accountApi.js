import { api } from '../../services/api';
import { setAccount } from '../auth/authSlice';

export const accountApi = api.injectEndpoints({
  endpoints: (b) => ({
    getAccount: b.query({ query: () => '/accounts/current', providesTags: ['Account'] }),
    updateAccount: b.mutation({
      query: (body) => ({ url: '/accounts/current', method: 'PATCH', body }),
      invalidatesTags: ['Account'],
      onQueryStarted: async (_a, { dispatch, queryFulfilled }) => {
        dispatch(setAccount((await queryFulfilled).data.account));
      },
    }),
    listMembers: b.query({ query: () => '/users', transformResponse: (r) => r.data, providesTags: ['Members'] }),
    updateMember: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Members', 'Account'],
    }),
  }),
});

export const { useGetAccountQuery, useUpdateAccountMutation, useListMembersQuery, useUpdateMemberMutation } = accountApi;
