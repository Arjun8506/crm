import { Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Stack, Tooltip, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { motion } from 'framer-motion';
import { NavLink, useMatch } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import WorkspacesIcon from '@mui/icons-material/GridViewRounded';
import HomeIcon from '@mui/icons-material/HomeRounded';
import PeopleIcon from '@mui/icons-material/PeopleAltRounded';
import BusinessIcon from '@mui/icons-material/BusinessRounded';
import PersonIcon from '@mui/icons-material/PersonRounded';
import ChevronLeft from '@mui/icons-material/ChevronLeftRounded';
import ChevronRight from '@mui/icons-material/ChevronRightRounded';
import { Logo } from '../components/common';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from '../app/theme';
import { setMobileNav, toggleSidebar } from '../features/ui/uiSlice';
import { selectCan } from '../features/auth/authSlice';
import { useListWorkspacesQuery } from '../features/workspaces/workspacesApi';
import { useListDataformsQuery } from '../features/dataforms/dataformsApi';
import TableIcon from '@mui/icons-material/TableRowsOutlined';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import ReportIcon from '@mui/icons-material/QueryStatsRounded';
import TaskIcon from '@mui/icons-material/TaskAltRounded';
import BellIcon from '@mui/icons-material/NotificationsNoneRounded';
import AutoIcon from '@mui/icons-material/AutoFixHighOutlined';
import PlugIcon from '@mui/icons-material/PowerOutlined';

function NavItem({ to, icon, label, collapsed, end, onClick }) {
  const item = (
    <ListItemButton
      component={NavLink}
      to={to}
      end={end}
      onClick={onClick}
      sx={{
        mb: 0.5, px: collapsed ? 1.75 : 1.5, minHeight: 40,
        '&.active': { bgcolor: 'action.selected', color: 'primary.main', '& .MuiListItemIcon-root': { color: 'primary.main' } },
      }}
    >
      <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: 'text.secondary' }}>{icon}</ListItemIcon>
      {!collapsed && <ListItemText primary={label} slotProps={{ primary: { fontSize: 14, fontWeight: 500, noWrap: true } }} />}
    </ListItemButton>
  );
  return collapsed ? <Tooltip title={label} placement="right">{item}</Tooltip> : item;
}

function SidebarContent({ collapsed, onNavigate }) {
  const wsMatch = useMatch('/w/:workspaceId/*');
  const currentId = wsMatch?.params.workspaceId;
  const canManageUsers = useSelector(selectCan('user:manage'));
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const current = workspaces.find((w) => w._id === currentId);
  const { data: dataforms = [] } = useListDataformsQuery({ workspaceId: currentId }, { skip: !current });

  return (
    <Stack sx={{ height: '100%', px: 1.5, py: 2 }}>
      <Box sx={{ px: 0.75, pb: 2.5, height: 48, display: 'flex', alignItems: 'center' }}><Logo collapsed={collapsed} /></Box>
      <List disablePadding sx={{ flex: 1, overflowY: 'auto' }} component="nav" aria-label="Main">
        {!collapsed && <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '28px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workspace</ListSubheader>}
        <NavItem to="/workspaces" icon={<WorkspacesIcon />} label="All workspaces" collapsed={collapsed} onClick={onNavigate} />
        {current && <NavItem to={`/w/${current._id}`} icon={<HomeIcon />} label={current.name} collapsed={collapsed} end onClick={onNavigate} />}
        {current && dataforms.map((d) => <NavItem key={d._id} to={`/w/${current._id}/f/${d._id}`} icon={<TableIcon />} label={d.name} collapsed={collapsed} onClick={onNavigate} />)}
        {current && <NavItem to={`/w/${current._id}/tasks`} icon={<TaskIcon />} label="Workspace tasks" collapsed={collapsed} onClick={onNavigate} />}
        {current && <NavItem to={`/w/${current._id}/workflows`} icon={<AutoIcon />} label="Automation" collapsed={collapsed} onClick={onNavigate} />}
        {current && <NavItem to={`/w/${current._id}/reports`} icon={<ReportIcon />} label="Reports & analysis" collapsed={collapsed} onClick={onNavigate} />}
        <Divider sx={{ my: 1.5 }} />
        {!collapsed && <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '28px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Insights</ListSubheader>}
        <NavItem to="/tasks" icon={<TaskIcon />} label="My tasks" collapsed={collapsed} onClick={onNavigate} />
        <NavItem to="/notifications" icon={<BellIcon />} label="Notifications" collapsed={collapsed} onClick={onNavigate} />
        <NavItem to="/dashboards" icon={<DashboardIcon />} label="Dashboards" collapsed={collapsed} onClick={onNavigate} />
        <Divider sx={{ my: 1.5 }} />
        {!collapsed && <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '28px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Administration</ListSubheader>}
        <NavItem to="/team" icon={<PeopleIcon />} label={canManageUsers ? 'Team & roles' : 'Team'} collapsed={collapsed} onClick={onNavigate} />
        {canManageUsers && <NavItem to="/settings/integrations" icon={<PlugIcon />} label="Integrations" collapsed={collapsed} onClick={onNavigate} />}
        <NavItem to="/settings/account" icon={<BusinessIcon />} label="Account & usage" collapsed={collapsed} onClick={onNavigate} />
        <NavItem to="/settings/profile" icon={<PersonIcon />} label="Profile & preferences" collapsed={collapsed} onClick={onNavigate} />
      </List>
    </Stack>
  );
}

export default function Sidebar() {
  const theme = useTheme();
  const dispatch = useDispatch();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const collapsed = useSelector((s) => s.ui.sidebarCollapsed);
  const mobileOpen = useSelector((s) => s.ui.mobileNavOpen);

  if (!isDesktop) {
    return (
      <Drawer open={mobileOpen} onClose={() => dispatch(setMobileNav(false))} slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH } } }}>
        <SidebarContent collapsed={false} onNavigate={() => dispatch(setMobileNav(false))} />
      </Drawer>
    );
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      style={{
        position: 'sticky', top: 0, height: '100vh', flexShrink: 0, overflow: 'hidden',
        background: theme.palette.background.paper, borderRight: `1px solid ${theme.palette.divider}`,
      }}
    >
      <SidebarContent collapsed={collapsed} />
      <Box sx={{ position: 'absolute', bottom: 12, right: collapsed ? 'auto' : 12, left: collapsed ? 16 : 'auto' }}>
        <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
          <IconButton size="small" onClick={() => dispatch(toggleSidebar())} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </IconButton>
        </Tooltip>
      </Box>
    </motion.aside>
  );
}
