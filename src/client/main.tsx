import React, { useEffect, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { styles } from './app.stylex';
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
  const refresh = async () => {
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
  };
  if (!available) return null;
  return <div role="status" {...stylex.props(styles.updateNotice)}>
    <span>A new version of Shelf is ready. Finish editing before refreshing.</span>
    <button type="button" disabled={applying || !online} onClick={() => void refresh()} {...stylex.props(styles.updateButton)}>{applying ? 'Refreshing…' : 'Refresh app'}</button>
    <button type="button" aria-label="Remind me later" onClick={() => setAvailable(false)} {...stylex.props(styles.updateDismiss)}>Later</button>
  </div>;
}
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><App/><UpdateNotice/></QueryClientProvider></React.StrictMode>,
);
