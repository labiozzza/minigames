// Pure onboarding logic for plumber (§8). Given a level definition and the live
// runtime state it returns the next guided action for a child who cannot read:
// the real cell to touch and an icon for the action. No Phaser/DOM here.
//
// The guide follows the level's certified witness, so it always points at a
// genuine, executable action for the mechanic that just unlocked — never a
// scripted text card and never an action the level does not actually need.
import { kindAt, type LevelDefinition, type PipeKind, type RuntimeState } from '../domain/model';

export type Mechanic =
  | 'rotate'
  | 'leakfix'
  | 'valve'
  | 'filter'
  | 'carry'
  | 'multiflow'
  | 'mixer'
  | 'program'
  | 'exact';

export type GuideAction = 'rotate' | 'valve' | 'pickup' | 'place' | 'placeStock' | 'program' | 'start';

export interface GuideStep {
  action: GuideAction;
  /** Real cell to highlight (world grid index); absent for non-cell steps. */
  cell?: number;
  /** Non-textual affordance shown on the cell / button. */
  icon: string;
  mechanic: Mechanic;
}

const ACTION_ICON: Record<GuideAction, string> = {
  rotate: '🔄',
  valve: '🔧',
  pickup: '✋',
  place: '📥',
  placeStock: '🧱',
  program: '🧩',
  start: '▶️',
};

/** Mechanics a level actually introduces, in teaching order. */
export function mechanicsOf(def: LevelDefinition): Mechanic[] {
  const kinds = new Set(def.cells.map((c) => c.kind as string));
  const out: Mechanic[] = ['rotate'];
  if (def.family === 'leakfix' || def.dynamic) out.push('leakfix');
  if (kinds.has('valve') || def.family === 'valve') out.push('valve');
  if (kinds.has('filter') || def.family === 'filter') out.push('filter');
  if (def.family === 'carry' || (def.inventory?.length ?? 0) > 0) out.push('carry');
  if (def.family === 'multiflow' || def.sources.length > 1) out.push('multiflow');
  if (kinds.has('mixer') || def.family === 'mixer') out.push('mixer');
  if (def.programmed || def.family === 'program') out.push('program');
  if (def.family === 'exact') out.push('exact');
  return out;
}

/** First mechanic present in the level that the player has not mastered yet. */
export function pendingMechanic(def: LevelDefinition, mastered: string[]): Mechanic | null {
  for (const m of mechanicsOf(def)) if (!mastered.includes(m)) return m;
  return null;
}

function finalRots(def: LevelDefinition): Map<number, number> {
  const counts = new Map<number, number>();
  for (const c of def.solutionWitness) {
    if (c.type === 'rotate') counts.set(c.index, (counts.get(c.index) ?? 0) + 1);
  }
  const out = new Map<number, number>();
  for (const [i, n] of counts) out.set(i, ((def.cells[i]?.rot ?? 0) + n) % 4);
  return out;
}

function finalValves(def: LevelDefinition): Map<number, boolean> {
  const out = new Map<number, boolean>();
  for (const c of def.solutionWitness) {
    if (c.type === 'toggleValve') {
      const init = def.cells[c.index]?.valveOpen !== false;
      out.set(c.index, !init);
    }
  }
  return out;
}

/**
 * Next guided step for `pending` (or any witness step when pending is null).
 * Returns null when the board already matches the whole witness.
 */
export function nextGuide(def: LevelDefinition, state: RuntimeState, pending: Mechanic | null = null): GuideStep | null {
  const mech = pending ?? 'rotate';
  const rots = finalRots(def);
  const valves = finalValves(def);

  for (const c of def.solutionWitness) {
    switch (c.type) {
      case 'rotate': {
        const want = rots.get(c.index);
        if (want !== undefined && (state.rots[c.index] ?? 0) !== want) {
          return { action: 'rotate', cell: c.index, icon: ACTION_ICON.rotate, mechanic: 'rotate' };
        }
        break;
      }
      case 'toggleValve': {
        const want = valves.get(c.index);
        if (want !== undefined && (state.valves[c.index] ?? true) !== want) {
          return { action: 'valve', cell: c.index, icon: ACTION_ICON.valve, mechanic: 'valve' };
        }
        break;
      }
      case 'pickup': {
        if (kindAt(state, c.index) !== 'empty') {
          return { action: 'pickup', cell: c.index, icon: ACTION_ICON.pickup, mechanic: 'carry' };
        }
        break;
      }
      case 'place': {
        if (state.carried && kindAt(state, c.index) === 'empty') {
          return { action: 'place', cell: c.index, icon: ACTION_ICON.place, mechanic: 'carry' };
        }
        break;
      }
      case 'placeStock': {
        const kind = c.kind as PipeKind;
        if ((state.inventoryLeft ?? []).includes(kind) && kindAt(state, c.index) === 'empty') {
          return { action: 'placeStock', cell: c.index, icon: ACTION_ICON.placeStock, mechanic: 'carry' };
        }
        break;
      }
      case 'appendProgram':
        if (state.program.length < (def.program?.length ?? 1)) {
          return { action: 'program', icon: ACTION_ICON.program, mechanic: 'program' };
        }
        break;
      default:
        break;
    }
  }
  // Board matches the witness: the only remaining real action is "start".
  return { action: 'start', icon: ACTION_ICON.start, mechanic: mech };
}

/** True once the board satisfies every setup command of the witness. */
export function setupComplete(def: LevelDefinition, state: RuntimeState): boolean {
  const step = nextGuide(def, state);
  return step === null || step.action === 'start';
}
