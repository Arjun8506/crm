import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { usePrivacyQuery } from '../features/business/businessApi';

// Maps a path to an allowlisted event NAME. Ids and query strings never leave the browser.
const ROUTES = [
  [/^\/workspaces$/, 'page.workspaces'], [/^\/w\/[^/]+$/, 'page.workspace'], [/^\/w\/[^/]+\/f\/[^/]+$/, 'page.dataform'], [/^\/w\/[^/]+\/reports/, 'page.reports'],
  [/^\/dashboards/, 'page.dashboards'], [/^\/(w\/[^/]+\/)?tasks$/, 'page.tasks'], [/^\/notifications$/, 'page.notifications'], [/^\/w\/[^/]+\/workflows/, 'page.automation'],
  [/^\/team$/, 'page.team'], [/^\/settings\/integrations$/, 'page.integrations'], [/^\/settings\/developers$/, 'page.developers'], [/^\/settings\/billing$/, 'page.billing'],
  [/^\/settings\/account$/, 'page.account'], [/^\/help$/, 'page.help'], [/^\/whats-new$/, 'page.whatsnew'],
];

// Sends one anonymous event per page view, unless the browser, the person or the organisation has said no.
export default function usePageTracking() {
  const { pathname } = useLocation();
  const token = useSelector((s) => s.auth.accessToken);
  const { data: privacy } = usePrivacyQuery();
  const allowed = !!privacy && privacy.organisation && privacy.person && !privacy.doNotTrack && navigator.doNotTrack !== '1';
  useEffect(() => {
    const name = ROUTES.find(([re]) => re.test(pathname))?.[1];
    if (!allowed || !name || !token) return;
    fetch('/api/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Requested-With': 'orgcrm' }, body: JSON.stringify({ name }), keepalive: true }).catch(() => {});
  }, [pathname, allowed, token]);
}
