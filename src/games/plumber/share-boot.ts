// Validate + stage a shared plumber LevelDefinition from a deep link.
// Separated to keep main.ts small; pure validation, no DOM.
import { PlumberGame } from './game';
import type { LevelDefinition } from './domain/model';

const KINDS = ['empty', 'blocked', 'straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor', 'source', 'receiver'];

/** Returns true when a valid definition was staged for the next mount. */
export function setPendingSharedPlumber(json: string): boolean {
  try {
    if (json.length > 65536) return false;
    const d = JSON.parse(json) as Record<string, unknown>;
    if (typeof d !== 'object' || !d) return false;
    if (typeof d.gridW !== 'number' || typeof d.gridH !== 'number') return false;
    const w = Math.floor(d.gridW as number);
    const h = Math.floor(d.gridH as number);
    if (!(w >= 2 && w <= 8 && h >= 1 && h <= 8)) return false;
    if (!Array.isArray(d.cells) || (d.cells as unknown[]).length !== w * h) return false;
    for (const c of d.cells as Record<string, unknown>[]) {
      if (!KINDS.includes(c.kind as string) || typeof c.rot !== 'number') return false;
    }
    if (!Array.isArray(d.sources) || !Array.isArray(d.receivers)) return false;
    if ((d.sources as unknown[]).length < 1 || (d.receivers as unknown[]).length < 1) return false;
    if ((d.sources as unknown[]).length > 4 || (d.receivers as unknown[]).length > 4) return false;
    const def = d as unknown as LevelDefinition;
    if (def.schemaVersion !== 1) return false;
    PlumberGame.pendingShared = def;
    return true;
  } catch {
    return false;
  }
}
