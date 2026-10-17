import { describe, expect, it } from 'vitest';
import { applyCommand, createRuntime, type LevelDefinition, type PlumberCommand } from '../../src/games/plumber/domain/model';
import { generateLevel } from '../../src/games/plumber/domain/generator';
import { mechanicsOf, nextGuide, pendingMechanic, setupComplete } from '../../src/games/plumber/tutorial/logic';

const FAMILIES = ['path', 'leakfix', 'valve', 'filter', 'carry', 'multiflow', 'mixer', 'program', 'exact'] as const;

function levelFor(family: string, mode: 'child' | 'normal' | 'expert' = 'normal', seed = 1): LevelDefinition {
  return generateLevel(`tut-${family}-${mode}`, seed, { mode, family: family as never });
}

function commandForStep(def: LevelDefinition, state: ReturnType<typeof createRuntime>, action: string, cell?: number): PlumberCommand {
  switch (action) {
    case 'rotate': return { type: 'rotate', index: cell! };
    case 'valve': return { type: 'toggleValve', index: cell! };
    case 'pickup': return { type: 'pickup', index: cell! };
    case 'place': return { type: 'place', index: cell! };
    case 'placeStock': return { type: 'placeStock', kind: state.inventoryLeft[0], index: cell! };
    case 'program': {
      const next = def.solutionWitness.find((c) => c.type === 'appendProgram');
      return next ?? { type: 'markHint' };
    }
    default: return { type: 'markHint' };
  }
}

describe('plumber onboarding guide (§8)', () => {
  it('detects the introduced mechanics of a level', () => {
    expect(mechanicsOf(levelFor('path'))).toContain('rotate');
    expect(mechanicsOf(levelFor('valve'))).toContain('valve');
    expect(mechanicsOf(levelFor('mixer'))).toContain('mixer');
    expect(mechanicsOf(levelFor('program'))).toContain('program');
    expect(mechanicsOf(levelFor('carry'))).toContain('carry');
  });

  it('points the child at real actions until the witness is satisfied (all families)', () => {
    for (const family of FAMILIES) {
      const def = levelFor(family);
      const state = createRuntime(def);
      let guard = 0;
      while (!setupComplete(def, state)) {
        const step = nextGuide(def, state, pendingMechanic(def, []));
        expect(step, `${family}: guide returned null before completion`).not.toBe(null);
        if (step!.action === 'start') break;
        // Guided steps always name a real, executable action.
        if (step!.cell !== undefined) expect(step!.cell).toBeGreaterThanOrEqual(0);
        const cmd = commandForStep(def, state, step!.action, step!.cell);
        const ok = applyCommand(state, cmd);
        expect(ok, `${family}: guided ${step!.action}@${step!.cell} was rejected`).toBe(true);
        expect(guard++).toBeLessThan(400);
      }
      // Guided play leads into a solvable, winning start.
      expect(setupComplete(def, state)).toBe(true);
      expect(state.phase).toBe('PREPARING');
    }
  });

  it('returns a start step (never null) once setup matches the witness', () => {
    const def = levelFor('path');
    const state = createRuntime(def);
    for (const c of def.solutionWitness) applyCommand(state, c);
    const step = nextGuide(def, state);
    expect(step?.action).toBe('start');
    expect(setupComplete(def, state)).toBe(true);
  });

  it('pendingMechanic skips already-mastered mechanics', () => {
    const def = levelFor('valve');
    const intro = mechanicsOf(def);
    expect(pendingMechanic(def, [])).toBe(intro[0]);
    expect(pendingMechanic(def, intro)).toBeNull();
  });
});
