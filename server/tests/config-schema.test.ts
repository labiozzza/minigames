// §14 strict admin config schema: unknown keys and bad values are rejected,
// valid configs normalise deterministically, checksums are stable.
import { describe, expect, it } from 'vitest';
import { changedFields, checksumConfig, defaultConfig, validateConfig } from '../src/config-schema';

describe('config schema', () => {
  it('accepts and normalises a valid draft', () => {
    const v = validateConfig('plumber', { generator: { families: ['path', 'valve'], seedSalt: 5 }, mechanics: { valve: false } });
    expect(v.ok).toBe(true);
    expect(v.config?.generator.families).toEqual(['path', 'valve']);
    expect(v.config?.mechanics.valve).toBe(false);
    expect(v.config?.mechanics.path).toBe(true); // untouched fields default on
    expect(v.config?.challenges.daily).toBeGreaterThanOrEqual(7);
  });

  it('rejects unknown fields, wrong types and out-of-range values', () => {
    for (const draft of [
      { bogus: 1 },
      { generator: { familes: ['path'] } },
      { generator: { families: [] } },
      { generator: { families: ['nope'] } },
      { generator: { seedSalt: -3 } },
      { generator: { difficulty: { normal: 2 } } },
      { mechanics: { path: 'yes' } },
      { collections: { enabled: ['not-a-collectible'] } },
      { challenges: { daily: 3 } },
      { challenges: { modes: ['impossible'] } },
      { modules: { enabled: [] } },
    ]) {
      const v = validateConfig('plumber', draft);
      expect(v.ok, JSON.stringify(draft)).toBe(false);
      expect(v.errors.length).toBeGreaterThan(0);
    }
  });

  it('checksum is stable and independent of key order', () => {
    const a = defaultConfig('plumber');
    const b = { mechanics: { ...a.mechanics }, generator: { ...a.generator }, game: a.game, modules: a.modules, collections: a.collections, challenges: a.challenges };
    expect(checksumConfig(a)).toBe(checksumConfig(b));
    expect(checksumConfig(a).startsWith('fnv1a-')).toBe(true);
  });

  it('reports the fields that changed between configs', () => {
    const a = defaultConfig('plumber');
    const v = validateConfig('plumber', { generator: { seedSalt: 9 }, mechanics: { valve: false } });
    const changed = changedFields(a, v.config!);
    expect(changed).toContain('generator.seedSalt');
    expect(changed).toContain('mechanics.valve');
    expect(changed).not.toContain('generator.families');
  });
});
