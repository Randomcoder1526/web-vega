import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './PwaStatus.css';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Optional web-only UI. Never interrupts active playback with an automatic reload. */
export function PwaStatus() {
  const location = useLocation();
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [dismissed, setDismissed] = useState(false);
  const isPlayer = location.pathname === '/player' || location.pathname.startsWith('/player/');

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext || (window as any).__TAURI_INTERNALS__) return;
    let alive = true;
    const checkWorker = (registration: ServiceWorkerRegistration) => {
      if (alive && registration.waiting && navigator.serviceWorker.controller) {
        setUpdateWorker(registration.waiting);
      }
    };
    const onControllerChange = () => {
      // Refresh only after an explicit Apply update action.
      if (sessionStorage.getItem('vega-sw-user-approved') === 'true') {
        sessionStorage.removeItem('vega-sw-user-approved');
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (!alive) return;
      checkWorker(registration);
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', () => checkWorker(registration));
      });
    }).catch(() => { /* The app works even if a browser disallows offline features. */ });
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  useEffect(() => {
    const wentOnline = () => setOnline(true);
    const wentOffline = () => setOnline(false);
    const canInstall = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    const installed = () => setInstallEvent(null);
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    window.addEventListener('beforeinstallprompt', canInstall);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
      window.removeEventListener('beforeinstallprompt', canInstall);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if ((window as any).__TAURI_INTERNALS__ || isPlayer) return null;
  if (online && !updateWorker && (!installEvent || dismissed)) return null;
  return (
    <aside className="pwa-status" aria-live="polite" role="status">
      {!online && <span>Offline — the app shell may load, but provider data and videos need a connection.</span>}
      {online && updateWorker && <>
        <span>A Vega Web update is available.</span>
        <button type="button" onClick={() => {
          sessionStorage.setItem('vega-sw-user-approved', 'true');
          updateWorker.postMessage({ type: 'SKIP_WAITING' });
        }}>Update</button>
      </>}
      {online && !updateWorker && installEvent && !dismissed && <>
        <span>Install Vega Web for faster access.</span>
        <button type="button" onClick={() => {
          void installEvent.prompt().then(() => installEvent.userChoice).finally(() => setInstallEvent(null));
        }}>Install</button>
        <button type="button" aria-label="Dismiss install suggestion" onClick={() => setDismissed(true)}>×</button>
      </>}
    </aside>
  );
}
