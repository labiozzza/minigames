import { describe, expect, it } from 'vitest';
import {
  archiveEntries,
  CHALLENGE_HORIZON_DAYS,
  currentDaily,
  currentWeekly,
  localManifest,
  resolveChallenge,
  weekStartUTC,
} from '../../src/games/plumber/domain/challenges';

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const BEFORE_MIDNIGHT = new Date('2026-03-01T23:59:00.000Z'); // Sunday
const AFTER_MIDNIGHT = new Date('2026-03-02T00:00:01.000Z'); // Monday

describe('plumber challenges (§10)', () => {
  it('caches at least 7 daily and 2 weekly future validated tasks', () => {
    const m = localManifest(BEFORE_MIDNIGHT);
    expect(m.filter((c) => c.kind === 'daily').length).toBeGreaterThanOrEqual(CHALLENGE_HORIZON_DAYS);
    expect(m.filter((c) => c.kind === 'weekly').length).toBeGreaterThanOrEqual(2);
    expect(new Set(m.map((c) => c.id)).size).toBe(m.length);
    for (const c of m) expect(c.version).toBe('challenge/1');
  });

  it('rolls the daily at UTC midnight and the weekly on Monday 00:00 UTC', () => {
    expect(weekStartUTC(BEFORE_MIDNIGHT)).toBe('2026-02-23'); // previous Monday
    expect(weekStartUTC(AFTER_MIDNIGHT)).toBe('2026-03-02');
    expect(currentDaily(BEFORE_MIDNIGHT)!.day).toBe('2026-03-01');
    expect(currentDaily(AFTER_MIDNIGHT)!.day).toBe('2026-03-02');
    expect(currentWeekly(BEFORE_MIDNIGHT)!.day).toBe('2026-02-23');
    expect(currentWeekly(AFTER_MIDNIGHT)!.day).toBe('2026-03-02');
  });

  it('is deterministic and matches the server seed formula; same task on any device', () => {
    const a = resolveChallenge('daily-2026-03-02', 'normal')!;
    const b = resolveChallenge('daily-2026-03-02', 'normal')!;
    expect(a.seed).toBe(b.seed);
    expect(a.seed).toBe(fnv('daily:normal:2026-03-02'));
    expect(a.family).toBe(b.family);
    // Separate tasks per difficulty mode.
    expect(resolveChallenge('daily-2026-03-02', 'expert')!.seed).not.toBe(a.seed);
    // Weekly defaults to the expert track.
    expect(resolveChallenge('weekly-2026-03-02')!.mode).toBe('expert');
  });

  it('rejects malformed ids, bad dates and non-Monday weekly ids', () => {
    expect(resolveChallenge('daily-nope')).toBeNull();
    expect(resolveChallenge('daily-2026-13-99')).toBeNull();
    expect(resolveChallenge('weekly-2026-03-03')).toBeNull(); // Tuesday
    expect(resolveChallenge('daily-2026-02-30')).toBeNull();
  });

  it('archives past days/weeks only, without penalising misses', () => {
    const daily = { '2026-02-28': 3, '2026-03-01': 2, '2026-03-02': 1 };
    const arch = archiveEntries(daily, 'daily', AFTER_MIDNIGHT);
    expect(arch.map((e) => e.day)).toEqual(['2026-03-01', '2026-02-28']);
    const weekly = { '2026-02-23': 3, '2026-03-02': 1 };
    expect(archiveEntries(weekly, 'weekly', AFTER_MIDNIGHT).map((e) => e.day)).toEqual(['2026-02-23']);
  });
});
