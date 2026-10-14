// PWA glue: install prompt capture + update prompt wiring.
// The service-worker registration itself is injected by vite-plugin-pwa.
let deferredPrompt: Event | null = null;
let installed = false;

export function initInstallCapture(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('mg:install-available'));
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('mg:installed'));
  });
}

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

export function isInstalled(): boolean {
  if (installed) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const e = deferredPrompt as unknown as {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  try {
    await e.prompt();
    const choice = await e.userChoice;
    deferredPrompt = null;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  }
}

export type UpdateFn = (reload: boolean) => Promise<void>;

let updateSW: UpdateFn | null = null;

export function setUpdateFn(fn: UpdateFn): void {
  updateSW = fn;
}

export function hasUpdate(): boolean {
  return updateSW !== null;
}

export async function applyUpdate(): Promise<void> {
  if (updateSW) await updateSW(true);
}
