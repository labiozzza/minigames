import { describe, expect, it } from 'vitest';
import {
  buildExport,
  emptySave,
  mergeSaves,
  parseExport,
  sanitizeSave,
} from '../../src/platform/storage/save';
import { sanitizeSettings } from '../../src/platform/settings/store';
import { translate } from '../../src/platform/i18n';
import { ru } from '../../src/platform/i18n/ru';
import { en } from '../../src/platform/i18n/en';
import { computeLayout } from '../../src/games/water-sort/presentation/layout';

describe('storage', () => {
  it('export/import roundtrip with checksum', () => {
    const s = emptySave();
    s.games['water-sort']!.maxLevel = 5;
    s.games['water-sort']!.completed = [1, 2, 3];
    const text = buildExport(s);
    const back = parseExport(text);
    expect(back).not.toBe(null);
    expect(back!.games['water-sort']!.maxLevel).toBe(5);
    expect(back!.games['water-sort']!.completed).toEqual([1, 2, 3]);
  });
  it('rejects tampered, proto-polluted and misshapen imports', () => {
    const s = emptySave();
    const text = buildExport(s);
    const tampered = text.replace('maxLevel', 'maxLeveX');
    expect(parseExport(tampered)).toBe(null);
    expect(parseExport('{"a":1}')).toBe(null);
    expect(parseExport('not json')).toBe(null);
    expect(parseExport(JSON.stringify({ payload: { formatVersion: 'minigames-progress/1', data: { schemaVersion: 1, ['__proto__' as string]: { x: 1 } } }, checksum: 'x' }))).toBe(null);
    expect(parseExport(JSON.stringify({ payload: { formatVersion: 'other/1', data: { schemaVersion: 1 } }, checksum: 'x' }))).toBe(null);
  });
  it('merge unions progress and keeps current active session intact', () => {
    const a = emptySave();
    a.games['water-sort'] = { maxLevel: 5, completed: [1, 2], active: { levelNumber: 3 } as never, tutorialBasic: true, tutorialMystery: false };
    const b = emptySave();
    b.games['water-sort'] = { maxLevel: 9, completed: [2, 3, 4], active: { levelNumber: 7 } as never, tutorialBasic: false, tutorialMystery: true };
    const m = mergeSaves(a, b);
    expect(m.games['water-sort']!.completed).toEqual([1, 2, 3, 4]);
    expect(m.games['water-sort']!.maxLevel).toBe(9);
    expect((m.games['water-sort']!.active as unknown as { levelNumber: number }).levelNumber).toBe(3);
    expect(m.games['water-sort']!.tutorialMystery).toBe(true);
  });
  it('sanitize rejects bad schema and clamps values', () => {
    expect(sanitizeSave({ schemaVersion: 999 })).toBe(null);
    expect(sanitizeSave(null)).toBe(null);
    const s = sanitizeSave({ schemaVersion: 1, settings: { theme: 'nope', lang: 'de' }, games: {} });
    expect(s!.settings.theme).toBe('system');
    expect(s!.settings.lang).toBe('ru');
    expect(sanitizeSettings({ musicVolume: 5 }).musicVolume).toBe(1);
  });
});

describe('i18n', () => {
  it('ru/en key parity and fallback', () => {
    const rk = Object.keys(ru).sort();
    const ek = Object.keys(en).sort();
    expect(ek).toEqual(rk);
    expect(translate('ru', 'game.undo')).toBeTruthy();
    expect(translate('en', 'game.undo')).toBeTruthy();
    expect(translate('ru', 'missing.key')).toBe('missing.key');
    expect(translate('ru', 'game.level', { level: 7 })).toContain('7');
  });
});

describe('layout', () => {
  it('fits up to 14 tubes without clipping and keeps touch targets', () => {
    for (const n of [3, 5, 8, 10, 12, 14]) {
      for (const [w, h] of [[320, 568], [390, 844], [768, 1024], [1280, 800]]) {
        const L = computeLayout(w, h, n);
        expect(L.length).toBe(n);
        for (const t of L) {
          expect(t.x - t.tubeW / 2).toBeGreaterThanOrEqual(0);
          expect(t.x + t.tubeW / 2).toBeLessThanOrEqual(w);
          expect(t.y - t.tubeH / 2).toBeGreaterThanOrEqual(0);
          expect(t.y + t.tubeH / 2).toBeLessThanOrEqual(h);
          expect(t.tubeW + 26).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });
});
