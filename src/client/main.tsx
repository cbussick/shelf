import React, { useCallback, useEffect, useState } from 'react';
import { toast, Toaster } from 'sonner';
import * as stylex from '@stylexjs/stylex';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { colors, styles } from './app.stylex';
// Bundle Sonner's CSS: the CSP intentionally blocks its runtime style-tag injection.
import 'sonner/dist/styles.css';
import './index.css';

let updateAvailable = false;
const updates = new EventTarget();
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => {
    updateAvailable = true;
    updates.dispatchEvent(new Event('available'));
  },
});

function UpdateNotice() {
  const [available, setAvailable] = useState(updateAvailable);
  const [applying, setApplying] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const show = () => setAvailable(true);
    const connection = () => setOnline(navigator.onLine);
    const check = () => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        void navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
      }
    };
    updates.addEventListener('available', show);
    if (updateAvailable) show();
    addEventListener('online', connection); addEventListener('offline', connection);
    document.addEventListener('visibilitychange', check);
    const interval = setInterval(check, 60_000);
    return () => {
      updates.removeEventListener('available', show);
      removeEventListener('online', connection); removeEventListener('offline', connection);
      document.removeEventListener('visibilitychange', check);
      clearInterval(interval);
    };
  }, []);
  const refresh = useCallback(async () => {
    setApplying(true);
    try {
      const controller = navigator.serviceWorker.controller;
      await updateSW(true);
      // Workers installed by older releases did not handle SKIP_WAITING. Fall back to
      // unregistering only if the new worker is still waiting after the request.
      setTimeout(() => {
        if (navigator.serviceWorker.controller !== controller || !navigator.onLine) return;
        void navigator.serviceWorker.getRegistration().then(async registration => {
          if (registration?.waiting) await registration.unregister();
          location.reload();
        }).catch(() => setApplying(false));
      }, 3000);
    } catch { setApplying(false); }
  }, []);
  useEffect(() => {
    if (!available) { toast.dismiss('app-update'); return; }
    toast('A new version of Shelf is ready. Finish editing before refreshing.', {
      id: 'app-update', duration: Infinity, dismissible: false, style: { flexWrap: 'wrap' },
      action: <button type="button" disabled={applying || !online} onClick={() => void refresh()} {...stylex.props(styles.updateButton)}>{applying ? 'Refreshing…' : 'Refresh app'}</button>,
      cancel: <button type="button" aria-label="Remind me later" onClick={() => setAvailable(false)} {...stylex.props(styles.updateDismiss)}>Later</button>,
    });
  }, [available, applying, online, refresh]);
  useEffect(() => () => { toast.dismiss('app-update'); }, []);
  return null;
}
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><App/><UpdateNotice/>
    <Toaster theme="dark" expand position="bottom-center" offset={{ bottom: 'calc(92px + env(safe-area-inset-bottom))' }} mobileOffset={{ bottom: 'calc(92px + env(safe-area-inset-bottom))', left: 16, right: 16 }} style={{ fontFamily: 'inherit' }} toastOptions={{ style: { background: colors.ink, borderColor: colors.ink, borderRadius: 10 }, cancelButtonStyle: { minHeight: 44 } }}/>
  </QueryClientProvider></React.StrictMode>,
);
