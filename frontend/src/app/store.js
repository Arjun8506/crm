import { configureStore } from '@reduxjs/toolkit';
import { api } from '../services/api';
import auth from '../features/auth/authSlice';
import ui, { persistUi } from '../features/ui/uiSlice';

export const store = configureStore({
  reducer: { [api.reducerPath]: api.reducer, auth, ui },
  middleware: (gdm) => gdm().concat(api.middleware),
});

let lastUi = store.getState().ui;
store.subscribe(() => {
  const next = store.getState().ui;
  if (next !== lastUi) {
    lastUi = next;
    persistUi(store.getState());
  }
});
