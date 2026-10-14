// 12 stable ColorIds, distinguishable on both themes. Symbols are constant per color.
export interface PaletteEntry {
  id: string;
  light: number;
  dark: number;
  symbol: string;
}

export const PALETTE: PaletteEntry[] = [
  { id: 'c0', light: 0xe11d48, dark: 0xfb7185, symbol: '●' },
  { id: 'c1', light: 0xea580c, dark: 0xfb923c, symbol: '▲' },
  { id: 'c2', light: 0xca8a04, dark: 0xfacc15, symbol: '■' },
  { id: 'c3', light: 0x16a34a, dark: 0x4ade80, symbol: '◆' },
  { id: 'c4', light: 0x0d9488, dark: 0x2dd4bf, symbol: '⬟' },
  { id: 'c5', light: 0x0284c7, dark: 0x38bdf8, symbol: '⬢' },
  { id: 'c6', light: 0x4f46e5, dark: 0x818cf8, symbol: '★' },
  { id: 'c7', light: 0x9333ea, dark: 0xc084fc, symbol: '✚' },
  { id: 'c8', light: 0xc026d3, dark: 0xe879f9, symbol: '✖' },
  { id: 'c9', light: 0xbe123c, dark: 0xfda4af, symbol: '◐' },
  { id: 'c10', light: 0x57534e, dark: 0xa8a29e, symbol: '◑' },
  { id: 'c11', light: 0x0f766e, dark: 0x5eead4, symbol: '▣' },
];

export function paletteColor(id: string, theme: 'light' | 'dark'): number {
  const e = PALETTE.find((p) => p.id === id);
  if (!e) return theme === 'light' ? 0x888888 : 0xaaaaaa;
  return theme === 'light' ? e.light : e.dark;
}

export function paletteSymbol(id: string): string {
  return PALETTE.find((p) => p.id === id)?.symbol ?? '?';
}
