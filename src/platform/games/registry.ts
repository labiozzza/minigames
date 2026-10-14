import type { AudioEngine } from '../../audio/engine';
import type { Lang } from '../i18n';
import type { Settings } from '../settings/store';
import type { SaveData } from '../storage/save';

export interface GameContext {
  root: HTMLElement;
  save: SaveData;
  settings: Settings;
  lang: Lang;
  audio: AudioEngine;
  level?: number;
  dev: boolean;
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
