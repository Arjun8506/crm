import { api } from '../../services/api';

const BILLING = { type: 'Billing', id: 'OVERVIEW' };

export const billingApi = api.injectEndpoints({
  endpoints: (b) => ({
    getBilling: b.query({ query: () => '/billing/overview', providesTags: [BILLING] }),
    listPlans: b.query({ query: () => '/billing/plans' }),
    previewChange: b.query({ query: (plan) => ({ url: '/billing/change-preview', params: { plan } }) }),
    startCheckout: b.mutation({ query: (plan) => ({ url: '/billing/checkout', method: 'POST', body: { plan } }) }),
    getCheckout: b.query({ query: (id) => `/billing/checkout/${id}` }),
    completeTestCheckout: b.mutation({
      query: ({ sessionId, outcome }) => ({ url: `/billing/test-checkout/${sessionId}/complete`, method: 'POST', body: { outcome } }),
      invalidatesTags: [BILLING, 'Account'],
    }),
    changePlan: b.mutation({ query: (plan) => ({ url: '/billing/change-plan', method: 'POST', body: { plan, confirm: true } }), invalidatesTags: [BILLING] }),
    resumePlan: b.mutation({ query: () => ({ url: '/billing/resume', method: 'POST' }), invalidatesTags: [BILLING] }),
    listInvoices: b.query({ query: () => '/billing/invoices', transformResponse: (r) => r.data, providesTags: [BILLING] }),
  }),
});

export const {
  useGetBillingQuery, useListPlansQuery, useLazyPreviewChangeQuery, useStartCheckoutMutation, useGetCheckoutQuery, useCompleteTestCheckoutMutation,
  useChangePlanMutation, useResumePlanMutation, useListInvoicesQuery,
} = billingApi;
