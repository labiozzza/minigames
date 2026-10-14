// Pure responsive layout for the tube field. No Phaser, DOM or CSS here.
export interface TubeLayout {
  cols: number;
  rows: number;
  x: number;
  y: number;
  tubeW: number;
  tubeH: number;
}

export function computeLayout(w: number, h: number, count: number): TubeLayout[] {
  const cols = count <= 4 ? count : count <= 8 ? 4 : count <= 10 ? 5 : count <= 12 ? 6 : 7;
  const rows = Math.ceil(count / cols);
  const padX = Math.max(10, w * 0.04);
  const padTop = Math.max(70, h * 0.1);
  const padBottom = Math.max(20, h * 0.05);
  const cellW = (w - padX * 2) / cols;
  const cellH = (h - padTop - padBottom) / rows;
  const tubeW = Math.max(34, Math.min(64, cellW * 0.52));
  const tubeH = Math.max(96, Math.min(168, cellH * 0.72));
  const out: TubeLayout[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = Math.min(cols, count - r * cols);
    const rowW = inRow * cellW;
    const x0 = (w - rowW) / 2;
    out.push({ cols, rows, x: x0 + c * cellW + cellW / 2, y: padTop + r * cellH + cellH / 2, tubeW, tubeH });
  }
  return out;
}
