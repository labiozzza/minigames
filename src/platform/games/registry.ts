import type { AudioEngine } from '../../audio/engine';
import type { Lang } from '../i18n';
import type { Settings } from '../settings/store';
import type { SaveData } from '../storage/save';
import type { ProgressSink } from '../sync/engine';

export interface GameContext {
  root: HTMLElement;
  save: SaveData;
  settings: Settings;
  lang: Lang;
  audio: AudioEngine;
  level?: number;
  /** Explicit difficulty mode for games that support it (plumber). */
  mode?: string;
  dev: boolean;
  /** Optional shared-account progress sink. Absent => pure local mode. */
  progress?: ProgressSink;
  persist: () => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onExit: () => void;
  onProgress: () => void;
}

export interface GameHandle {
  pause(): void;
  resume(): void;
  unmount(): Promise<void>;
}

export interface GameModule {
  id: string;
  titleKey: string;
  descKey: string;
  version: string;
  /** §13 independent asset-bundle version; changing it invalidates only this game's cache. */
  assetsVersion?: string;
  /** Files that must be cached for this game to be offline-ready. */
  assetPaths?: string[];
  mount: (ctx: GameContext) => Promise<GameHandle>;
}

const games = new Map<string, GameModule>();

export function registerGame(m: GameModule): void {
  games.set(m.id, m);
}

export function getGame(id: string): GameModule | undefined {
  return games.get(id);
}

export function listGames(): GameModule[] {
  return [...games.values()];
}
