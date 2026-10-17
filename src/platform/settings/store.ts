import { isLang, type Lang } from '../i18n';

export type Theme = 'system' | 'light' | 'dark';
export type Speed = 'normal' | 'fast' | 'instant';
export type Quality = 'auto' | 'high' | 'low';

export interface Settings {
  theme: Theme;
  lang: Lang;
  music: boolean;
  musicVolume: number;
  sfx: boolean;
  sfxVolume: number;
  vibration: boolean;
  speed: Speed;
  symbols: boolean;
  installDismissed: boolean;
  /** §12 accessibility (shared across MiniGames, game-specific parts applied by each scene). */
  contrast: boolean;
  largeUi: boolean;
  reducedMotion: boolean;
  flashFree: boolean;
  noDrag: boolean;
  /** §12 graphics: auto-degrade on measured FPS drop, or pinned by the user. */
  quality: Quality;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  lang: 'ru',
  music: true,
  musicVolume: 0.5,
  sfx: true,
  sfxVolume: 0.7,
  vibration: true,
  speed: 'normal',
  symbols: false,
  installDismissed: false,
  contrast: false,
  largeUi: false,
  reducedMotion: false,
  flashFree: false,
  noDrag: false,
  quality: 'auto',
};

export function sanitizeSettings(raw: unknown): Settings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fb);
  const theme: Theme = o.theme === 'light' || o.theme === 'dark' || o.theme === 'system' ? o.theme : 'system';
  const speed: Speed = o.speed === 'fast' || o.speed === 'instant' || o.speed === 'normal' ? o.speed : 'normal';
  const quality: Quality = o.quality === 'high' || o.quality === 'low' ? o.quality : 'auto';
  return {
    theme,
    lang: isLang(o.lang) ? o.lang : 'ru',
    music: typeof o.music === 'boolean' ? o.music : true,
    musicVolume: num(o.musicVolume, 0.5),
    sfx: typeof o.sfx === 'boolean' ? o.sfx : true,
    sfxVolume: num(o.sfxVolume, 0.7),
    vibration: typeof o.vibration === 'boolean' ? o.vibration : true,
    speed,
    symbols: o.symbols === true,
    installDismissed: o.installDismissed === true,
    contrast: o.contrast === true,
    largeUi: o.largeUi === true,
    reducedMotion: o.reducedMotion === true,
    flashFree: o.flashFree === true,
    noDrag: o.noDrag === true,
    quality,
  };
}

/** Root classes that reflect the shared accessibility settings onto the DOM. */
export function a11yClasses(s: Settings): string[] {
  const out: string[] = [];
  if (s.contrast) out.push('a11y-contrast');
  if (s.largeUi) out.push('a11y-large');
  if (s.reducedMotion) out.push('a11y-reduce-motion');
  if (s.flashFree) out.push('a11y-flash-free');
  return out;
}

/**
 * §12 conflict rule for settings sync: a value the user actually customised on
 * this device wins; a field still at its default adopts the profile value.
 */
export function mergeSettings(local: Settings, remote: Settings): Settings {
  const r = sanitizeSettings(remote);
  const l = sanitizeSettings(local);
  const out = { ...r } as Settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (l[key] !== DEFAULT_SETTINGS[key]) (out as unknown as Record<string, unknown>)[key] = l[key];
  }
  return sanitizeSettings(out);
}

export function resolveTheme(s: Settings): 'light' | 'dark' {
  if (s.theme === 'light' || s.theme === 'dark') return s.theme;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function speedMs(s: Settings): { lift: number; pour: number; settle: number } {
  if (s.speed === 'instant') return { lift: 0, pour: 30, settle: 0 };
  if (s.speed === 'fast') return { lift: 90, pour: 260, settle: 90 };
  return { lift: 160, pour: 520, settle: 160 };
}
