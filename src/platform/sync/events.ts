// Sync event envelope. Events are the unit of idempotency: the server dedups
// on (userId, gameId, event.uuid), so resends can never double-count.
import type { Mode } from '../../games/plumber/domain/progression';

export type SyncEventKind = 'win' | 'daily' | 'stats';

export interface StatsDelta {
  attempts?: number;
  wins?: number;
  hints?: number;
  skips?: number;
}

export interface SyncEvent {
  uuid: string;
  gameId: string;
  kind: SyncEventKind;
  t: number;
  rulesetVersion: string;
  generatorVersion: string;
  puzzleId: string;
  level?: number;
  mode?: Mode;
  stars?: number;
  family?: string;
  collections?: string[];
  day?: string;
  delta?: StatsDelta;
}

export function newUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export interface WinInput {
  gameId: string;
  puzzleId: string;
  rulesetVersion: string;
  generatorVersion: string;
  level: number;
  mode: Mode;
  stars: number;
  family?: string;
  collections?: string[];
}

export function winEvent(i: WinInput, t = Date.now()): SyncEvent {
  return {
    uuid: newUuid(),
    gameId: i.gameId,
    kind: 'win',
    t,
    rulesetVersion: i.rulesetVersion,
    generatorVersion: i.generatorVersion,
    puzzleId: i.puzzleId,
    level: i.level,
    mode: i.mode,
    stars: i.stars,
    family: i.family,
    collections: i.collections,
  };
}

export function dailyEvent(i: { gameId: string; puzzleId: string; rulesetVersion: string; generatorVersion: string; day: string; stars: number; mode?: Mode }, t = Date.now()): SyncEvent {
  return {
    uuid: newUuid(),
    gameId: i.gameId,
    kind: 'daily',
    t,
    rulesetVersion: i.rulesetVersion,
    generatorVersion: i.generatorVersion,
    puzzleId: i.puzzleId,
    day: i.day,
    stars: i.stars,
    mode: i.mode,
  };
}

export function statsEvent(i: { gameId: string; puzzleId: string; rulesetVersion: string; generatorVersion: string; mode: Mode; delta: StatsDelta }, t = Date.now()): SyncEvent {
  return {
    uuid: newUuid(),
    gameId: i.gameId,
    kind: 'stats',
    t,
    rulesetVersion: i.rulesetVersion,
    generatorVersion: i.generatorVersion,
    puzzleId: i.puzzleId,
    mode: i.mode,
    delta: i.delta,
  };
}
