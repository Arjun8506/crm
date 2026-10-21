import { createSlice } from '@reduxjs/toolkit';

const KEY = 'orgcrm.ui';

// Only non-sensitive UI preferences are persisted.
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};

export const persistUi = (state) => {
  try {
    const { themeMode, sidebarCollapsed, currentWorkspaceId } = state.ui;
    localStorage.setItem(KEY, JSON.stringify({ themeMode, sidebarCollapsed, currentWorkspaceId }));
  } catch {
    /* storage unavailable */
  }
};

const saved = load();
let toastId = 0;

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    themeMode: saved.themeMode || 'system',
    sidebarCollapsed: !!saved.sidebarCollapsed,
    mobileNavOpen: false,
    currentWorkspaceId: saved.currentWorkspaceId || null,
    toast: null,
  },
  reducers: {
    setThemeMode: (s, a) => { s.themeMode = a.payload; },
    toggleSidebar: (s) => { s.sidebarCollapsed = !s.sidebarCollapsed; },
    setMobileNav: (s, a) => { s.mobileNavOpen = a.payload; },
    setCurrentWorkspace: (s, a) => { s.currentWorkspaceId = a.payload; },
    showToast: {
      reducer: (s, a) => { s.toast = a.payload; },
      prepare: (message, severity = 'success') => ({ payload: { id: ++toastId, message, severity } }),
    },
    hideToast: (s) => { s.toast = null; },
  },
});

export const { setThemeMode, toggleSidebar, setMobileNav, setCurrentWorkspace, showToast, hideToast } = uiSlice.actions;
export default uiSlice.reducer;
