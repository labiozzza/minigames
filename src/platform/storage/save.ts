// Versioned local save model, export/import with integrity checksum.
// The checksum detects accidental corruption; it is NOT an authenticity guarantee.
import { kvDel, kvGet, kvSet } from './idb';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../settings/store';

export const SAVE_KEY = 'save-v1';
export const BACKUP_KEY = 'save-backup-v1';
export const SAVE_SCHEMA = 1;
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

export interface PlumberSave {
  maxLevel: number;
  completed: number[];
  active: PlumberSessionSave | null;
  tutorialSeen: boolean;
  stars: Record<string, number>;
  collections: string[];
  stats: Record<'child' | 'normal' | 'expert', PlumberModeStats>;
  dailies: Record<string, number>;
  /** level -> {family, mode} recorded at win time (collections/stats). */
  fams: Record<string, { family: string; mode: string }>;
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
    fams: {},
  };
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
      const maxLevel = typeof po.maxLevel === 'number' && Number.isFinite(po.maxLevel) ? Math.max(1, Math.floor(po.maxLevel)) : 1;
      const completed = Array.isArray(po.completed)
        ? [...new Set(po.completed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1))].sort((a, b) => a - b)
        : [];
      const slot: PlumberSave = {
        maxLevel,
        completed,
        active: null,
        tutorialSeen: po.tutorialSeen === true,
        stars: validStars(po.stars),
        collections: Array.isArray(po.collections) ? po.collections.filter((c): c is string => typeof c === 'string') : [],
        stats: validStats(po.stats),
        dailies: validDailies(po.dailies),
        fams: validFams(po.fams),
      };
      if (po.active && typeof po.active === 'object') {
        const a = po.active as Record<string, unknown>;
        const numArr = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
        const boolArr = (v: unknown, len: number): v is boolean[] => Array.isArray(v) && v.length === len && v.every((n) => typeof n === 'boolean');
        const phases = ['PREPARING', 'RUNNING', 'PAUSED', 'WON', 'FAILED', 'STOPPED'];
        if (
          typeof a.levelNumber === 'number' && typeof a.puzzleId === 'string' && typeof a.seed === 'number' &&
          (a.mode === 'child' || a.mode === 'normal' || a.mode === 'expert') &&
          typeof a.gridW === 'number' && typeof a.gridH === 'number' &&
          numArr(a.rots) && numArr(a.water) && Array.isArray(a.waterColor) &&
          numArr(a.sourceLeft) && numArr(a.receiverGot) &&
          typeof a.lost === 'number' && typeof a.tick === 'number' && typeof a.phase === 'string' && phases.includes(a.phase)
        ) {
          const cells = a.gridW * a.gridH;
          const srcs = (a.sourceLeft as number[]).length;
          if (a.rots.length === cells && a.water.length === cells && (a.waterColor as unknown[]).length === cells) {
            if (isPlumberDef(a.def, a.gridW as number, a.gridH as number)) {
              const full = a as unknown as PlumberSessionSave;
              // New arrays default safely for pre-upgrade saves (subset compatible).
              if (!boolArr(full.valves, cells)) full.valves = new Array<boolean>(cells).fill(true);
              if (!Array.isArray(full.mixerStock)) full.mixerStock = Array.from({ length: cells }, () => []);
              if (!numArr(full.distCount)) full.distCount = new Array<number>(cells).fill(0);
              if (!boolArr(full.sourceEnabled, srcs)) full.sourceEnabled = new Array<boolean>(srcs).fill(true);
              if (!numArr(full.receivedTotal)) full.receivedTotal = [...full.receiverGot];
              if (typeof full.fedTotal !== 'number') full.fedTotal = 0;
              if (!Array.isArray(full.inventoryLeft)) full.inventoryLeft = [];
              if (!Array.isArray(full.program)) full.program = [];
              if (!Array.isArray(full.cameFrom)) full.cameFrom = [];
              if (typeof full.programCounter !== 'number') full.programCounter = 0;
              if (typeof full.idleTicks !== 'number') full.idleTicks = 0;
              if (typeof full.playerRotations !== 'number') full.playerRotations = 0;
              if (typeof full.hintsUsed !== 'number') full.hintsUsed = 0;
              slot.active = full;
            }
          }
        }
      }
      save.games['plumber'] = slot;
    }
  }
  const lp = o.lastPlayed as Record<string, unknown> | null;
  if (lp && typeof lp.gameId === 'string' && typeof lp.levelNumber === 'number') {
    save.lastPlayed = { gameId: lp.gameId, levelNumber: Math.max(1, Math.floor(lp.levelNumber)) };
  }
  if (typeof o.updatedAt === 'number') save.updatedAt = o.updatedAt;
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

export async function backupCurrent(): Promise<void> {
  const raw = await kvGet(SAVE_KEY);
  if (raw !== null) await kvSet(BACKUP_KEY, raw);
}

export async function clearSave(): Promise<void> {
  await kvDel(SAVE_KEY);
}
