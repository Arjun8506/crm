import { api } from '../../services/api';

const post = (url) => (body) => ({ url, method: 'POST', body });

export const aiApi = api.injectEndpoints({
  endpoints: (b) => ({
    aiStatus: b.query({ query: () => '/ai/status', providesTags: [{ type: 'Ai', id: 'STATUS' }] }),
    aiRewrite: b.mutation({ query: post('/ai/rewrite'), invalidatesTags: [{ type: 'Ai', id: 'STATUS' }] }),
    aiSummarize: b.mutation({ query: post('/ai/summarize'), invalidatesTags: [{ type: 'Ai', id: 'STATUS' }] }),
    aiAsk: b.mutation({ query: post('/ai/ask'), invalidatesTags: [{ type: 'Ai', id: 'STATUS' }] }),
    aiDraftEmail: b.mutation({ query: post('/ai/draft-email'), invalidatesTags: [{ type: 'Ai', id: 'STATUS' }] }),
    aiExplainAnalysis: b.mutation({ query: post('/ai/explain-analysis'), invalidatesTags: [{ type: 'Ai', id: 'STATUS' }] }),
    aiSuggestWorkflow: b.mutation({ query: post('/ai/suggest-workflow'), invalidatesTags: [{ type: 'Ai', id: 'STATUS' }] }),
  }),
});

export const { useAiStatusQuery, useAiRewriteMutation, useAiSummarizeMutation, useAiAskMutation, useAiDraftEmailMutation, useAiExplainAnalysisMutation, useAiSuggestWorkflowMutation } = aiApi;
