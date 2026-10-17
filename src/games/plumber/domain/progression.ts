// Plumber progression: families per level, stars, adaptation, collections,
// daily challenges and share codes. All pure and deterministic.
import type { Family } from './generator';

export type Mode = 'child' | 'normal' | 'expert';

export function modeForLevel(level: number): Mode {
  return level <= 2 ? 'child' : level <= 12 ? 'normal' : 'expert';
}

const CURRICULUM: Family[] = [
  'path', 'path', 'path', 'leakfix', 'valve', 'filter',
  'carry', 'path', 'multiflow', 'exact', 'mixer', 'valve',
];

/** Deterministic family for a level number (curriculum then stable cycle). */
export function familyForLevel(level: number): Family {
  if (level <= CURRICULUM.length) return CURRICULUM[level - 1];
  const rest: Family[] = ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact', 'branch'];
  // Stable pseudo-random pick by level (no Math.random).
  let x = (level * 2654435761) >>> 0;
  x ^= x >> 15;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  return rest[x % rest.length];
}

// Per-mode curriculum (§5): level numbers are local to each mode, so the family
// schedule must depend on the mode, not on a shared global level number. Pools
// mirror the generator's per-mode family table so we never force a family the
// mode cannot build.
const MODE_POOL: Record<Mode, Family[]> = {
  child: ['path', 'leakfix', 'branch'],
  normal: ['path', 'leakfix', 'valve', 'filter', 'carry', 'multiflow', 'exact', 'branch'],
  expert: ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact', 'branch'],
};

const MODE_CURRICULUM: Record<Mode, Family[]> = {
  child: ['path', 'path', 'path', 'leakfix', 'branch'],
  normal: ['path', 'path', 'path', 'leakfix', 'valve', 'filter', 'carry', 'path', 'multiflow', 'exact', 'valve', 'filter', 'branch'],
  expert: ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact', 'program', 'mixer', 'exact', 'branch'],
};

/** Deterministic per-mode family: curriculum first, then a stable cycle. */
export function familyForMode(mode: Mode, level: number): Family {
  const c = MODE_CURRICULUM[mode];
  if (level <= c.length) return c[level - 1];
  const pool = MODE_POOL[mode];
  let x = (level * 2654435761) >>> 0;
  x ^= x >> 15;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  return pool[x % pool.length];
}

/** Stars from efficiency: witness par vs player rotations + hints. */
export function computeStars(parRotations: number, playerRotations: number, hintsUsed: number): 1 | 2 | 3 {
  const score = playerRotations - parRotations + hintsUsed * 2;
  if (score <= 0) return 3;
  if (score <= 4) return 2;
  return 1;
}

export interface ModeStats {
  attempts: number;
  wins: number;
  hints: number;
  skips: number;
}

/** Suggest difficulty nudge from stats: 'easier' after repeated failure. */
export function suggestNudge(stats: ModeStats): 'easier' | 'steady' | 'harder' {
  if (stats.attempts >= 4 && stats.wins === 0) return 'easier';
  if (stats.attempts >= 3 && stats.wins / stats.attempts < 0.34) return 'easier';
  if (stats.wins >= 5 && stats.hints === 0) return 'harder';
  return 'steady';
}

// ---------- collections ----------

export type ThemeId = 'garden' | 'city' | 'industry' | 'special';

export interface Theme {
  id: ThemeId;
  /** i18n key for the set name. */
  nameKey: string;
}

export const THEMES: Theme[] = [
  { id: 'garden', nameKey: 'plumber.theme.garden' },
  { id: 'city', nameKey: 'plumber.theme.city' },
  { id: 'industry', nameKey: 'plumber.theme.industry' },
  { id: 'special', nameKey: 'plumber.theme.special' },
];

export interface Collectible {
  id: string;
  /** Atlas frame for the album icon (final art). */
  frame: string;
  /** Thematic set the reward belongs to. */
  theme: ThemeId;
  /** Unique story object name (i18n key) — never a bare fitting. */
  projectKey: string;
  /** Prototype shape used until final art lands (BLOCKED_ASSET). */
  shape: string;
  /** Bump when the object's art/behaviour changes. */
  version: number;
  rule: { type: 'winFamily'; family: Family } | { type: 'wins'; count: number } | { type: 'stars'; count: number } | { type: 'winMode'; mode: Mode };
}

export const COLLECTIBLES: Collectible[] = [
  { id: 'pipe-straight', frame: 'pipe_straight', theme: 'garden', projectKey: 'plumber.project.watering-can', shape: 'can', version: 1, rule: { type: 'wins', count: 1 } },
  { id: 'pipe-elbow', frame: 'pipe_elbow', theme: 'garden', projectKey: 'plumber.project.fountain', shape: 'fountain', version: 1, rule: { type: 'wins', count: 2 } },
  { id: 'pipe-t', frame: 'pipe_t', theme: 'garden', projectKey: 'plumber.project.arch', shape: 'arch', version: 1, rule: { type: 'winFamily', family: 'multiflow' } },
  { id: 'pipe-cross', frame: 'pipe_cross', theme: 'city', projectKey: 'plumber.project.city-fountain', shape: 'fountain', version: 1, rule: { type: 'winFamily', family: 'multiflow' } },
  { id: 'pipe-cap', frame: 'pipe_cap', theme: 'city', projectKey: 'plumber.project.leak-repair', shape: 'patch', version: 1, rule: { type: 'winFamily', family: 'leakfix' } },
  { id: 'valve', frame: 'valve_basic', theme: 'city', projectKey: 'plumber.project.hydrant', shape: 'hydrant', version: 1, rule: { type: 'winFamily', family: 'valve' } },
  { id: 'filter', frame: 'filter_basic', theme: 'industry', projectKey: 'plumber.project.waterworks', shape: 'tank', version: 1, rule: { type: 'winFamily', family: 'filter' } },
  { id: 'mixer', frame: 'mixer_basic', theme: 'industry', projectKey: 'plumber.project.plant', shape: 'mixer', version: 1, rule: { type: 'winFamily', family: 'mixer' } },
  { id: 'distributor', frame: 'distributor_basic', theme: 'industry', projectKey: 'plumber.project.turbine', shape: 'turbine', version: 1, rule: { type: 'winFamily', family: 'exact' } },
  { id: 'source', frame: 'source_basic', theme: 'special', projectKey: 'plumber.project.well', shape: 'well', version: 1, rule: { type: 'winMode', mode: 'normal' } },
  { id: 'receiver', frame: 'receiver_basic', theme: 'special', projectKey: 'plumber.project.tower', shape: 'tower', version: 1, rule: { type: 'stars', count: 10 } },
  { id: 'master', frame: 'pipe_cross', theme: 'special', projectKey: 'plumber.project.aqueduct', shape: 'aqueduct', version: 1, rule: { type: 'winMode', mode: 'expert' } },
];

/** Theme of a level, derived from its goals (receiver colour + family). */
export function themeForGoals(color: string | undefined, family: string): ThemeId {
  if (family === 'mixer' || family === 'filter' || family === 'exact' || color === 'purple') return 'industry';
  if (family === 'multiflow' || family === 'valve' || family === 'leakfix' || color === 'red') return 'city';
  if (family === 'carry' || family === 'program' || color === 'yellow') return 'special';
  return 'garden';
}

export interface ProgressSummary {
  wins: number;
  stars: number;
  familiesWon: string[];
  modesWon: Mode[];
}

/** Newly unlocked collectible ids given a progress summary + already owned. */
export function unlockedCollectibles(summary: ProgressSummary, owned: string[]): string[] {
  const out: string[] = [];
  for (const c of COLLECTIBLES) {
    if (owned.includes(c.id)) continue;
    const r = c.rule;
    if (r.type === 'wins' && summary.wins >= r.count) out.push(c.id);
    else if (r.type === 'stars' && summary.stars >= r.count) out.push(c.id);
    else if (r.type === 'winFamily' && summary.familiesWon.includes(r.family)) out.push(c.id);
    else if (r.type === 'winMode' && summary.modesWon.includes(r.mode)) out.push(c.id);
  }
  return out;
}

// ---------- daily & share ----------

export function utcDayString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function dailyPuzzleId(day = utcDayString()): string {
  return `daily-${day}`;
}

export function dailySeed(day = utcDayString()): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Short share code for generated levels: P-<mode>-<level>. */
export function shareCode(mode: Mode, level: number): string {
  return `P-${mode[0].toUpperCase()}-${level}`;
}

const CODE_RE = /^P-([CNE])-(\d{1,6})$/i;

/** Parse a share code back to mode+level. Null when invalid. */
export function parseShareCode(code: string): { mode: Mode; level: number } | null {
  const m = CODE_RE.exec(code.trim());
  if (!m) return null;
  const mode = m[1].toUpperCase() === 'C' ? 'child' : m[1].toUpperCase() === 'E' ? 'expert' : 'normal';
  const level = Math.max(1, Math.floor(Number(m[2])));
  if (!Number.isFinite(level)) return null;
  return { mode, level };
}
