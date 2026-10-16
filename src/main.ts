import './styles/app.css';
import { Shell } from './app/shell';
import { registerWaterSort } from './games/water-sort';
import { registerPlumber } from './games/plumber';
import { initInstallCapture, setUpdateFn } from './platform/pwa/pwa';
// @ts-expect-error virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register';

async function bootstrap(): Promise<void> {
  registerWaterSort();
  registerPlumber();
  initInstallCapture();
  const update = registerSW({
    immediate: false,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent('mg:sw-update'));
    },
    onRegisteredSW(_url: string, _reg: ServiceWorkerRegistration | undefined) {
      // SW active; precache covers the shell + bundled game for offline use.
    },
  });
  setUpdateFn(async (reload: boolean) => {
    await update(reload);
  });
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app');
  const shell = new Shell(app);
  await shell.init();
  (window as unknown as { __MG_SHELL__?: Shell }).__MG_SHELL__ = shell;
  // Shared plumber level deep link: #/plumber-share/<base64url(def)>.
  const hash = location.hash;
  if (hash.startsWith('#/plumber-share/')) {
    try {
      const b64 = hash.slice('#/plumber-share/'.length).replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(escape(atob(b64)));
      const { setPendingSharedPlumber } = await import('./games/plumber/share-boot');
      if (setPendingSharedPlumber(json)) {
        await shell.playGame('plumber', 70001);
        history.replaceState(null, '', location.pathname);
      }
    } catch {
      /* ignore malformed share links */
    }
  }
}

void bootstrap().catch((e) => {
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="fatal"><h2>MiniGames</h2><p>${e instanceof Error ? e.message : String(e)}</p></div>`;
});
