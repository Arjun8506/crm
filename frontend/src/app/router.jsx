import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../layouts/AppShell';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { LoginPage, SignupPage } from '../features/auth/AuthPages';
import WorkspacesPage from '../features/workspaces/WorkspacesPage';
import WorkspaceHomePage from '../features/workspaces/WorkspaceHomePage';
import DataformPage from '../features/records/DataformPage';
import DataformSettingsPage from '../features/dataforms/DataformSettingsPage';
import ReportsPage from '../features/analytics/ReportsPage';
import ReportEditorPage from '../features/analytics/ReportEditorPage';
import DashboardsPage from '../features/analytics/DashboardsPage';
import DashboardPage from '../features/analytics/DashboardPage';
import TasksPage from '../features/tasks/TasksPage';
import NotificationsPage from '../features/notifications/NotificationsPage';
import WorkflowsPage from '../features/automation/WorkflowsPage';
import WorkflowEditorPage from '../features/automation/WorkflowEditorPage';
import IntegrationsPage from '../features/automation/IntegrationsPage';
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
          <Route path="/w/:workspaceId/reports" element={<ReportsPage />} />
          <Route path="/w/:workspaceId/reports/new/:kind" element={<ReportEditorPage />} />
          <Route path="/w/:workspaceId/reports/:reportId" element={<ReportEditorPage />} />
          <Route path="/dashboards" element={<DashboardsPage />} />
          <Route path="/dashboards/:dashboardId" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/w/:workspaceId/tasks" element={<TasksPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/w/:workspaceId/workflows" element={<WorkflowsPage />} />
          <Route path="/w/:workspaceId/workflows/new" element={<WorkflowEditorPage />} />
          <Route path="/w/:workspaceId/workflows/:workflowId" element={<WorkflowEditorPage />} />
          <Route path="/settings/integrations" element={<IntegrationsPage />} />
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
