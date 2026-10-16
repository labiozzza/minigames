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
  cells: Array<{ kind: string; rot: number; valveOpen?: boolean; locked?: boolean }>;
  sources: Array<{ cell: number; color: string; portions: number }>;
  receivers: Array<{ cell: number; color: string; goal: number }>;
  solutionWitness: Array<{ type: string; index?: number }>;
  puzzleId: string;
  seed: number;
  mode: 'child' | 'normal' | 'expert';
  gridW: number;
  gridH: number;
}

const PLUMBER_KINDS = ['empty', 'blocked', 'straight', 'elbow', 't', 'cross', 'cap', 'valve', 'source', 'receiver'];

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
  water: number[];
  waterColor: Array<string | null>;
  sourceLeft: number[];
  receiverGot: number[];
  lost: number;
  tick: number;
  phase: PlumberPhase;
  def: PlumberDefSave;
  updatedAt: number;
}

export interface PlumberSave {
  maxLevel: number;
  completed: number[];
  active: PlumberSessionSave | null;
  tutorialSeen: boolean;
}

export type GameSave = WaterSortSave | PlumberSave;

export function emptyPlumber(): PlumberSave {
  return { maxLevel: 1, completed: [], active: null, tutorialSeen: false };
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
  if (g && typeof g.maxLevel === 'number' && Array.isArray(g.completed)) return g;
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
      const slot: PlumberSave = { maxLevel, completed, active: null, tutorialSeen: po.tutorialSeen === true };
      if (po.active && typeof po.active === 'object') {
        const a = po.active as Record<string, unknown>;
        const numArr = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
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
          if (a.rots.length === cells && a.water.length === cells && (a.waterColor as unknown[]).length === cells) {
            if (isPlumberDef(a.def, a.gridW as number, a.gridH as number)) {
              slot.active = a as unknown as PlumberSessionSave;
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
