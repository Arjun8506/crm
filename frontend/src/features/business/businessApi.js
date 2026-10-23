import { api } from '../../services/api';

const ONB = { type: 'Onboarding', id: 'STATE' };
const NEWS = { type: 'News', id: 'LIST' };
const FB = { type: 'Feedback', id: 'LIST' };

export const businessApi = api.injectEndpoints({
  endpoints: (b) => ({
    getOnboarding: b.query({ query: () => '/onboarding', providesTags: [ONB] }),
    runSetup: b.mutation({ query: (body) => ({ url: '/onboarding/setup', method: 'POST', body }), invalidatesTags: [ONB, 'Workspace', 'Dataform', 'Account'] }),
    skipSetup: b.mutation({ query: () => ({ url: '/onboarding/skip', method: 'POST' }), invalidatesTags: [ONB] }),
    dismissChecklist: b.mutation({ query: () => ({ url: '/onboarding/dismiss', method: 'POST' }), invalidatesTags: [ONB] }),
    reopenChecklist: b.mutation({ query: () => ({ url: '/onboarding/reopen', method: 'POST' }), invalidatesTags: [ONB] }),

    sendFeedback: b.mutation({ query: (body) => ({ url: '/feedback', method: 'POST', body }), invalidatesTags: [FB] }),
    myFeedback: b.query({ query: () => '/feedback/mine', transformResponse: (r) => r.data, providesTags: [FB] }),
    allFeedback: b.query({ query: (params) => ({ url: '/feedback', params }), providesTags: [FB] }),
    setFeedbackStatus: b.mutation({ query: ({ id, status }) => ({ url: `/feedback/${id}`, method: 'PATCH', body: { status } }), invalidatesTags: [FB] }),

    getNews: b.query({ query: () => '/announcements', providesTags: [NEWS] }),
    markNewsSeen: b.mutation({ query: () => ({ url: '/announcements/seen', method: 'POST' }), invalidatesTags: [NEWS] }),
    postAnnouncement: b.mutation({ query: (body) => ({ url: '/announcements', method: 'POST', body }), invalidatesTags: [NEWS] }),
    deleteAnnouncement: b.mutation({ query: (id) => ({ url: `/announcements/${id}`, method: 'DELETE' }), invalidatesTags: [NEWS] }),

    npsEligibility: b.query({ query: () => '/nps/eligibility', providesTags: [{ type: 'Nps', id: 'STATE' }] }),
    submitNps: b.mutation({ query: (body) => ({ url: '/nps', method: 'POST', body }), invalidatesTags: [{ type: 'Nps', id: 'STATE' }] }),
    dismissNps: b.mutation({ query: () => ({ url: '/nps/dismiss', method: 'POST' }), invalidatesTags: [{ type: 'Nps', id: 'STATE' }] }),
    npsSummary: b.query({ query: () => '/nps/summary', providesTags: [{ type: 'Nps', id: 'STATE' }] }),

    privacy: b.query({ query: () => '/events/privacy', providesTags: [{ type: 'Privacy', id: 'STATE' }] }),
    deleteMyUsage: b.mutation({ query: () => ({ url: '/events/me', method: 'DELETE' }) }),
    usageSummary: b.query({ query: (days = 30) => ({ url: '/events/summary', params: { days } }) }),
  }),
});

export const {
  useGetOnboardingQuery, useRunSetupMutation, useSkipSetupMutation, useDismissChecklistMutation, useReopenChecklistMutation,
  useSendFeedbackMutation, useMyFeedbackQuery, useAllFeedbackQuery, useSetFeedbackStatusMutation,
  useGetNewsQuery, useMarkNewsSeenMutation, usePostAnnouncementMutation, useDeleteAnnouncementMutation,
  useNpsEligibilityQuery, useSubmitNpsMutation, useDismissNpsMutation, useNpsSummaryQuery,
  usePrivacyQuery, useDeleteMyUsageMutation, useUsageSummaryQuery,
} = businessApi;
