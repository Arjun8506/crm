import { api } from '../../services/api';

const KEYS = { type: 'ApiKeys', id: 'LIST' };
const HOOKS = { type: 'Webhooks', id: 'LIST' };

export const developersApi = api.injectEndpoints({
  endpoints: (b) => ({
    listApiKeys: b.query({ query: () => '/api-keys', transformResponse: (r) => r.data, providesTags: [KEYS] }),
    createApiKey: b.mutation({ query: (body) => ({ url: '/api-keys', method: 'POST', body }), invalidatesTags: [KEYS, { type: 'Audit', id: 'LIST' }] }),
    revokeApiKey: b.mutation({ query: (id) => ({ url: `/api-keys/${id}`, method: 'DELETE' }), invalidatesTags: [KEYS, { type: 'Audit', id: 'LIST' }] }),

    listWebhooks: b.query({ query: () => '/outbound-webhooks', providesTags: [HOOKS] }),
    createWebhook: b.mutation({ query: (body) => ({ url: '/outbound-webhooks', method: 'POST', body }), invalidatesTags: [HOOKS, { type: 'Audit', id: 'LIST' }] }),
    updateWebhook: b.mutation({ query: ({ id, ...body }) => ({ url: `/outbound-webhooks/${id}`, method: 'PATCH', body }), invalidatesTags: [HOOKS] }),
    deleteWebhook: b.mutation({ query: (id) => ({ url: `/outbound-webhooks/${id}`, method: 'DELETE' }), invalidatesTags: [HOOKS] }),
    rotateWebhookSecret: b.mutation({ query: (id) => ({ url: `/outbound-webhooks/${id}/rotate-secret`, method: 'POST' }) }),
    testWebhook: b.mutation({ query: (id) => ({ url: `/outbound-webhooks/${id}/test`, method: 'POST' }), invalidatesTags: [HOOKS] }),
    listDeliveries: b.query({
      query: ({ id, ...params }) => ({ url: `/outbound-webhooks/${id}/deliveries`, params }),
      providesTags: [{ type: 'Deliveries', id: 'LIST' }],
    }),
    redeliver: b.mutation({ query: (id) => ({ url: `/outbound-webhooks/deliveries/${id}/redeliver`, method: 'POST' }), invalidatesTags: [{ type: 'Deliveries', id: 'LIST' }] }),

    listAudit: b.query({ query: (params) => ({ url: '/audit', params }), providesTags: [{ type: 'Audit', id: 'LIST' }] }),
    getOpenApi: b.query({ query: () => '/openapi.json' }),
  }),
});

export const {
  useListApiKeysQuery, useCreateApiKeyMutation, useRevokeApiKeyMutation,
  useListWebhooksQuery, useCreateWebhookMutation, useUpdateWebhookMutation, useDeleteWebhookMutation, useRotateWebhookSecretMutation, useTestWebhookMutation,
  useListDeliveriesQuery, useRedeliverMutation, useListAuditQuery, useGetOpenApiQuery,
} = developersApi;
