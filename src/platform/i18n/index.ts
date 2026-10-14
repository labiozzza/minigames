import { en } from './en';
import { ru } from './ru';

export type Lang = 'ru' | 'en';
export type I18nKey = keyof typeof ru;

const dicts = { ru, en } as const;

export function isLang(v: unknown): v is Lang {
  return v === 'ru' || v === 'en';
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const d = dicts[lang] as Record<string, string>;
  let s = d[key] ?? (dicts.en as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
