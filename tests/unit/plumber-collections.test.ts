import { describe, expect, it } from 'vitest';
import { COLLECTIBLES, THEMES, themeForGoals } from '../../src/games/plumber/domain/progression';
import { projectSvg, themeComposition } from '../../src/games/plumber/presentation/diorama';

describe('plumber collections (§9)', () => {
  it('has 12 unique story objects across 4 themes (3 each), versioned', () => {
    expect(COLLECTIBLES).toHaveLength(12);
    expect(new Set(COLLECTIBLES.map((c) => c.id)).size).toBe(12);
    expect(new Set(COLLECTIBLES.map((c) => c.projectKey)).size).toBe(12);
    expect(THEMES).toHaveLength(4);
    for (const t of THEMES) {
      expect(COLLECTIBLES.filter((c) => c.theme === t.id)).toHaveLength(3);
    }
    for (const c of COLLECTIBLES) expect(c.version).toBeGreaterThanOrEqual(1);
  });

  it('derives the environment theme from the level goals, not at random', () => {
    expect(themeForGoals('blue', 'path')).toBe('garden');
    expect(themeForGoals('red', 'leakfix')).toBe('city');
    expect(themeForGoals('blue', 'mixer')).toBe('industry');
    expect(themeForGoals('yellow', 'carry')).toBe('special');
    // Same inputs always give the same theme.
    expect(themeForGoals('red', 'valve')).toBe(themeForGoals('red', 'valve'));
  });

  it('renders transparent geometric prototypes, never emoji', () => {
    const c = COLLECTIBLES[0];
    const svg = projectSvg(c, { alive: true });
    expect(svg).toContain('data-prototype="1"');
    expect(svg).toContain(`data-shape="${c.shape}"`);
    expect(svg).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u);
    const comp = themeComposition(THEMES[0], COLLECTIBLES.filter((x) => x.theme === 'garden'), [c.id]);
    expect(comp).toContain('data-prototype="1"');
    expect(comp).toContain('composition-svg');
  });
});
