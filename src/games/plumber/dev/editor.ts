// §16 developer level editor. Pure, headless operations over a LevelDefinition
// so they can be unit-tested and driven by the dev panel. Saving a draft is
// forbidden unless the level is publicly valid: it must generate, certify
// (replay to WON, volume conserved, no trivial win) and be provably solvable.
import type { CellDef, LevelDefinition, PipeKind, ReceiverDef, Side, SourceDef } from '../domain/model';
import { certifyReport } from '../domain/generator';
import type { Diagnosis } from '../domain/solver';

export interface DraftCheck {
  ok: boolean;
  phase: string;
  volumeOk: boolean;
  trivialWin: boolean;
  solvable: boolean;
  reasons: string[];
}

/** Rotate is a no-op toggle for a single cell (dev convenience). */
export function rotateCell(def: LevelDefinition, index: number): LevelDefinition {
  const cells = def.cells.map((c, i) => (i === index ? { ...c, rot: (((c.rot ?? 0) + 1) % 4) as CellDef['rot'] } : { ...c }));
  return { ...def, cells };
}

export function placeObject(def: LevelDefinition, index: number, kind: PipeKind): LevelDefinition {
  const cells = def.cells.map((c, i) => (i === index ? { ...c, kind, rot: 0, locked: false } : { ...c }));
  return { ...def, cells };
}

export function removeObject(def: LevelDefinition, index: number): LevelDefinition {
  const cells = def.cells.map((c, i) => (i === index ? { ...c, kind: 'empty' as PipeKind } : { ...c }));
  return { ...def, cells };
}

export function setSource(def: LevelDefinition, sourceIndex: number, patch: Partial<SourceDef>): LevelDefinition {
  const sources = def.sources.map((s, i) => (i === sourceIndex ? { ...s, ...patch } : { ...s }));
  return { ...def, sources };
}

export function setReceiver(def: LevelDefinition, receiverIndex: number, patch: Partial<ReceiverDef>): LevelDefinition {
  const receivers = def.receivers.map((r, i) => (i === receiverIndex ? { ...r, ...patch } : { ...r }));
  return { ...def, receivers };
}

export function setInventory(def: LevelDefinition, inventory: PipeKind[]): LevelDefinition {
  return { ...def, inventory: [...inventory] };
}

/** Validate a hand-made draft; `diagnose` comes from the solver (injected). */
export function checkDraft(def: LevelDefinition, diagnose: (d: LevelDefinition) => Diagnosis): DraftCheck {
  const rep = certifyReport(def);
  const diag = diagnose(def);
  const solvable = diag.solvable || diag.status === 'SOLVABLE_WITH_WITNESS';
  const reasons: string[] = [];
  if (rep.phase !== 'WON') reasons.push(`no-win:${rep.phase}`);
  if (!rep.volumeOk) reasons.push('volume-not-conserved');
  if (rep.trivialWin) reasons.push('trivial-win');
  if (!solvable) reasons.push(`not-solvable:${diag.status}`);
  return { ok: reasons.length === 0, phase: rep.phase, volumeOk: rep.volumeOk, trivialWin: rep.trivialWin, solvable, reasons };
}

/** Save gate: a publicly invalid draft must never be persisted. */
export function canSaveDraft(def: LevelDefinition, diagnose: (d: LevelDefinition) => Diagnosis): { ok: boolean; check: DraftCheck } {
  const check = checkDraft(def, diagnose);
  return { ok: check.ok, check };
}

export type { Side };
