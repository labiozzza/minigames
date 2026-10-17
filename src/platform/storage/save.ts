// Versioned local save model, export/import with integrity checksum.
// The checksum detects accidental corruption; it is NOT an authenticity guarantee.
import { kvDel, kvGet, kvSet } from './idb';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../settings/store';

export const SAVE_KEY = 'save-v1';
export const BACKUP_KEY = 'save-backup-v1';
export const SAVE_SCHEMA = 2;
export const EXPORT_FORMAT = 'minigames-progress/1';

export interface WaterSortSessionSave {
  levelNumber: number;
  tubes: Array<{ id: string; layers: Array<{ id: string; color: string }> }>;
  known: string[];
  history: Array<{ from: number; to: number; count: number; color: string }>;
  seed: number;
  attempt: number;
  generatorVersion: string;
  balanceVersion: string;
  colors: string[];
  hidden: string[];
  checksum: string;
  updatedAt: number;
}

export interface WaterSortSave {
  maxLevel: number;
  completed: number[];
  active: WaterSortSessionSave | null;
  tutorialBasic: boolean;
  tutorialMystery: boolean;
}

export interface SaveData {
  schemaVersion: number;
  settings: Settings;
  games: Record<string, GameSave>;
  lastPlayed: { gameId: string; levelNumber: number } | null;
  /** Unresolved sync conflicts: keep BOTH snapshots, never silently overwrite. */
  conflicts?: Record<string, { local: unknown; remote: unknown; at: number }>;
  updatedAt: number;
}

export function emptyWaterSort(): WaterSortSave {
  return { maxLevel: 1, completed: [], active: null, tutorialBasic: false, tutorialMystery: false };
}

export type PlumberPhase = 'PREPARING' | 'RUNNING' | 'PAUSED' | 'WON' | 'FAILED' | 'STOPPED';

export interface PlumberDefSave {
  cells: Array<{ kind: string; rot: number; valveOpen?: boolean; locked?: boolean; filterAllow?: string[]; recipeIn?: Record<string, number>; recipeOut?: { color: string; count: number }; ratio?: [number, number]; outlet?: string }>;
  sources: Array<{ cell: number; color: string; portions: number; enabled?: boolean }>;
  receivers: Array<{ cell: number; color: string; goal: number; kind?: string; outlet?: string; releaseEvery?: number; bufferCap?: number }>;
  solutionWitness: Array<{ type: string; index?: number; kind?: string; cmd?: { type: string; source?: number; count?: number; state?: boolean; index?: number } }>;
  puzzleId: string;
  seed: number;
  mode: 'child' | 'normal' | 'expert';
  family?: string;
  gridW: number;
  gridH: number;
  dynamic?: boolean;
  programmed?: boolean;
  program?: Array<{ type: string; source?: number; count?: number; state?: boolean; index?: number }>;
  inventory?: string[];
}

const PLUMBER_KINDS = ['empty', 'blocked', 'straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor', 'source', 'receiver'];
const PLUMBER_RECEIVERS = ['auto', 'overflow', 'exact', 'buffer'];

function isPlumberDef(d: unknown, gridW: number, gridH: number): d is PlumberDefSave {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  if (!Array.isArray(o.cells) || o.cells.length !== gridW * gridH) return false;
  for (const c of o.cells) {
    if (!c || typeof c !== 'object') return false;
    const cc = c as Record<string, unknown>;
    if (!PLUMBER_KINDS.includes(cc.kind as string)) return false;
    if (typeof cc.rot !== 'number') return false;
  }
  if (!Array.isArray(o.sources) || !Array.isArray(o.receivers) || !Array.isArray(o.solutionWitness)) return false;
  for (const s of o.sources as Record<string, unknown>[]) {
    if (typeof s.cell !== 'number' || typeof s.color !== 'string' || typeof s.portions !== 'number') return false;
  }
  for (const r of o.receivers as Record<string, unknown>[]) {
    if (typeof r.cell !== 'number' || typeof r.color !== 'string' || typeof r.goal !== 'number') return false;
    if (r.kind !== undefined && !PLUMBER_RECEIVERS.includes(r.kind as string)) return false;
  }
  return typeof o.puzzleId === 'string' && typeof o.seed === 'number';
}

export interface PlumberSessionSave {
  levelNumber: number;
  puzzleId: string;
  seed: number;
  mode: 'child' | 'normal' | 'expert';
  gridW: number;
  gridH: number;
  rots: number[];
  kinds: Array<string | null>;
  liveConfig: Array<null | { kind: string; filterAllow?: string[]; recipeIn?: Record<string, number>; recipeOut?: { color: string; count: number }; ratio?: [number, number] }>;
  water: number[];
  waterColor: Array<string | null>;
  valves: boolean[];
  mixerStock: Array<Array<{ color: string; count: number }>>;
  distCount: number[];
  sourceLeft: number[];
  sourceEnabled: boolean[];
  receiverGot: number[];
  receivedTotal: number[];
  fedTotal: number;
  carried: { kind: string } | null;
  cameFrom: Array<string | null>;
  inventoryLeft: string[];
  program: Array<{ type: string; source?: number; count?: number; state?: boolean; index?: number }>;
  programCounter: number;
  lost: number;
  tick: number;
  idleTicks: number;
  phase: PlumberPhase;
  playerRotations: number;
  hintsUsed: number;
  def: PlumberDefSave;
  updatedAt: number;
}

export interface PlumberModeStats {
  attempts: number;
  wins: number;
  hints: number;
  skips: number;
}

export type PlumberMode = 'child' | 'normal' | 'expert';

/** Independent progress for one difficulty mode (TZ v1.2 §5). */
export interface PlumberModeProgress {
  maxLevel: number;
  completed: number[];
  active: PlumberSessionSave | null;
}

export interface PlumberSave {
  maxLevel: number;
  completed: number[];
  active: PlumberSessionSave | null;
  tutorialSeen: boolean;
  /** Mechanics already taught by the onboarding guide (§8). */
  tutorial: string[];
  stars: Record<string, number>;
  collections: string[];
  stats: Record<'child' | 'normal' | 'expert', PlumberModeStats>;
  dailies: Record<string, number>;
  /** week (Monday, YYYY-MM-DD) -> best stars; local weekly archive (§10). */
  weeklies: Record<string, number>;
  /** level -> {family, mode} recorded at win time (collections/stats). */
  fams: Record<string, { family: string; mode: string }>;
  /** Per-mode independent progress; `selected` is the last chosen mode. */
  modes: Record<PlumberMode, PlumberModeProgress>;
  selected: PlumberMode;
}

export const PLUMBER_MODES: PlumberMode[] = ['child', 'normal', 'expert'];

/** First global level number of each mode in the legacy single progression. */
const LEGACY_OFFSET: Record<PlumberMode, number> = { child: 1, normal: 3, expert: 13 };

/** Mode a legacy (single-track) level number belonged to. */
function legacyModeOf(level: number): PlumberMode {
  return level <= 2 ? 'child' : level <= 12 ? 'normal' : 'expert';
}

function emptyModeProgress(): PlumberModeProgress {
  return { maxLevel: 1, completed: [], active: null };
}

export type GameSave = WaterSortSave | PlumberSave;

function validStars(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === 'number' && (n === 1 || n === 2 || n === 3)) out[k] = n;
  }
  return out;
}

function validStats(v: unknown): Record<'child' | 'normal' | 'expert', PlumberModeStats> {
  const blank = (): PlumberModeStats => ({ attempts: 0, wins: 0, hints: 0, skips: 0 });
  const out = { child: blank(), normal: blank(), expert: blank() };
  if (v && typeof v === 'object') {
    for (const m of ['child', 'normal', 'expert'] as const) {
      const s = (v as Record<string, unknown>)[m];
      if (s && typeof s === 'object') {
        const so = s as Record<string, unknown>;
        for (const k of ['attempts', 'wins', 'hints', 'skips'] as const) {
          if (typeof so[k] === 'number' && Number.isFinite(so[k])) out[m][k] = Math.max(0, Math.floor(so[k] as number));
        }
      }
    }
  }
  return out;
}

function validDailies(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof n === 'number' && (n === 1 || n === 2 || n === 3)) out[k] = n;
  }
  return out;
}

function validFams(v: unknown): Record<string, { family: string; mode: string }> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, { family: string; mode: string }> = {};
  for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
    if (/^\d{1,7}$/.test(k) && e && typeof e === 'object') {
      const eo = e as Record<string, unknown>;
      if (typeof eo.family === 'string' && (eo.mode === 'child' || eo.mode === 'normal' || eo.mode === 'expert')) {
        out[k] = { family: eo.family, mode: eo.mode };
      }
    }
  }
  return out;
}

const numArrOf = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
const boolArrOf = (v: unknown, len: number): v is boolean[] => Array.isArray(v) && v.length === len && v.every((n) => typeof n === 'boolean');
const PHASES = ['PREPARING', 'RUNNING', 'PAUSED', 'WON', 'FAILED', 'STOPPED'];

/** Validate + backfill a stored unfinished plumber session. Never throws. */
function parsePlumberActive(raw: unknown): PlumberSessionSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (
    typeof a.levelNumber !== 'number' || typeof a.puzzleId !== 'string' || typeof a.seed !== 'number' ||
    (a.mode !== 'child' && a.mode !== 'normal' && a.mode !== 'expert') ||
    typeof a.gridW !== 'number' || typeof a.gridH !== 'number' ||
    !numArrOf(a.rots) || !numArrOf(a.water) || !Array.isArray(a.waterColor) ||
    !numArrOf(a.sourceLeft) || !numArrOf(a.receiverGot) ||
    typeof a.lost !== 'number' || typeof a.tick !== 'number' || typeof a.phase !== 'string' || !PHASES.includes(a.phase)
  ) {
    return null;
  }
  const cells = (a.gridW as number) * (a.gridH as number);
  const srcs = (a.sourceLeft as number[]).length;
  if (a.rots.length !== cells || a.water.length !== cells || (a.waterColor as unknown[]).length !== cells) return null;
  if (!isPlumberDef(a.def, a.gridW as number, a.gridH as number)) return null;
  const full = a as unknown as PlumberSessionSave;
  if (!boolArrOf(full.valves, cells)) full.valves = new Array<boolean>(cells).fill(true);
  if (!Array.isArray(full.mixerStock)) full.mixerStock = Array.from({ length: cells }, () => []);
  if (!numArrOf(full.distCount)) full.distCount = new Array<number>(cells).fill(0);
  if (!boolArrOf(full.sourceEnabled, srcs)) full.sourceEnabled = new Array<boolean>(srcs).fill(true);
  if (!numArrOf(full.receivedTotal)) full.receivedTotal = [...full.receiverGot];
  if (typeof full.fedTotal !== 'number') full.fedTotal = 0;
  if (!Array.isArray(full.inventoryLeft)) full.inventoryLeft = [];
  if (!Array.isArray(full.program)) full.program = [];
  if (!Array.isArray(full.cameFrom)) full.cameFrom = [];
  if (typeof full.programCounter !== 'number') full.programCounter = 0;
  if (typeof full.idleTicks !== 'number') full.idleTicks = 0;
  if (typeof full.playerRotations !== 'number') full.playerRotations = 0;
  if (typeof full.hintsUsed !== 'number') full.hintsUsed = 0;
  return full;
}

function validCompleted(v: unknown): number[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1))].sort((a, b) => a - b)
    : [];
}

function parseModes(raw: unknown): Record<PlumberMode, PlumberModeProgress> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!o.child && !o.normal && !o.expert) return null;
  const out: Record<PlumberMode, PlumberModeProgress> = { child: emptyModeProgress(), normal: emptyModeProgress(), expert: emptyModeProgress() };
  for (const m of PLUMBER_MODES) {
    const mp = o[m];
    if (!mp || typeof mp !== 'object') continue;
    const mpo = mp as Record<string, unknown>;
    out[m].completed = validCompleted(mpo.completed);
    out[m].maxLevel = typeof mpo.maxLevel === 'number' && Number.isFinite(mpo.maxLevel)
      ? Math.max(1, Math.floor(mpo.maxLevel))
      : Math.max(1, (out[m].completed[out[m].completed.length - 1] ?? 0) + 1);
    out[m].active = parsePlumberActive(mpo.active);
  }
  return out;
}

export function emptyPlumber(): PlumberSave {
  return {
    maxLevel: 1,
    completed: [],
    active: null,
    tutorialSeen: false,
    stars: {},
    collections: [],
    stats: { child: { attempts: 0, wins: 0, hints: 0, skips: 0 }, normal: { attempts: 0, wins: 0, hints: 0, skips: 0 }, expert: { attempts: 0, wins: 0, hints: 0, skips: 0 } },
    dailies: {},
    weeklies: {},
    fams: {},
    modes: { child: emptyModeProgress(), normal: emptyModeProgress(), expert: emptyModeProgress() },
    selected: 'child',
    tutorial: [],
  };
}

/** Keep the legacy flat fields mirrored to the selected mode (readers/compat). */
export function syncPlumberMirror(slot: PlumberSave): void {
  const p = slot.modes[slot.selected];
  slot.maxLevel = p.maxLevel;
  slot.completed = [...p.completed];
  slot.active = p.active;
}

/**
 * Migrate a legacy (pre-modes) plumber slot to per-mode progress. Levels are
 * renumbered to 1-based within each mode; stars/fams keys are renumbered so no
 * progress is lost. Pure and deterministic.
 */
function deriveModesFromLegacy(
  completed: number[],
  stars: Record<string, number>,
  fams: Record<string, { family: string; mode: string }>,
  active: PlumberSessionSave | null,
): { modes: Record<PlumberMode, PlumberModeProgress>; stars: Record<string, number>; fams: Record<string, { family: string; mode: string }>; selected: PlumberMode } {
  const modes: Record<PlumberMode, PlumberModeProgress> = { child: emptyModeProgress(), normal: emptyModeProgress(), expert: emptyModeProgress() };
  const local = (m: PlumberMode, level: number): number => Math.max(1, level - LEGACY_OFFSET[m] + 1);
  for (const level of completed) {
    const m = legacyModeOf(level);
    const lv = local(m, level);
    if (!modes[m].completed.includes(lv)) modes[m].completed.push(lv);
  }
  for (const m of PLUMBER_MODES) {
    modes[m].completed.sort((a, b) => a - b);
    modes[m].maxLevel = Math.max(1, (modes[m].completed[modes[m].completed.length - 1] ?? 0) + 1);
  }
  const starsOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(stars)) {
    const mm = /^(child|normal|expert):(\d+)$/.exec(k);
    if (mm) {
      const m = mm[1] as PlumberMode;
      starsOut[`${m}:${local(m, Number(mm[2]))}`] = v;
    } else {
      starsOut[k] = v;
    }
  }
  const famsOut: Record<string, { family: string; mode: string }> = {};
  for (const [k, v] of Object.entries(fams)) {
    const m = (v.mode === 'child' || v.mode === 'normal' || v.mode === 'expert' ? v.mode : legacyModeOf(Number(k))) as PlumberMode;
    famsOut[String(local(m, Number(k)))] = v;
  }
  let selected: PlumberMode = 'child';
  if (active) {
    const m = (active.mode as PlumberMode) ?? 'child';
    const lv = local(m, active.levelNumber);
    active = { ...active, levelNumber: lv };
    modes[m].active = active;
    selected = m;
  } else {
    // No unfinished session: resume the mode the player progressed furthest in.
    selected = PLUMBER_MODES.reduce((best, m) => (modes[m].maxLevel > modes[best].maxLevel ? m : best), 'child' as PlumberMode);
  }
  return { modes, stars: starsOut, fams: famsOut, selected };
}

/** Narrow a stored game slot to WaterSort (never throws, returns defaults). */
export function getWaterSortSave(save: SaveData): WaterSortSave {
  const g = save.games['water-sort'] as WaterSortSave | undefined;
  if (g && typeof g.maxLevel === 'number' && Array.isArray(g.completed)) return g;
  const fresh = emptyWaterSort();
  save.games['water-sort'] = fresh;
  return fresh;
}

/** Narrow a stored game slot to Plumber (never throws, returns defaults). */
export function getPlumberSave(save: SaveData): PlumberSave {
  const g = save.games['plumber'] as PlumberSave | undefined;
  if (g && typeof g.maxLevel === 'number' && Array.isArray(g.completed)) {
    // Backfill fields added after earlier releases (subset-compatible upgrade).
    if (!g.stars || typeof g.stars !== 'object') g.stars = {};
    if (!Array.isArray(g.collections)) g.collections = [];
    if (!g.stats || typeof g.stats !== 'object') {
      g.stats = { child: { attempts: 0, wins: 0, hints: 0, skips: 0 }, normal: { attempts: 0, wins: 0, hints: 0, skips: 0 }, expert: { attempts: 0, wins: 0, hints: 0, skips: 0 } };
    }
    if (!g.dailies || typeof g.dailies !== 'object') g.dailies = {};
    if (!g.fams || typeof g.fams !== 'object') g.fams = {};
    if (!Array.isArray(g.tutorial)) g.tutorial = [];
    if (!g.weeklies || typeof g.weeklies !== 'object') g.weeklies = {};
    if (!g.modes || typeof g.modes !== 'object' || !g.modes.child || !g.modes.normal || !g.modes.expert) {
      const legacy: PlumberSave = { ...emptyPlumber(), ...g };
      const derived = deriveModesFromLegacy(
        Array.isArray(legacy.completed) ? legacy.completed : [],
        legacy.stars ?? {},
        legacy.fams ?? {},
        legacy.active ?? null,
      );
      g.modes = derived.modes;
      g.stars = derived.stars;
      g.fams = derived.fams;
      g.selected = derived.selected;
    }
    if (g.selected !== 'child' && g.selected !== 'expert' && g.selected !== 'normal') g.selected = 'child';
    syncPlumberMirror(g);
    return g;
  }
  const fresh = emptyPlumber();
  save.games['plumber'] = fresh;
  return fresh;
}

export function emptySave(): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA,
    settings: { ...DEFAULT_SETTINGS },
    games: { 'water-sort': emptyWaterSort(), 'plumber': emptyPlumber() },
    lastPlayed: null,
    updatedAt: Date.now(),
  };
}

function hasProtoKey(o: unknown): boolean {
  if (Array.isArray(o)) return o.some(hasProtoKey);
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
      if (hasProtoKey((o as Record<string, unknown>)[k])) return true;
    }
  }
  return false;
}

export function sanitizeSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object' || hasProtoKey(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.schemaVersion !== 'number' || o.schemaVersion < 1 || o.schemaVersion > SAVE_SCHEMA) return null;
  const save = emptySave();
  save.settings = sanitizeSettings(o.settings);
  const games = o.games;
  if (games && typeof games === 'object' && !hasProtoKey(games)) {
    const w = (games as Record<string, unknown>)['water-sort'];
    if (w && typeof w === 'object') {
      const wo = w as Record<string, unknown>;
      const maxLevel = typeof wo.maxLevel === 'number' && Number.isFinite(wo.maxLevel) ? Math.max(1, Math.floor(wo.maxLevel)) : 1;
      const completed = Array.isArray(wo.completed)
        ? [...new Set(wo.completed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1))].sort((a, b) => a - b)
        : [];
      save.games['water-sort'] = {
        maxLevel,
        completed,
        active: null,
        tutorialBasic: wo.tutorialBasic === true,
        tutorialMystery: wo.tutorialMystery === true,
      };
      if (wo.active && typeof wo.active === 'object') {
        const a = wo.active as Record<string, unknown>;
        if (
          typeof a.levelNumber === 'number' && Array.isArray(a.tubes) && Array.isArray(a.known) &&
          Array.isArray(a.history) && typeof a.seed === 'number' && Array.isArray(a.colors) && Array.isArray(a.hidden)
        ) {
          (save.games['water-sort'] as WaterSortSave).active = a as unknown as WaterSortSessionSave;
        }
      }
    }
    const p = (games as Record<string, unknown>)['plumber'];
    if (p && typeof p === 'object') {
      const po = p as Record<string, unknown>;
      const stars = validStars(po.stars);
      const fams = validFams(po.fams);
      const legacyActive = parsePlumberActive(po.active);
      const parsedModes = parseModes(po.modes);
      let modes: Record<PlumberMode, PlumberModeProgress>;
      let starsOut = stars;
      let famsOut = fams;
      const explicitSelected: PlumberMode | null = po.selected === 'child' || po.selected === 'expert' || po.selected === 'normal' ? po.selected : null;
      let selected: PlumberMode = explicitSelected ?? 'child';
      if (parsedModes) {
        modes = parsedModes;
        // Missing/legacy selection: resume the mode with the most progress.
        if (!explicitSelected) selected = PLUMBER_MODES.reduce((best, m) => (parsedModes[m].maxLevel > parsedModes[best].maxLevel ? m : best), 'child' as PlumberMode);
      } else {
        // v1 -> v2 migration: distribute the single progression into modes,
        // renumbering levels 1-based per mode (no progress loss).
        const legacyCompleted = validCompleted(po.completed);
        const derived = deriveModesFromLegacy(legacyCompleted, stars, fams, legacyActive);
        modes = derived.modes;
        starsOut = derived.stars;
        famsOut = derived.fams;
        selected = derived.selected;
      }
      const slot: PlumberSave = {
        maxLevel: 1,
        completed: [],
        active: null,
        tutorialSeen: po.tutorialSeen === true,
        tutorial: Array.isArray(po.tutorial) ? po.tutorial.filter((c): c is string => typeof c === 'string') : [],
        stars: starsOut,
        collections: Array.isArray(po.collections) ? po.collections.filter((c): c is string => typeof c === 'string') : [],
        stats: validStats(po.stats),
        dailies: validDailies(po.dailies),
        weeklies: validDailies(po.weeklies),
        fams: famsOut,
        modes,
        selected,
      };
      syncPlumberMirror(slot);
      save.games['plumber'] = slot;
    }
  }
  const lp = o.lastPlayed as Record<string, unknown> | null;
  if (lp && typeof lp.gameId === 'string' && typeof lp.levelNumber === 'number') {
    save.lastPlayed = { gameId: lp.gameId, levelNumber: Math.max(1, Math.floor(lp.levelNumber)) };
  }
  if (typeof o.updatedAt === 'number') save.updatedAt = o.updatedAt;
  const conflicts = o.conflicts;
  if (conflicts && typeof conflicts === 'object' && !hasProtoKey(conflicts)) {
    const out: Record<string, { local: unknown; remote: unknown; at: number }> = {};
    for (const [gid, c] of Object.entries(conflicts as Record<string, unknown>)) {
      if (!/^[a-z0-9-]{1,32}$/.test(gid) || !c || typeof c !== 'object') continue;
      const co = c as Record<string, unknown>;
      out[gid] = { local: co.local ?? null, remote: co.remote ?? null, at: typeof co.at === 'number' ? co.at : 0 };
    }
    if (Object.keys(out).length) save.conflicts = out;
  }
  return save;
}

export async function loadSave(): Promise<SaveData> {
  try {
    const raw = await kvGet(SAVE_KEY);
    if (!raw) return emptySave();
    const parsed: unknown = JSON.parse(raw);
    return sanitizeSave(parsed) ?? emptySave();
  } catch {
    return emptySave();
  }
}

export async function storeSave(save: SaveData): Promise<void> {
  save.updatedAt = Date.now();
  await kvSet(SAVE_KEY, JSON.stringify(save));
}

export function checksumStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function buildExport(save: SaveData): string {
  const body = JSON.stringify({
    formatVersion: EXPORT_FORMAT,
    savedAt: new Date().toISOString(),
    data: save,
  });
  return JSON.stringify({ payload: JSON.parse(body), checksum: checksumStr(body) });
}

export function parseExport(text: string): SaveData | null {
  try {
    const outer: unknown = JSON.parse(text);
    if (!outer || typeof outer !== 'object' || hasProtoKey(outer)) return null;
    const o = outer as { payload?: unknown; checksum?: unknown };
    if (!o.payload || typeof o.checksum !== 'string') return null;
    const body = JSON.stringify(o.payload);
    if (checksumStr(body) !== o.checksum) return null;
    const p = o.payload as { formatVersion?: unknown; data?: unknown };
    if (p.formatVersion !== EXPORT_FORMAT) return null;
    return sanitizeSave(p.data);
  } catch {
    return null;
  }
}

export type MergeChoice = 'replace' | 'merge' | 'cancel';

/** Plumber extras: stars take max, collections union, stats add, dailies max. */
function mergePlumberProgress(merged: Record<string, unknown>, incR: Record<string, unknown>): void {
  const stars: Record<string, number> = { ...((merged.stars as Record<string, number>) ?? {}) };
  for (const [k, v] of Object.entries((incR.stars as Record<string, unknown>) ?? {})) {
    if (typeof v === 'number') stars[k] = Math.max(stars[k] ?? 0, v);
  }
  merged.stars = stars;
  merged.collections = [...new Set([...((merged.collections as string[]) ?? []), ...((incR.collections as string[]) ?? [])])];
  merged.tutorial = [...new Set([...((merged.tutorial as string[]) ?? []), ...((incR.tutorial as string[]) ?? [])])];
  merged.tutorialSeen = (merged.tutorialSeen as boolean) || (incR.tutorialSeen as boolean) || false;
  const stats = merged.stats as Record<string, Record<string, number>> | undefined;
  const incStats = incR.stats as Record<string, Record<string, number>> | undefined;
  if (stats && incStats) {
    for (const m of Object.keys(stats)) {
      if (!incStats[m]) continue;
      for (const k of ['attempts', 'wins', 'hints', 'skips']) {
        stats[m][k] = (stats[m][k] ?? 0) + (incStats[m][k] ?? 0);
      }
    }
  }
  const dailies: Record<string, number> = { ...((merged.dailies as Record<string, number>) ?? {}) };
  for (const [k, v] of Object.entries((incR.dailies as Record<string, unknown>) ?? {})) {
    if (typeof v === 'number') dailies[k] = Math.max(dailies[k] ?? 0, v);
  }
  merged.dailies = dailies;
  const fams: Record<string, { family: string; mode: string }> = { ...((merged.fams as Record<string, { family: string; mode: string }>) ?? {}) };
  for (const [k, v] of Object.entries((incR.fams as Record<string, unknown>) ?? {})) {
    if (!(k in fams) && v && typeof v === 'object') {
      const eo = v as Record<string, unknown>;
      if (typeof eo.family === 'string' && typeof eo.mode === 'string') fams[k] = { family: eo.family, mode: eo.mode };
    }
  }
  merged.fams = fams;
  const curModes = (merged.modes as Record<PlumberMode, PlumberModeProgress> | undefined) ?? emptyPlumber().modes;
  const incModes = incR.modes as Record<PlumberMode, PlumberModeProgress> | undefined;
  if (incModes) {
    const outModes = { child: emptyModeProgress(), normal: emptyModeProgress(), expert: emptyModeProgress() };
    for (const m of PLUMBER_MODES) {
      const a = curModes[m] ?? emptyModeProgress();
      const b = incModes[m] ?? emptyModeProgress();
      outModes[m] = {
        maxLevel: Math.max(Number(a.maxLevel) || 1, Number(b.maxLevel) || 1),
        completed: [...new Set([...a.completed, ...b.completed])].sort((x, y) => x - y),
        // Conflicting actives are never mixed component-wise: keep current.
        active: a.active,
      };
    }
    merged.modes = outModes;
  }
  syncPlumberMirror(merged as unknown as PlumberSave);
}

export function mergeSaves(current: SaveData, incoming: SaveData): SaveData {
  const out: SaveData = JSON.parse(JSON.stringify(current)) as SaveData;
  for (const [gameId, inc] of Object.entries(incoming.games)) {
    const cur = (out.games[gameId] ?? (gameId === 'plumber' ? emptyPlumber() : emptyWaterSort())) as GameSave & Record<string, unknown>;
    const incR = inc as GameSave & Record<string, unknown>;
    const completed = [...new Set([...(cur.completed as number[]), ...(incR.completed as number[])])].sort((a, b) => a - b);
    const merged: Record<string, unknown> = {
      ...(cur as object),
      maxLevel: Math.max(cur.maxLevel as number, incR.maxLevel as number),
      completed,
      // Conflicting active sessions are never mixed component-wise: keep current.
      active: cur.active,
    };
    // OR-merge any boolean tutorial flags present on either side (per-game keys).
    for (const k of new Set([...Object.keys(cur), ...Object.keys(incR)])) {
      if (k.startsWith('tutorial') && (typeof cur[k] === 'boolean' || typeof incR[k] === 'boolean')) {
        merged[k] = Boolean(cur[k]) || Boolean(incR[k]);
      }
    }
    if (gameId === 'plumber') mergePlumberProgress(merged, incR);
    out.games[gameId] = merged as unknown as GameSave;
  }
  if (!out.lastPlayed && incoming.lastPlayed) out.lastPlayed = incoming.lastPlayed;
  return out;
}

const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
};

/**
 * Monotonic merge of a server snapshot into the local save for one game.
 * Wins -> union of completed levels; stars -> per-key max; collections/fams ->
 * union; dailies -> per-day max; stats -> per-mode max (counters only ever grow,
 * and the server counts each event uuid once, so max cannot double-count).
 * It NEVER touches the local active session: conflicting actives are preserved
 * separately and surfaced to the user.
 */
export function mergeServerSnapshot(save: SaveData, gameId: string, serverData: Record<string, unknown>): void {
  const g = (save.games[gameId] ?? (gameId === 'plumber' ? emptyPlumber() : emptyWaterSort())) as GameSave & Record<string, unknown>;
  const completed = new Set<number>([
    ...(((g.completed as number[]) ?? []).filter((n) => typeof n === 'number')),
    ...((Array.isArray(serverData.completed) ? (serverData.completed as unknown[]) : []).filter((n): n is number => typeof n === 'number')),
  ]);
  g.completed = [...completed].sort((a, b) => a - b);
  if (typeof serverData.maxLevel === 'number') {
    g.maxLevel = Math.max(Number(g.maxLevel) || 1, Math.floor(serverData.maxLevel));
  }
  if (serverData.stars && typeof serverData.stars === 'object') {
    const local = (g.stars as Record<string, number>) ?? {};
    for (const [k, v] of Object.entries(numMap(serverData.stars))) local[k] = Math.max(local[k] ?? 0, v);
    g.stars = local;
  }
  if (Array.isArray(serverData.collections)) {
    g.collections = [...new Set([...((g.collections as string[]) ?? []), ...(serverData.collections as unknown[]).filter((x): x is string => typeof x === 'string')])];
  }
  if (serverData.fams && typeof serverData.fams === 'object') {
    const local = (g.fams as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries(serverData.fams as Record<string, unknown>)) {
      if (!(k in local) && v && typeof v === 'object') local[k] = v;
    }
    g.fams = local;
  }
  if (serverData.dailies && typeof serverData.dailies === 'object') {
    const local = (g.dailies as Record<string, number>) ?? {};
    for (const [k, v] of Object.entries(numMap(serverData.dailies))) local[k] = Math.max(local[k] ?? 0, v);
    g.dailies = local;
  }
  const srvStats = serverData.stats;
  if (srvStats && typeof srvStats === 'object') {
    const local = ((g.stats as Record<string, PlumberModeStats>) ?? {}) as Record<string, PlumberModeStats>;
    for (const m of ['child', 'normal', 'expert'] as const) {
      const sn = (srvStats as Record<string, unknown>)[m];
      if (!sn || typeof sn !== 'object') continue;
      const cur = local[m] ?? { attempts: 0, wins: 0, hints: 0, skips: 0 };
      for (const k of ['attempts', 'wins', 'hints', 'skips'] as const) {
        const sv = (sn as Record<string, unknown>)[k];
        if (typeof sv === 'number') cur[k] = Math.max(cur[k] ?? 0, Math.floor(sv));
      }
      local[m] = cur;
    }
    g.stats = local as PlumberSave['stats'];
  }
  if (gameId === 'plumber' && serverData.modes && typeof serverData.modes === 'object') {
    const plumber = g as PlumberSave;
    plumber.modes = plumber.modes ?? { child: emptyModeProgress(), normal: emptyModeProgress(), expert: emptyModeProgress() };
    for (const m of PLUMBER_MODES) {
      const srv = (serverData.modes as Record<string, unknown>)[m];
      if (!srv || typeof srv !== 'object') continue;
      const so = srv as Record<string, unknown>;
      const local = plumber.modes[m] ?? emptyModeProgress();
      const completed = new Set<number>([...local.completed, ...validCompleted(so.completed)]);
      local.completed = [...completed].sort((a, b) => a - b);
      if (typeof so.maxLevel === 'number' && Number.isFinite(so.maxLevel)) {
        local.maxLevel = Math.max(Number(local.maxLevel) || 1, Math.floor(so.maxLevel));
      }
      plumber.modes[m] = local;
    }
    syncPlumberMirror(plumber);
  }
  save.games[gameId] = g as GameSave;
}

/** Record both snapshots of an unresolved active-session conflict. */
export function recordConflict(save: SaveData, gameId: string, local: unknown, remote: unknown): void {
  save.conflicts = save.conflicts ?? {};
  save.conflicts[gameId] = { local, remote, at: Date.now() };
}

export async function backupCurrent(): Promise<void> {  const raw = await kvGet(SAVE_KEY);
  if (raw !== null) await kvSet(BACKUP_KEY, raw);
}

export async function clearSave(): Promise<void> {
  await kvDel(SAVE_KEY);
}
