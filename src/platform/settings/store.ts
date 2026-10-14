import { isLang, type Lang } from '../i18n';

export type Theme = 'system' | 'light' | 'dark';
export type Speed = 'normal' | 'fast' | 'instant';

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
};

export function sanitizeSettings(raw: unknown): Settings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fb);
  const theme: Theme = o.theme === 'light' || o.theme === 'dark' || o.theme === 'system' ? o.theme : 'system';
  const speed: Speed = o.speed === 'fast' || o.speed === 'instant' || o.speed === 'normal' ? o.speed : 'normal';
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
  };
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
