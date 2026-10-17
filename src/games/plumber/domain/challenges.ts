// Daily & weekly challenges (§10). Pure and deterministic: the same UTC day,
// kind and mode always yield the same task on every client and on the server,
// so an offline device can pre-compute a validated manifest without lying.
import type { Family } from './generator';
import type { Mode } from './progression';

export const CHALLENGE_VERSION = 'challenge/1';
/** Number of future validated daily tasks cached for offline play. */
export const CHALLENGE_HORIZON_DAYS = 7;
/** Number of future validated weekly tasks cached for offline play. */
export const CHALLENGE_HORIZON_WEEKS = 2;
export const CHALLENGE_MODES: Mode[] = ['child', 'normal', 'expert'];

export interface ChallengeSpec {
  id: string;
  kind: 'daily' | 'weekly';
  day: string;
  mode: Mode;
  seed: number;
  family: Family;
  version: string;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function isMode(m: string): m is Mode {
  return m === 'child' || m === 'normal' || m === 'expert';
}

export function challengeDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Monday 00:00 UTC of the week containing `now`, as YYYY-MM-DD. */
export function weekStartUTC(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function shiftDay(day: string, deltaDays: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + deltaDays * 86400000).toISOString().slice(0, 10);
}

const DAILY_FAMILIES: Family[] = ['path', 'leakfix', 'valve', 'filter', 'carry', 'multiflow', 'exact'];
const WEEKLY_FAMILIES: Family[] = ['mixer', 'program', 'multiflow', 'exact'];

/** Resolve a challenge id — identical on client and server. */
export function resolveChallenge(id: string, modeHint?: Mode): ChallengeSpec | null {
  const daily = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(id);
  const weekly = /^weekly-(\d{4}-\d{2}-\d{2})$/.exec(id);
  const day = daily?.[1] ?? weekly?.[1];
  if (!day || Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) return null;
  const kind: 'daily' | 'weekly' = daily ? 'daily' : 'weekly';
  const d = new Date(`${day}T00:00:00.000Z`);
  if (d.toISOString().slice(0, 10) !== day) return null;
  if (kind === 'weekly' && d.getUTCDay() !== 1) return null;
  const mode: Mode = modeHint && isMode(modeHint) ? modeHint : kind === 'weekly' ? 'expert' : 'normal';
  const seed = fnv(`${kind}:${mode}:${day}`);
  const pool = kind === 'weekly' ? WEEKLY_FAMILIES : DAILY_FAMILIES;
  const family = pool[seed % pool.length];
  return { id, kind, day, mode, seed, family, version: CHALLENGE_VERSION };
}

/** Current + future validated tasks (min 7 daily / 2 weekly) for offline play. */
export function localManifest(now = new Date(), mode?: Mode): ChallengeSpec[] {
  const today = challengeDay(now);
  const monday = weekStartUTC(now);
  const out: ChallengeSpec[] = [];
  for (let i = 0; i < CHALLENGE_HORIZON_DAYS; i++) {
    const c = resolveChallenge(`daily-${shiftDay(today, i)}`, mode);
    if (c) out.push(c);
  }
  for (let w = 0; w <= CHALLENGE_HORIZON_WEEKS; w++) {
    const c = resolveChallenge(`weekly-${shiftDay(monday, w * 7)}`, mode);
    if (c) out.push(c);
  }
  return out;
}

export function currentDaily(now = new Date(), mode?: Mode): ChallengeSpec | null {
  return resolveChallenge(`daily-${challengeDay(now)}`, mode);
}

export function currentWeekly(now = new Date(), mode?: Mode): ChallengeSpec | null {
  return resolveChallenge(`weekly-${weekStartUTC(now)}`, mode);
}

/** Archive days strictly before today (misses are allowed, never penalised). */
export function archiveEntries(progress: Record<string, number>, kind: 'daily' | 'weekly', now = new Date()): Array<{ day: string; stars: number }> {
  const prefix = kind === 'daily' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  const cutoff = kind === 'daily' ? challengeDay(now) : weekStartUTC(now);
  return Object.entries(progress)
    .filter(([day]) => prefix.test(day) && day < cutoff)
    .map(([day, stars]) => ({ day, stars }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}
