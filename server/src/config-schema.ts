// §14 admin config: one strict schema shared by draft validation, preview and
// publish. Anything the schema cannot prove is rejected — publish never
// happens on an unknown/incompatible field, so older clients cannot be broken
// by an accidental extra key.
import type { Family } from '../../src/games/plumber/domain/generator';
import { COLLECTIBLES } from '../../src/games/plumber/domain/progression';

export const CONFIG_SCHEMA_VERSION = 1;

const MODES = ['child', 'normal', 'expert'] as const;
export type ConfigMode = (typeof MODES)[number];

/** Mechanics the admin may toggle. Mirrors the generator families. */
export const ALLOWED_MECHANICS: Family[] = ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact'];
export const ALLOWED_MODULES = ['plumber', 'water-sort'];
export const ALLOWED_COLLECTIBLES = COLLECTIBLES.map((c) => c.id);

export interface PlumberConfig {
  game: string;
  generator: {
    families: Family[];
    seedSalt: number;
    difficulty: Record<ConfigMode, number>;
  };
  mechanics: Record<string, boolean>;
  collections: { enabled: string[] };
  challenges: { daily: number; weekly: number; modes: ConfigMode[] };
  modules: { enabled: string[] };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  config: PlumberConfig | null;
}

export function defaultConfig(gameId: string): PlumberConfig {
  return {
    game: gameId,
    generator: { families: [...ALLOWED_MECHANICS], seedSalt: 0, difficulty: { child: 8, normal: 10, expert: 12 } },
    mechanics: Object.fromEntries(ALLOWED_MECHANICS.map((m) => [m, true])),
    collections: { enabled: [...ALLOWED_COLLECTIBLES] },
    challenges: { daily: 7, weekly: 2, modes: [...MODES] },
    modules: { enabled: [...ALLOWED_MODULES] },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, errors: string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}: unknown field "${k}"`);
}

/**
 * Strict validation + normalisation. Unknown keys, wrong types, out-of-range
 * numbers and empty required collections are errors, not warnings.
 */
export function validateConfig(gameId: string, draft: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(draft)) return { ok: false, errors: ['config must be an object'], config: null };
  pickKeys(draft, ['game', 'generator', 'mechanics', 'collections', 'challenges', 'modules'], 'config', errors);

  const base = defaultConfig(gameId);

  const game = typeof draft.game === 'string' && draft.game ? draft.game : gameId;
  if (game !== gameId) errors.push(`config: game must be "${gameId}"`);

  // generator
  const gen = isPlainObject(draft.generator) ? draft.generator : {};
  if (draft.generator !== undefined && !isPlainObject(draft.generator)) errors.push('generator must be an object');
  pickKeys(gen, ['families', 'seedSalt', 'difficulty'], 'generator', errors);
  const families = gen.families === undefined ? base.generator.families : gen.families;
  if (!Array.isArray(families) || families.length === 0) errors.push('generator.families must be a non-empty array');
  else
    for (const f of families) if (!ALLOWED_MECHANICS.includes(f as Family)) errors.push(`generator.families: unknown family "${String(f)}"`);
  const seedSalt = gen.seedSalt === undefined ? base.generator.seedSalt : gen.seedSalt;
  if (typeof seedSalt !== 'number' || !Number.isInteger(seedSalt) || seedSalt < 0) errors.push('generator.seedSalt must be a non-negative integer');
  const difficulty: Record<string, number> = {};
  const diffIn = isPlainObject(gen.difficulty) ? gen.difficulty : {};
  if (gen.difficulty !== undefined && !isPlainObject(gen.difficulty)) errors.push('generator.difficulty must be an object');
  for (const m of MODES) {
    const v = (diffIn as Record<string, unknown>)[m] ?? base.generator.difficulty[m];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 4 || v > 20) errors.push(`generator.difficulty.${m} must be an integer 4..20`);
    else difficulty[m] = v;
  }

  // mechanics
  const mech = isPlainObject(draft.mechanics) ? draft.mechanics : {};
  if (draft.mechanics !== undefined && !isPlainObject(draft.mechanics)) errors.push('mechanics must be an object');
  pickKeys(mech, ALLOWED_MECHANICS, 'mechanics', errors);
  for (const [k, v] of Object.entries(mech)) if (typeof v !== 'boolean') errors.push(`mechanics.${k} must be boolean`);

  // collections
  const col = isPlainObject(draft.collections) ? draft.collections : {};
  if (draft.collections !== undefined && !isPlainObject(draft.collections)) errors.push('collections must be an object');
  pickKeys(col, ['enabled'], 'collections', errors);
  const enabled = col.enabled === undefined ? base.collections.enabled : col.enabled;
  if (!Array.isArray(enabled)) errors.push('collections.enabled must be an array');
  else for (const c of enabled) if (!ALLOWED_COLLECTIBLES.includes(String(c))) errors.push(`collections.enabled: unknown collectible "${String(c)}"`);

  // challenges
  const ch = isPlainObject(draft.challenges) ? draft.challenges : {};
  if (draft.challenges !== undefined && !isPlainObject(draft.challenges)) errors.push('challenges must be an object');
  pickKeys(ch, ['daily', 'weekly', 'modes'], 'challenges', errors);
  const daily = ch.daily === undefined ? base.challenges.daily : ch.daily;
  const weekly = ch.weekly === undefined ? base.challenges.weekly : ch.weekly;
  if (typeof daily !== 'number' || !Number.isInteger(daily) || daily < 7) errors.push('challenges.daily must be an integer >= 7');
  if (typeof weekly !== 'number' || !Number.isInteger(weekly) || weekly < 2) errors.push('challenges.weekly must be an integer >= 2');
  const chModes = ch.modes === undefined ? base.challenges.modes : ch.modes;
  if (!Array.isArray(chModes) || chModes.length === 0) errors.push('challenges.modes must be a non-empty array');
  else for (const m of chModes) if (!MODES.includes(m as ConfigMode)) errors.push(`challenges.modes: unknown mode "${String(m)}"`);

  // modules
  const mod = isPlainObject(draft.modules) ? draft.modules : {};
  if (draft.modules !== undefined && !isPlainObject(draft.modules)) errors.push('modules must be an object');
  pickKeys(mod, ['enabled'], 'modules', errors);
  const modEnabled = mod.enabled === undefined ? base.modules.enabled : mod.enabled;
  if (!Array.isArray(modEnabled) || modEnabled.length === 0) errors.push('modules.enabled must be a non-empty array');
  else for (const m of modEnabled) if (!ALLOWED_MODULES.includes(String(m))) errors.push(`modules.enabled: unknown module "${String(m)}"`);

  if (errors.length) return { ok: false, errors, config: null };

  return {
    ok: true,
    errors: [],
    config: {
      game: gameId,
      generator: { families: [...(families as Family[])], seedSalt: seedSalt as number, difficulty: difficulty as Record<ConfigMode, number> },
      mechanics: { ...base.mechanics, ...(mech as Record<string, boolean>) },
      collections: { enabled: [...(enabled as string[])] },
      challenges: { daily: daily as number, weekly: weekly as number, modes: [...(chModes as ConfigMode[])] },
      modules: { enabled: [...(modEnabled as string[])] },
    },
  };
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** Deterministic FNV-1a checksum over the normalised config. */
export function checksumConfig(config: PlumberConfig | unknown): string {
  const text = stable(config);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Flat, human-readable list of fields that differ between two configs. */
export function changedFields(prev: unknown, next: PlumberConfig): string[] {
  const flat = (v: unknown, prefix = ''): Record<string, string> => {
    if (!isPlainObject(v) && !Array.isArray(v)) return { [prefix || '.']: stable(v) };
    const out: Record<string, string> = {};
    if (Array.isArray(v)) return { [prefix || '.']: stable(v) };
    for (const [k, val] of Object.entries(v)) Object.assign(out, flat(val, prefix ? `${prefix}.${k}` : k));
    return out;
  };
  const a = flat(prev);
  const b = flat(next);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of [...keys].sort()) if (a[k] !== b[k]) out.push(k);
  return out;
}
