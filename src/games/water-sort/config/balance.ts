// Immutable versioned balance. Changing published level identity requires a new version/namespace.
export const GENERATOR_VERSION = 'ws-gen/1';
export const BALANCE_VERSION = 'ws-bal/1';
export const GAME_ID = 'water-sort';

export const MIN_COLORS = 3;
export const MAX_COLORS = 12;
export const EMPTY_TUBES = 2;
export const MAX_TUBES = 14;
export const HIDDEN_START_LEVEL = 101;
export const HIDDEN_FULL_LEVEL = 300;
export const HIDDEN_MAX_FRACTION = 0.5;

export function colorCountForLevel(level: number): number {
  if (level <= 1) return 3;
  if (level <= 100) return 3 + Math.floor(((level - 1) * 9) / 99);
  // Wave relief after reaching 12 colors: dip to 10..12 periodically.
  const dip = level % 25 === 0 ? 2 : level % 9 === 0 ? 1 : 0;
  return MAX_COLORS - dip;
}

export function tubeCountForLevel(level: number): number {
  return Math.min(MAX_TUBES, colorCountForLevel(level) + EMPTY_TUBES);
}

export function scrambleStepsForLevel(level: number): number {
  const colors = colorCountForLevel(level);
  const wave = Math.floor(10 + 10 * (0.5 + 0.5 * Math.sin(level * 0.35)));
  return 30 + colors * 10 + wave;
}

/** Max hidden-unit fraction grows 0 -> 50% between levels 101 and 300. */
export function hiddenFractionForLevel(level: number): number {
  if (level < HIDDEN_START_LEVEL) return 0;
  if (level >= 1000000) return HIDDEN_MAX_FRACTION;
  const raw = 0.02 + ((level - HIDDEN_START_LEVEL) * (HIDDEN_MAX_FRACTION - 0.02)) / (HIDDEN_FULL_LEVEL - HIDDEN_START_LEVEL);
  const clamped = Math.max(0, Math.min(HIDDEN_MAX_FRACTION, raw));
  const wave = 0.75 + 0.25 * Math.sin(level * 0.22);
  return clamped * wave;
}

export function hiddenCountForLevel(level: number, totalUnits: number, availableSlots: number): number {
  if (level < HIDDEN_START_LEVEL) return 0;
  let count = Math.round(totalUnits * hiddenFractionForLevel(level));
  if (level >= HIDDEN_START_LEVEL && count < 1) count = 1;
  const cap = Math.floor(totalUnits * HIDDEN_MAX_FRACTION);
  return Math.max(0, Math.min(count, cap, availableSlots));
}
