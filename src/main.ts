import './styles/app.css';
import { Shell } from './app/shell';
import { registerWaterSort } from './games/water-sort';
import { initInstallCapture, setUpdateFn } from './platform/pwa/pwa';
// @ts-expect-error virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register';

async function bootstrap(): Promise<void> {
  registerWaterSort();
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
}

void bootstrap().catch((e) => {
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="fatal"><h2>MiniGames</h2><p>${e instanceof Error ? e.message : String(e)}</p></div>`;
});
