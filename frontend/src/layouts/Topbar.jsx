import { useState } from 'react';
import { AppBar, Avatar, Box, Divider, IconButton, InputAdornment, ListItemIcon, Menu, MenuItem, Select, Stack, TextField, Toolbar, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useDispatch, useSelector } from 'react-redux';
import { useMatch, useNavigate } from 'react-router-dom';
import MenuIcon from '@mui/icons-material/MenuRounded';
import SearchIcon from '@mui/icons-material/SearchRounded';
import HelpIcon from '@mui/icons-material/HelpOutlineRounded';
import LightIcon from '@mui/icons-material/LightModeOutlined';
import DarkIcon from '@mui/icons-material/DarkModeOutlined';
import SystemIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import LogoutIcon from '@mui/icons-material/LogoutRounded';
import PersonIcon from '@mui/icons-material/PersonOutlineRounded';
import { setMobileNav, setThemeMode } from '../features/ui/uiSlice';
import { useLogoutMutation } from '../features/auth/authApi';
import { useListWorkspacesQuery } from '../features/workspaces/workspacesApi';
import NotificationBell from '../features/notifications/NotificationBell';

const MODES = [
  { value: 'light', label: 'Light', icon: <LightIcon fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkIcon fontSize="small" /> },
  { value: 'system', label: 'System', icon: <SystemIcon fontSize="small" /> },
];

function WorkspaceSelect() {
  const navigate = useNavigate();
  const match = useMatch('/w/:workspaceId/*');
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const value = workspaces.some((w) => w._id === match?.params.workspaceId) ? match.params.workspaceId : '';
  return (
    <Select
      size="small" displayEmpty value={value} onChange={(e) => navigate(`/w/${e.target.value}`)}
      SelectDisplayProps={{ 'aria-label': 'Select workspace' }} sx={{ minWidth: 190, maxWidth: 240, bgcolor: 'background.default' }}
      renderValue={(v) => (v ? workspaces.find((w) => w._id === v)?.name : <Typography color="text.secondary">Select workspace</Typography>)}
    >
      {workspaces.map((w) => (
        <MenuItem key={w._id} value={w._id}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: w.color, mr: 1.25 }} />{w.name}
        </MenuItem>
      ))}
    </Select>
  );
}

export default function Topbar() {
  const theme = useTheme();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const user = useSelector((s) => s.auth.user);
  const mode = useSelector((s) => s.ui.themeMode);
  const [logout] = useLogoutMutation();
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [themeAnchor, setThemeAnchor] = useState(null);
  const current = MODES.find((m) => m.value === mode);

  return (
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Toolbar sx={{ gap: 1.5 }}>
        {!isDesktop && <IconButton edge="start" onClick={() => dispatch(setMobileNav(true))} aria-label="Open navigation"><MenuIcon /></IconButton>}
        <WorkspaceSelect />
        {isDesktop && (
          <TextField
            placeholder="Search (coming soon)" disabled sx={{ flex: 1, maxWidth: 420, ml: 1 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Global search' } }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <Tooltip title="Theme"><IconButton onClick={(e) => setThemeAnchor(e.currentTarget)} aria-label="Change theme">{current.icon}</IconButton></Tooltip>
          <NotificationBell />
          {isDesktop && <Tooltip title="Help & feedback"><IconButton onClick={() => navigate('/help', { state: { from: window.location.pathname } })} aria-label="Help"><HelpIcon /></IconButton></Tooltip>}
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label="Account menu" sx={{ ml: 0.5 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>{user?.name?.[0]?.toUpperCase()}</Avatar>
          </IconButton>
        </Stack>
      </Toolbar>

      <Menu anchorEl={themeAnchor} open={!!themeAnchor} onClose={() => setThemeAnchor(null)}>
        {MODES.map((m) => (
          <MenuItem key={m.value} selected={m.value === mode} onClick={() => { dispatch(setThemeMode(m.value)); setThemeAnchor(null); }}>
            <ListItemIcon>{m.icon}</ListItemIcon>{m.label}
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)} slotProps={{ paper: { sx: { minWidth: 220 } } }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography fontWeight={600} noWrap>{user?.name}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{user?.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); navigate('/settings/profile'); }}><ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>Profile</MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); logout(); }}><ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>Sign out</MenuItem>
      </Menu>
    </AppBar>
  );
}
