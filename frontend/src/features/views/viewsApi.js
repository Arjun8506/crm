import { api } from '../../services/api';

const tag = (dataformId) => [{ type: 'Views', id: dataformId }];

export const viewsApi = api.injectEndpoints({
  endpoints: (b) => ({
    listViews: b.query({
      query: (dataformId) => `/dataforms/${dataformId}/views`,
      transformResponse: (r) => r.data,
      providesTags: (_r, _e, id) => tag(id),
    }),
    createView: b.mutation({
      query: ({ dataformId, ...body }) => ({ url: `/dataforms/${dataformId}/views`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
    updateView: b.mutation({
      query: ({ dataformId, viewId, ...body }) => ({ url: `/dataforms/${dataformId}/views/${viewId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
    deleteView: b.mutation({
      query: ({ dataformId, viewId }) => ({ url: `/dataforms/${dataformId}/views/${viewId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
    moveRecord: b.mutation({
      query: ({ dataformId, recordId, ...body }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/move`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { dataformId }) => [{ type: 'Records', id: dataformId }],
    }),
  }),
});

export const { useListViewsQuery, useCreateViewMutation, useUpdateViewMutation, useDeleteViewMutation, useMoveRecordMutation } = viewsApi;
