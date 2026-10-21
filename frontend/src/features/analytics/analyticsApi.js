import { api } from '../../services/api';

const REPORTS = { type: 'Reports', id: 'LIST' };
const DASH = { type: 'Dashboards', id: 'LIST' };

export const analyticsApi = api.injectEndpoints({
  endpoints: (b) => ({
    analyze: b.query({
      query: ({ dataformId, ...body }) => ({ url: `/dataforms/${dataformId}/analyze`, method: 'POST', body }),
      providesTags: (_r, _e, { dataformId }) => [{ type: 'Records', id: dataformId }],
    }),
    listReports: b.query({
      query: (workspaceId) => `/reports?workspaceId=${workspaceId}`,
      transformResponse: (r) => r.data,
      providesTags: (res = []) => [REPORTS, ...res.map((r) => ({ type: 'Reports', id: r._id }))],
    }),
    getReport: b.query({
      query: (id) => `/reports/${id}`,
      transformResponse: (r) => r.report,
      providesTags: (_r, _e, id) => [{ type: 'Reports', id }],
    }),
    createReport: b.mutation({ query: (body) => ({ url: '/reports', method: 'POST', body }), invalidatesTags: [REPORTS] }),
    updateReport: b.mutation({
      query: ({ id, ...body }) => ({ url: `/reports/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Reports', id }, REPORTS, DASH],
    }),
    deleteReport: b.mutation({ query: (id) => ({ url: `/reports/${id}`, method: 'DELETE' }), invalidatesTags: [REPORTS] }),

    listDashboards: b.query({
      query: () => '/dashboards',
      transformResponse: (r) => r.data,
      providesTags: [DASH],
    }),
    getDashboard: b.query({
      query: (id) => `/dashboards/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Dashboards', id }],
    }),
    createDashboard: b.mutation({ query: (body) => ({ url: '/dashboards', method: 'POST', body }), invalidatesTags: [DASH] }),
    saveDashboard: b.mutation({
      query: ({ id, ...body }) => ({ url: `/dashboards/${id}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Dashboards', id }, DASH],
    }),
    deleteDashboard: b.mutation({ query: (id) => ({ url: `/dashboards/${id}`, method: 'DELETE' }), invalidatesTags: [DASH] }),
    widgetData: b.query({
      query: ({ dashboardId, widgetId }) => ({ url: `/dashboards/${dashboardId}/widgets/${widgetId}/data`, method: 'POST' }),
      providesTags: [{ type: 'Records', id: 'ALL' }],
    }),
  }),
});

export const {
  useAnalyzeQuery, useListReportsQuery, useGetReportQuery, useCreateReportMutation, useUpdateReportMutation, useDeleteReportMutation,
  useListDashboardsQuery, useGetDashboardQuery, useCreateDashboardMutation, useSaveDashboardMutation, useDeleteDashboardMutation, useWidgetDataQuery,
} = analyticsApi;
