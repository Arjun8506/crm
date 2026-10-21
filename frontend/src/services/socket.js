import { io } from 'socket.io-client';
import { api } from './api';

// One shared socket per signed-in session. Events carry only ids; we react by invalidating cached queries,
// so the data itself is always re-read through the authorized REST API.
let socket = null;
let subscribed = new Set();

export function connectSocket(store) {
  if (socket) return socket;
  socket = io({
    // Read the *current* token on every (re)connect so refreshed sessions keep working.
    auth: (cb) => cb({ token: store.getState().auth.accessToken }),
    transports: ['websocket'],
  });

  const invalidate = (...tags) => store.dispatch(api.util.invalidateTags(tags));

  socket.on('record.changed', ({ dataformId }) => invalidate({ type: 'Records', id: dataformId }, { type: 'Dataform', id: 'LIST' }));
  socket.on('comment.changed', () => invalidate({ type: 'Comments', id: 'ALL' }, 'Comments'));
  socket.on('task.changed', () => invalidate({ type: 'Tasks', id: 'LIST' }, 'Tasks'));
  socket.on('interaction.changed', () => invalidate({ type: 'Interactions', id: 'ALL' }, 'Interactions'));
  socket.on('attachment.changed', () => invalidate({ type: 'Attachments', id: 'ALL' }, 'Attachments'));
  socket.on('notification.new', async () => {
    invalidate({ type: 'Notifications', id: 'LIST' });
    // Browser notification only when the tab is in the background and the user has granted permission.
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const res = await store.dispatch(api.endpoints.listNotifications.initiate({ page: 1, limit: 1 }, { forceRefetch: true }));
      const latest = res.data?.data?.[0];
      if (latest) new Notification(latest.title, { body: latest.body, tag: latest._id });
    }
  });
  // After a reconnect the server has forgotten our rooms; join them again.
  socket.on('connect', () => { subscribed = new Set(); });
  return socket;
}

export function syncSubscriptions(workspaceIds) {
  if (!socket) return;
  const want = new Set(workspaceIds);
  for (const id of want) {
    if (!subscribed.has(id)) socket.emit('subscribe', { workspaceId: id }, (r) => { if (r?.ok) subscribed.add(id); });
  }
  for (const id of subscribed) {
    if (!want.has(id)) { socket.emit('unsubscribe', { workspaceId: id }); subscribed.delete(id); }
  }
}

export function disconnectSocket() {
  socket?.close();
  socket = null;
  subscribed = new Set();
}
