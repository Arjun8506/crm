import { api } from '../../services/api';

const LIST = { type: 'Dataform', id: 'LIST' };

export const dataformsApi = api.injectEndpoints({
  endpoints: (b) => ({
    getTypes: b.query({ query: () => '/dataforms/types' }),
    listDataforms: b.query({
      query: ({ workspaceId, includeArchived = false }) => `/dataforms?workspaceId=${workspaceId}&includeArchived=${includeArchived}`,
      transformResponse: (r) => r.data,
      providesTags: (res = []) => [LIST, ...res.map((d) => ({ type: 'Dataform', id: d._id }))],
    }),
    getDataform: b.query({
      query: (id) => `/dataforms/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Dataform', id }],
    }),
    createDataform: b.mutation({
      query: (body) => ({ url: '/dataforms', method: 'POST', body }),
      invalidatesTags: [LIST],
    }),
    updateDataform: b.mutation({
      query: ({ id, ...body }) => ({ url: `/dataforms/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Dataform', id }, LIST],
    }),
    cloneDataform: b.mutation({
      query: (id) => ({ url: `/dataforms/${id}/clone`, method: 'POST' }),
      invalidatesTags: [LIST],
    }),
    deleteDataform: b.mutation({
      query: (id) => ({ url: `/dataforms/${id}`, method: 'DELETE' }),
      invalidatesTags: [LIST],
    }),
    addField: b.mutation({
      query: ({ dataformId, ...body }) => ({ url: `/dataforms/${dataformId}/fields`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { dataformId }) => [{ type: 'Dataform', id: dataformId }, LIST],
    }),
    updateField: b.mutation({
      query: ({ dataformId, fieldId, ...body }) => ({ url: `/dataforms/${dataformId}/fields/${fieldId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { dataformId }) => [{ type: 'Dataform', id: dataformId }, { type: 'Records', id: dataformId }],
    }),
    deleteField: b.mutation({
      query: ({ dataformId, fieldId }) => ({ url: `/dataforms/${dataformId}/fields/${fieldId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { dataformId }) => [{ type: 'Dataform', id: dataformId }, { type: 'Records', id: dataformId }, LIST],
    }),
    reorderFields: b.mutation({
      query: ({ dataformId, ids }) => ({ url: `/dataforms/${dataformId}/fields/order`, method: 'PUT', body: { ids } }),
      invalidatesTags: (_r, _e, { dataformId }) => [{ type: 'Dataform', id: dataformId }],
    }),
  }),
});

export const {
  useGetTypesQuery, useListDataformsQuery, useGetDataformQuery, useCreateDataformMutation, useUpdateDataformMutation,
  useCloneDataformMutation, useDeleteDataformMutation, useAddFieldMutation, useUpdateFieldMutation, useDeleteFieldMutation,
  useReorderFieldsMutation,
} = dataformsApi;
