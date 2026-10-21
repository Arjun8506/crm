import { api } from '../../services/api';

const WF = { type: 'Workflows', id: 'LIST' };
const INT = { type: 'Integrations', id: 'LIST' };
const TPL = { type: 'Templates', id: 'LIST' };

export const automationApi = api.injectEndpoints({
  endpoints: (b) => ({
    // ---- workflows ----
    listWorkflows: b.query({
      query: ({ workspaceId, dataformId, manual }) => ({ url: '/workflows', params: { workspaceId, ...(dataformId ? { dataformId } : {}), ...(manual ? { manual: 'true' } : {}) } }),
      transformResponse: (r) => r.data,
      providesTags: (res = []) => [WF, ...res.map((w) => ({ type: 'Workflows', id: w._id }))],
    }),
    getWorkflow: b.query({ query: (id) => `/workflows/${id}`, transformResponse: (r) => r.workflow, providesTags: (_r, _e, id) => [{ type: 'Workflows', id }] }),
    createWorkflow: b.mutation({ query: (body) => ({ url: '/workflows', method: 'POST', body }), invalidatesTags: [WF] }),
    updateWorkflow: b.mutation({ query: ({ id, ...body }) => ({ url: `/workflows/${id}`, method: 'PUT', body }), invalidatesTags: (_r, _e, { id }) => [{ type: 'Workflows', id }, WF] }),
    setWorkflowEnabled: b.mutation({ query: ({ id, enabled }) => ({ url: `/workflows/${id}/enabled`, method: 'PATCH', body: { enabled } }), invalidatesTags: (_r, _e, { id }) => [{ type: 'Workflows', id }, WF] }),
    deleteWorkflow: b.mutation({ query: (id) => ({ url: `/workflows/${id}`, method: 'DELETE' }), invalidatesTags: [WF] }),
    cancelPending: b.mutation({ query: (id) => ({ url: `/workflows/${id}/cancel-pending`, method: 'POST' }), invalidatesTags: [{ type: 'Executions', id: 'LIST' }] }),
    rotateWorkflowSecret: b.mutation({ query: (id) => ({ url: `/workflows/${id}/rotate-secret`, method: 'POST' }) }),
    runWorkflow: b.mutation({
      query: ({ id, recordId }) => ({ url: `/workflows/${id}/run`, method: 'POST', body: { recordId } }),
      invalidatesTags: [{ type: 'Executions', id: 'LIST' }, 'Records'],
    }),
    testFormula: b.mutation({ query: (body) => ({ url: '/workflows/test-formula', method: 'POST', body }) }),
    listExecutions: b.query({
      query: ({ id, ...params }) => ({ url: `/workflows/${id}/executions`, params }),
      providesTags: [{ type: 'Executions', id: 'LIST' }],
    }),
    getExecution: b.query({ query: (id) => `/workflows/executions/${id}`, transformResponse: (r) => r.execution, providesTags: [{ type: 'Executions', id: 'LIST' }] }),
    retryExecution: b.mutation({ query: (id) => ({ url: `/workflows/executions/${id}/retry`, method: 'POST' }), invalidatesTags: [{ type: 'Executions', id: 'LIST' }] }),

    // ---- integrations (account admins) ----
    listIntegrations: b.query({ query: () => '/integrations', providesTags: [INT] }),
    saveIntegration: b.mutation({ query: ({ kind, ...body }) => ({ url: `/integrations/${kind}`, method: 'PUT', body }), invalidatesTags: [INT, { type: 'Interactions', id: 'CHANNELS' }] }),
    deleteIntegration: b.mutation({ query: (kind) => ({ url: `/integrations/${kind}`, method: 'DELETE' }), invalidatesTags: [INT, { type: 'Interactions', id: 'CHANNELS' }] }),
    testIntegration: b.mutation({ query: (kind) => ({ url: `/integrations/${kind}/test`, method: 'POST' }), invalidatesTags: [INT] }),
    rotateIntegrationSecret: b.mutation({ query: (kind) => ({ url: `/integrations/${kind}/rotate-secret`, method: 'POST' }) }),

    // ---- communication ----
    getChannels: b.query({ query: () => '/communications/channels', transformResponse: (r) => r.channels, providesTags: [{ type: 'Interactions', id: 'CHANNELS' }] }),
    listTemplates: b.query({
      query: ({ workspaceId, channel }) => ({ url: '/communications/templates', params: { workspaceId, ...(channel ? { channel } : {}) } }),
      transformResponse: (r) => r.data,
      providesTags: [TPL],
    }),
    saveTemplate: b.mutation({
      query: ({ id, workspaceId, ...body }) => (id ? { url: `/communications/templates/${id}`, method: 'PATCH', body } : { url: `/communications/templates?workspaceId=${workspaceId}`, method: 'POST', body }),
      invalidatesTags: [TPL],
    }),
    deleteTemplate: b.mutation({ query: (id) => ({ url: `/communications/templates/${id}`, method: 'DELETE' }), invalidatesTags: [TPL] }),
    renderTemplate: b.mutation({ query: (body) => ({ url: '/communications/render', method: 'POST', body }) }),
    listInteractions: b.query({
      query: ({ dataformId, recordId }) => `/dataforms/${dataformId}/records/${recordId}/interactions`,
      providesTags: (_r, _e, a) => [{ type: 'Interactions', id: a.recordId }, { type: 'Interactions', id: 'ALL' }],
    }),
    sendMessage: b.mutation({
      query: ({ dataformId, recordId, ...body }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/messages`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Interactions', id: a.recordId }],
    }),
    logInteraction: b.mutation({
      query: ({ dataformId, recordId, ...body }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/interactions`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Interactions', id: a.recordId }],
    }),
    deleteInteraction: b.mutation({
      query: ({ dataformId, recordId, id }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/interactions/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Interactions', id: 'ALL' }],
    }),
  }),
});

export const {
  useListWorkflowsQuery, useGetWorkflowQuery, useCreateWorkflowMutation, useUpdateWorkflowMutation, useSetWorkflowEnabledMutation, useDeleteWorkflowMutation,
  useCancelPendingMutation, useRotateWorkflowSecretMutation, useRunWorkflowMutation, useTestFormulaMutation, useListExecutionsQuery, useGetExecutionQuery, useRetryExecutionMutation,
  useListIntegrationsQuery, useSaveIntegrationMutation, useDeleteIntegrationMutation, useTestIntegrationMutation, useRotateIntegrationSecretMutation,
  useGetChannelsQuery, useListTemplatesQuery, useSaveTemplateMutation, useDeleteTemplateMutation, useRenderTemplateMutation,
  useListInteractionsQuery, useSendMessageMutation, useLogInteractionMutation, useDeleteInteractionMutation,
} = automationApi;
