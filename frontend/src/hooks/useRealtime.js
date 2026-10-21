import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { store } from '../app/store';
import { connectSocket, disconnectSocket, syncSubscriptions } from '../services/socket';
import { useListWorkspacesQuery } from '../features/workspaces/workspacesApi';

// Keeps the socket connected while signed in, and subscribed to every workspace the user can open.
export default function useRealtime() {
  const authed = useSelector((s) => s.auth.status === 'authenticated');
  const { data: workspaces } = useListWorkspacesQuery(undefined, { skip: !authed });

  useEffect(() => {
    if (!authed) return undefined;
    connectSocket(store);
    return () => disconnectSocket();
  }, [authed]);

  const key = (workspaces ?? []).map((w) => w._id).join(',');
  useEffect(() => {
    if (authed && key) syncSubscriptions(key.split(','));
  }, [authed, key]);
}
