import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isPublicPath } from '../../app/publicPaths';
import { useDispatch, useSelector } from 'react-redux';
import { FullPageLoader } from '../../components/common';
import { refreshSession } from '../../services/api';
import { clearCredentials, setCredentials } from './authSlice';

// Restores the session from the httpOnly refresh cookie on first load.
export function AuthBootstrap({ children }) {
  const dispatch = useDispatch();
  const status = useSelector((s) => s.auth.status);
  useEffect(() => {
    // Public pages (shared forms and links) are for visitors: they never touch the session cookie.
    if (isPublicPath(window.location.pathname)) { dispatch(clearCredentials()); return undefined; }
    let active = true;
    refreshSession().then((session) => {
      if (!active) return;
      dispatch(session ? setCredentials(session) : clearCredentials());
    });
    return () => { active = false; };
  }, [dispatch]);
  return status === 'loading' ? <FullPageLoader /> : children;
}

export function ProtectedRoute() {
  const status = useSelector((s) => s.auth.status);
  // const status = 'authenticated';
  const location = useLocation();
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
