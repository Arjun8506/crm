import { api } from '../../services/api';

const base = (id) => `/dataforms/${id}/records`;
const tag = (id) => [{ type: 'Records', id }, { type: 'Dataform', id: 'LIST' }];

export const recordsApi = api.injectEndpoints({
  endpoints: (b) => ({
    queryRecords: b.query({
      query: ({ dataformId, ...body }) => ({ url: `${base(dataformId)}/query`, method: 'POST', body }),
      providesTags: (_r, _e, { dataformId }) => [{ type: 'Records', id: dataformId }],
    }),
    getRecord: b.query({
      query: ({ dataformId, recordId }) => `${base(dataformId)}/${recordId}`,
      providesTags: (_r, _e, { dataformId }) => [{ type: 'Records', id: dataformId }],
    }),
    getHistory: b.query({
      query: ({ dataformId, recordId }) => `${base(dataformId)}/${recordId}/history`,
      transformResponse: (r) => r.data,
      providesTags: (_r, _e, { dataformId }) => [{ type: 'Records', id: dataformId }],
    }),
    createRecord: b.mutation({
      query: ({ dataformId, data }) => ({ url: base(dataformId), method: 'POST', body: { data } }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
    updateRecord: b.mutation({
      query: ({ dataformId, recordId, data }) => ({ url: `${base(dataformId)}/${recordId}`, method: 'PATCH', body: { data } }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
    copyRecord: b.mutation({
      query: ({ dataformId, recordId }) => ({ url: `${base(dataformId)}/${recordId}/copy`, method: 'POST' }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
    deleteRecord: b.mutation({
      query: ({ dataformId, recordId }) => ({ url: `${base(dataformId)}/${recordId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
    bulkRecords: b.mutation({
      query: ({ dataformId, ...body }) => ({ url: `${base(dataformId)}/bulk`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { dataformId }) => tag(dataformId),
    }),
  }),
});

export const {
  useQueryRecordsQuery, useGetRecordQuery, useGetHistoryQuery, useCreateRecordMutation, useUpdateRecordMutation,
  useCopyRecordMutation, useDeleteRecordMutation, useBulkRecordsMutation,
} = recordsApi;
