import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../layouts/AppShell';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { LoginPage, SignupPage } from '../features/auth/AuthPages';
import WorkspacesPage from '../features/workspaces/WorkspacesPage';
import WorkspaceHomePage from '../features/workspaces/WorkspaceHomePage';
import DataformPage from '../features/records/DataformPage';
import DataformSettingsPage from '../features/dataforms/DataformSettingsPage';
import TeamPage from '../features/users/TeamPage';
import { AccountSettingsPage, ProfilePage } from '../features/settings/SettingsPages';
import { EmptyState } from '../components/common';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/workspaces" replace />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/w/:workspaceId" element={<WorkspaceHomePage />} />
          <Route path="/w/:workspaceId/f/:dataformId" element={<DataformPage />} />
          <Route path="/w/:workspaceId/f/:dataformId/settings" element={<DataformSettingsPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/settings/account" element={<AccountSettingsPage />} />
          <Route path="/settings/profile" element={<ProfilePage />} />
          <Route path="*" element={<EmptyState title="Page not found" description="The page you are looking for does not exist." />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
