import { api } from '../../services/api';

const IMPORTS = { type: 'Imports', id: 'LIST' };
const EXPORTS = { type: 'Exports', id: 'LIST' };
const FORMS = { type: 'Forms', id: 'LIST' };
const SHARES = { type: 'Shares', id: 'LIST' };
const SETTLED = ['done', 'failed', 'cancelled'];
export const isSettled = (job) => !job || SETTLED.includes(job.status);

export const dataopsApi = api.injectEndpoints({
  endpoints: (b) => ({
    // ---- imports ----
    listImports: b.query({ query: (dataformId) => `/dataforms/${dataformId}/imports`, transformResponse: (r) => r.data, providesTags: [IMPORTS] }),
    uploadImport: b.mutation({
      query: ({ dataformId, file }) => { const body = new FormData(); body.append('file', file); return { url: `/dataforms/${dataformId}/imports`, method: 'POST', body }; },
      invalidatesTags: [IMPORTS],
    }),
    getImport: b.query({ query: (id) => `/imports/${id}`, providesTags: [IMPORTS] }),
    startImport: b.mutation({ query: ({ id, ...body }) => ({ url: `/imports/${id}/start`, method: 'POST', body }), invalidatesTags: [IMPORTS] }),
    cancelImport: b.mutation({ query: (id) => ({ url: `/imports/${id}/cancel`, method: 'POST' }), invalidatesTags: [IMPORTS] }),
    deleteImport: b.mutation({ query: (id) => ({ url: `/imports/${id}`, method: 'DELETE' }), invalidatesTags: [IMPORTS] }),

    // ---- exports ----
    listExports: b.query({ query: (dataformId) => ({ url: '/exports', params: { dataformId } }), transformResponse: (r) => r.data, providesTags: [EXPORTS] }),
    createExport: b.mutation({ query: (body) => ({ url: '/exports', method: 'POST', body }), invalidatesTags: [EXPORTS] }),
    getExport: b.query({ query: (id) => `/exports/${id}`, transformResponse: (r) => r.export, providesTags: [EXPORTS] }),
    deleteExport: b.mutation({ query: (id) => ({ url: `/exports/${id}`, method: 'DELETE' }), invalidatesTags: [EXPORTS] }),

    // ---- public forms (admin) ----
    listForms: b.query({ query: (dataformId) => `/dataforms/${dataformId}/forms`, providesTags: [FORMS] }),
    createForm: b.mutation({ query: ({ dataformId, ...body }) => ({ url: `/dataforms/${dataformId}/forms`, method: 'POST', body }), invalidatesTags: [FORMS] }),
    updateForm: b.mutation({ query: ({ dataformId, formId, ...body }) => ({ url: `/dataforms/${dataformId}/forms/${formId}`, method: 'PATCH', body }), invalidatesTags: [FORMS] }),
    regenerateFormLink: b.mutation({ query: ({ dataformId, formId }) => ({ url: `/dataforms/${dataformId}/forms/${formId}/regenerate-link`, method: 'POST' }), invalidatesTags: [FORMS] }),
    deleteForm: b.mutation({ query: ({ dataformId, formId }) => ({ url: `/dataforms/${dataformId}/forms/${formId}`, method: 'DELETE' }), invalidatesTags: [FORMS] }),

    // ---- public record links ----
    listShares: b.query({ query: ({ dataformId, recordId }) => `/dataforms/${dataformId}/records/${recordId}/shares`, transformResponse: (r) => r.data, providesTags: [SHARES] }),
    createShare: b.mutation({ query: ({ dataformId, recordId, ...body }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/shares`, method: 'POST', body }), invalidatesTags: [SHARES] }),
    revokeShare: b.mutation({ query: ({ dataformId, recordId, shareId }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/shares/${shareId}`, method: 'DELETE' }), invalidatesTags: [SHARES] }),

    // ---- visitors (no sign-in) ----
    getPublicForm: b.query({ query: (token) => `/public/forms/${token}` }),
    getPublicShare: b.query({ query: (token) => `/public/shares/${token}` }),
  }),
});

export const {
  useListImportsQuery, useUploadImportMutation, useGetImportQuery, useStartImportMutation, useCancelImportMutation, useDeleteImportMutation,
  useListExportsQuery, useCreateExportMutation, useGetExportQuery, useDeleteExportMutation,
  useListFormsQuery, useCreateFormMutation, useUpdateFormMutation, useRegenerateFormLinkMutation, useDeleteFormMutation,
  useListSharesQuery, useCreateShareMutation, useRevokeShareMutation, useGetPublicFormQuery, useGetPublicShareQuery,
} = dataopsApi;
