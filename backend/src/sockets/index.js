import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../modules/auth/auth.service.js';
import { Membership } from '../modules/users/membership.model.js';
import { workspaceAccess } from '../modules/workspaces/access.js';

// Real-time layer. Events carry only ids, never record content: clients react by refetching through
// the normal API, so every read is still authorized there. Rooms are joined only after a server-side check.
let io = null;

export function attachSockets(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.CLIENT_ORIGIN.split(','), credentials: true } });

  io.use(async (socket, next) => {
    try {
      const payload = verifyAccessToken(String(socket.handshake.auth?.token ?? ''));
      const membership = await Membership.findOne({ user: payload.sub, account: payload.acc, status: 'active' }).lean();
      if (!membership) return next(new Error('unauthorized'));
      socket.data.userId = payload.sub;
      socket.data.accountId = String(membership.account);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    socket.join(`account:${socket.data.accountId}`);

    socket.on('subscribe', async (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const id = msg?.workspaceId;
      if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return reply({ ok: false });
      try {
        // Re-read the membership so a role change or removal since connect is respected.
        const membership = await Membership.findOne({ user: socket.data.userId, account: socket.data.accountId, status: 'active' }).lean();
        if (!membership) return reply({ ok: false });
        await workspaceAccess({ userId: socket.data.userId, accountId: socket.data.accountId, role: membership.role }, id);
        socket.join(`workspace:${id}`);
        return reply({ ok: true });
      } catch {
        return reply({ ok: false });
      }
    });
    socket.on('unsubscribe', (msg) => {
      if (typeof msg?.workspaceId === 'string') socket.leave(`workspace:${msg.workspaceId}`);
    });
  });
  return io;
}

export const closeSockets = () => io?.close();
export const emitTo = (room, event, payload) => { io?.to(room).emit(event, payload); };
export const emitWorkspace = (workspaceId, event, payload) => emitTo(`workspace:${workspaceId}`, event, { ...payload, workspaceId: String(workspaceId) });
export const emitUser = (userId, event, payload) => emitTo(`user:${userId}`, event, payload);
