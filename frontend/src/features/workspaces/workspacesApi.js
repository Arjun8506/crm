import { api } from '../../services/api';

export const workspacesApi = api.injectEndpoints({
  endpoints: (b) => ({
    listWorkspaces: b.query({
      query: () => '/workspaces',
      transformResponse: (r) => r.data,
      providesTags: (res = []) => [
        { type: 'Workspace', id: 'LIST' },
        ...res.map((w) => ({ type: 'Workspace', id: w._id })),
      ],
    }),
    createWorkspace: b.mutation({
      query: (body) => ({ url: '/workspaces', method: 'POST', body }),
      invalidatesTags: [{ type: 'Workspace', id: 'LIST' }, 'Account'],
    }),
    updateWorkspace: b.mutation({
      query: ({ id, ...body }) => ({ url: `/workspaces/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Workspace', id }, { type: 'Workspace', id: 'LIST' }],
    }),
    cloneWorkspace: b.mutation({
      query: (id) => ({ url: `/workspaces/${id}/clone`, method: 'POST' }),
      invalidatesTags: [{ type: 'Workspace', id: 'LIST' }, 'Account'],
    }),
    deleteWorkspace: b.mutation({
      query: (id) => ({ url: `/workspaces/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Workspace', id: 'LIST' }, 'Account'],
    }),
  }),
});

export const {
  useListWorkspacesQuery,
  useCreateWorkspaceMutation,
  useUpdateWorkspaceMutation,
  useCloneWorkspaceMutation,
  useDeleteWorkspaceMutation,
} = workspacesApi;
