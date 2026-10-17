import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, a11yClasses, mergeSettings, sanitizeSettings } from '../../src/platform/settings/store';

describe('§12 settings: accessibility and quality', () => {
  it('defaults keep every new a11y/quality flag off / on auto', () => {
    const s = sanitizeSettings({});
    expect(s.contrast).toBe(false);
    expect(s.largeUi).toBe(false);
    expect(s.reducedMotion).toBe(false);
    expect(s.flashFree).toBe(false);
    expect(s.noDrag).toBe(false);
    expect(s.quality).toBe('auto');
  });

  it('rejects junk and unknown quality values without throwing', () => {
    const s = sanitizeSettings({ contrast: 'yes', largeUi: 1, quality: 'ultra', speed: 'zoom' });
    expect(s.contrast).toBe(false);
    expect(s.largeUi).toBe(false);
    expect(s.quality).toBe('auto');
    expect(s.speed).toBe('normal');
  });

  it('maps enabled flags to deterministic root classes', () => {
    const on = sanitizeSettings({ contrast: true, largeUi: true, reducedMotion: true, flashFree: true });
    expect(a11yClasses(on)).toEqual(['a11y-contrast', 'a11y-large', 'a11y-reduce-motion', 'a11y-flash-free']);
    expect(a11yClasses(DEFAULT_SETTINGS)).toEqual([]);
  });

  it('syncing keeps locally customised fields and adopts untouched ones', () => {
    const local = sanitizeSettings({ music: false }); // customised
    const remote = sanitizeSettings({ music: true, lang: 'en', contrast: true, quality: 'low' });
    const merged = mergeSettings(local, remote);
    expect(merged.music).toBe(false); // local wins its conflict
    expect(merged.lang).toBe('en'); // untouched → from profile
    expect(merged.contrast).toBe(true);
    expect(merged.quality).toBe('low');
  });
});
