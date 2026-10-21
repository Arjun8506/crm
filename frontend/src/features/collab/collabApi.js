import { api } from '../../services/api';

const recordKey = (dataformId, recordId) => `${dataformId}:${recordId}`;
const TASKS = { type: 'Tasks', id: 'LIST' };
const NOTES = { type: 'Notifications', id: 'LIST' };

export const collabApi = api.injectEndpoints({
  endpoints: (b) => ({
    // ---- record comments & following ----
    listRecordComments: b.query({
      query: ({ dataformId, recordId }) => `/dataforms/${dataformId}/records/${recordId}/comments`,
      providesTags: (_r, _e, a) => [{ type: 'Comments', id: a.recordId }],
    }),
    addRecordComment: b.mutation({
      query: ({ dataformId, recordId, ...body }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/comments`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Comments', id: a.recordId }],
    }),
    setFollow: b.mutation({
      query: ({ dataformId, recordId, follow }) => ({ url: `/dataforms/${dataformId}/records/${recordId}/follow`, method: follow ? 'PUT' : 'DELETE' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Comments', id: a.recordId }],
    }),
    editComment: b.mutation({
      query: ({ id, ...body }) => ({ url: `/comments/${id}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'Comments', id: 'ALL' }],
    }),
    deleteComment: b.mutation({
      query: (id) => ({ url: `/comments/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Comments', id: 'ALL' }],
    }),

    // ---- tasks ----
    listTasks: b.query({
      query: (params) => ({ url: '/tasks', params }),
      providesTags: (res) => [TASKS, ...(res?.data ?? []).map((t) => ({ type: 'Tasks', id: t._id }))],
    }),
    getTask: b.query({ query: (id) => `/tasks/${id}`, providesTags: (_r, _e, id) => [{ type: 'Tasks', id }] }),
    createTask: b.mutation({ query: (body) => ({ url: '/tasks', method: 'POST', body }), invalidatesTags: [TASKS] }),
    updateTask: b.mutation({
      query: ({ id, ...body }) => ({ url: `/tasks/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Tasks', id }, TASKS],
    }),
    deleteTask: b.mutation({ query: (id) => ({ url: `/tasks/${id}`, method: 'DELETE' }), invalidatesTags: [TASKS] }),
    listTaskComments: b.query({
      query: (id) => `/tasks/${id}/comments`,
      providesTags: (_r, _e, id) => [{ type: 'Comments', id }],
    }),
    addTaskComment: b.mutation({
      query: ({ id, ...body }) => ({ url: `/tasks/${id}/comments`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Comments', id }, { type: 'Tasks', id }],
    }),

    // ---- notifications ----
    listNotifications: b.query({
      query: ({ unread, page = 1, limit = 20 } = {}) => ({ url: '/notifications', params: { ...(unread ? { unread: 'true' } : {}), page, limit } }),
      providesTags: [NOTES],
    }),
    unreadCount: b.query({ query: () => '/notifications/unread-count', transformResponse: (r) => r.unread, providesTags: [NOTES] }),
    markRead: b.mutation({ query: (id) => ({ url: `/notifications/${id}/read`, method: 'POST' }), invalidatesTags: [NOTES] }),
    markAllRead: b.mutation({ query: () => ({ url: '/notifications/read-all', method: 'POST' }), invalidatesTags: [NOTES] }),
    deleteNotification: b.mutation({ query: (id) => ({ url: `/notifications/${id}`, method: 'DELETE' }), invalidatesTags: [NOTES] }),
    getPreferences: b.query({ query: () => '/notifications/preferences', providesTags: [{ type: 'Notifications', id: 'PREFS' }] }),
    savePreferences: b.mutation({
      query: (body) => ({ url: '/notifications/preferences', method: 'PUT', body }),
      invalidatesTags: [{ type: 'Notifications', id: 'PREFS' }],
    }),

    // ---- attachments ----
    listAttachments: b.query({
      query: ({ dataformId, recordId }) => `/dataforms/${dataformId}/records/${recordId}/attachments`,
      providesTags: (_r, _e, a) => [{ type: 'Attachments', id: a.recordId }],
    }),
    uploadAttachment: b.mutation({
      query: ({ dataformId, recordId, file, description }) => {
        const body = new FormData();
        body.append('description', description ?? '');
        body.append('file', file);
        return { url: `/dataforms/${dataformId}/records/${recordId}/attachments`, method: 'POST', body };
      },
      invalidatesTags: (_r, _e, a) => [{ type: 'Attachments', id: a.recordId }],
    }),
    updateAttachment: b.mutation({
      query: ({ id, description }) => ({ url: `/attachments/${id}`, method: 'PATCH', body: { description } }),
      invalidatesTags: [{ type: 'Attachments', id: 'ALL' }],
    }),
    deleteAttachment: b.mutation({
      query: (id) => ({ url: `/attachments/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Attachments', id: 'ALL' }],
    }),
  }),
});

export { recordKey };
export const {
  useListRecordCommentsQuery, useAddRecordCommentMutation, useSetFollowMutation, useEditCommentMutation, useDeleteCommentMutation,
  useListTasksQuery, useGetTaskQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation, useListTaskCommentsQuery, useAddTaskCommentMutation,
  useListNotificationsQuery, useUnreadCountQuery, useMarkReadMutation, useMarkAllReadMutation, useDeleteNotificationMutation, useGetPreferencesQuery, useSavePreferencesMutation,
  useListAttachmentsQuery, useUploadAttachmentMutation, useUpdateAttachmentMutation, useDeleteAttachmentMutation,
} = collabApi;
