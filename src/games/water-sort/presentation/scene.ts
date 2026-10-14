// Phaser 4 view layer. Renders computed state only; all rules live in domain/.
import * as Phaser from 'phaser';
import { TUBE_CAPACITY } from '../domain/model';
import { paletteColor, paletteSymbol } from '../config/palette';

export interface ViewLayer {
  id: string;
  color: string;
  hidden: boolean;
}

export interface SceneView {
  tubes: () => ViewLayer[][];
  theme: () => 'light' | 'dark';
  symbols: () => boolean;
  onTap: (index: number) => void;
}

import { computeLayout, type TubeLayout } from './layout';

interface TubeObjs {
  glass: Phaser.GameObjects.Graphics;
  liquid: Phaser.GameObjects.Graphics;
  fx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  baseX: number;
  baseY: number;
}

const LAYER_GAP = 3;

export class SortScene extends Phaser.Scene {
  private view: SceneView;
  private objs: TubeObjs[] = [];
  private selected: number | null = null;
  private hintPair: { from: number; to: number } | null = null;
  private completed: boolean[] = [];

  constructor(view: SceneView) {
    super('water-sort');
    this.view = view;
  }

  create(): void {
    this.buildTubes();
    this.scale.on('resize', () => this.buildTubes());
    this.render();
  }

  private clearObjs(): void {
    for (const o of this.objs) {
      o.glass.destroy();
      o.liquid.destroy();
      o.fx.destroy();
      o.label.destroy();
      o.zone.destroy();
    }
    this.objs = [];
  }

  private buildTubes(): void {
    this.clearObjs();
    const w = this.scale.width;
    const h = this.scale.height;
    const count = this.view.tubes().length;
    const layout = computeLayout(w, h, count);
    this.completed = new Array(count).fill(false);
    for (let i = 0; i < count; i++) {
      const L = layout[i];
      const glass = this.add.graphics();
      const liquid = this.add.graphics();
      const fx = this.add.graphics();
      const label = this.add
        .text(L.x, L.y + L.tubeH / 2 + 16, '', { fontSize: '13px', color: '#8892aa' })
        .setOrigin(0.5, 0);
      const zone = this.add.zone(L.x, L.y, L.tubeW + 26, L.tubeH + 40).setInteractive({ useHandCursor: true });
      const idx = i;
      zone.on('pointerdown', () => this.view.onTap(idx));
      this.objs.push({ glass, liquid, fx, label, zone, baseX: L.x, baseY: L.y });
    }
    this.render();
  }

  render(): void {
    const tubes = this.view.tubes();
    const theme = this.view.theme();
    const showSymbols = this.view.symbols();
    const glassCol = theme === 'light' ? 0x94a3b8 : 0x64748b;
    const glassFill = theme === 'light' ? 0xffffff : 0x1e293b;
    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i];
      const layers = tubes[i] ?? [];
      const { tubeW: tw, tubeH: th } = this.tubeGeom(i);
      const lift = this.selected === i ? -16 : 0;
      const x = o.baseX;
      const y = o.baseY + lift;
      o.zone.setPosition(x, y);
      o.label.setPosition(x, o.baseY + th / 2 + 16);
      o.label.setText(showSymbols && layers.length > 0 && !layers[layers.length - 1].hidden ? paletteSymbol(layers[layers.length - 1].color) : '');
      o.glass.clear();
      o.glass.fillStyle(glassFill, theme === 'light' ? 0.55 : 0.5);
      o.glass.fillRoundedRect(x - tw / 2, y - th / 2, tw, th, 10);
      o.glass.lineStyle(3, glassCol, 0.9);
      o.glass.strokeRoundedRect(x - tw / 2, y - th / 2, tw, th, 10);
      this.drawLiquid(o.liquid, x, y, tw, th, layers, theme, showSymbols, null);
      o.fx.clear();
      if (this.hintPair && (this.hintPair.from === i || this.hintPair.to === i)) {
        o.fx.lineStyle(4, this.hintPair.from === i ? 0x22d3ee : 0xa3e635, 1);
        o.fx.strokeRoundedRect(x - tw / 2 - 5, y - th / 2 - 5, tw + 10, th + 10, 12);
      }
      if (this.completed[i]) {
        o.fx.lineStyle(3, 0xfacc15, 0.9);
        o.fx.strokeRoundedRect(x - tw / 2 - 2, y - th / 2 - 2, tw + 4, th + 4, 11);
      }
    }
  }

  private tubeGeom(i: number): { tubeW: number; tubeH: number } {
    const w = this.scale.width;
    const h = this.scale.height;
    const L = computeLayout(w, h, this.objs.length)[i] ?? { tubeW: 56, tubeH: 140 } as TubeLayout;
    return { tubeW: L.tubeW, tubeH: L.tubeH };
  }

  private drawLiquid(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    tw: number,
    th: number,
    layers: ViewLayer[],
    theme: 'light' | 'dark',
    showSymbols: boolean,
    partial: { topFrac: number } | null,
  ): void {
    g.clear();
    const innerW = tw - 14;
    const innerH = th - 18;
    const layerH = (innerH - LAYER_GAP * (TUBE_CAPACITY - 1)) / TUBE_CAPACITY;
    const baseY = y + th / 2 - 9;
    layers.forEach((l, idx) => {
      let hh = layerH;
      if (partial && idx === layers.length - 1) hh = layerH * partial.topFrac;
      if (hh <= 0.5) return;
      const yy = baseY - idx * (layerH + LAYER_GAP) - hh;
      if (l.hidden) {
        g.fillStyle(theme === 'light' ? 0x334155 : 0x0f172a, 1);
        g.fillRoundedRect(x - innerW / 2, yy, innerW, hh, 4);
        g.fillStyle(0xffffff, 0.92);
        const fs = Math.min(20, hh * 0.8);
        g.fillCircle(x, yy + hh / 2, fs * 0.28);
        g.fillStyle(theme === 'light' ? 0x334155 : 0x0f172a, 1);
        g.fillCircle(x, yy + hh / 2, fs * 0.2);
      } else {
        g.fillStyle(paletteColor(l.color, theme), 1);
        g.fillRoundedRect(x - innerW / 2, yy, innerW, hh, 4);
        g.fillStyle(0xffffff, 0.22);
        g.fillRoundedRect(x - innerW / 2 + 3, yy + 2, 5, Math.max(1, hh - 4), 2);
        if (showSymbols && idx === layers.length - 1) {
          g.fillStyle(0xffffff, 0.9);
          g.fillCircle(x + innerW / 2 - 10, yy + hh / 2, 6);
        }
      }
    });
  }

  setSelected(i: number | null): void {
    this.selected = i;
    this.render();
  }

  setHint(from: number | null, to: number | null): void {
    this.hintPair = from !== null && to !== null ? { from, to } : null;
    this.render();
  }

  setCompleted(flags: boolean[]): void {
    this.completed = flags.slice();
    this.render();
  }

  shake(i: number): void {
    const o = this.objs[i];
    if (!o) return;
    this.tweens.add({ targets: o.zone, x: '+=7', duration: 45, yoyo: true, repeat: 3 });
  }

  flashReveal(i: number, done: () => void): void {
    const o = this.objs[i];
    if (!o) {
      done();
      return;
    }
    this.tweens.add({
      targets: o.zone,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 130,
      yoyo: true,
      onComplete: () => {
        o.zone.setScale(1, 1);
        done();
      },
    });
  }

  /** Animated pour from pre-move snapshots to the current logical state. */
  animatePour(
    fromIdx: number,
    toIdx: number,
    fromBefore: ViewLayer[],
    toBefore: ViewLayer[],
    count: number,
    durMs: number,
    done: () => void,
  ): void {
    if (durMs <= 40) {
      this.render();
      done();
      return;
    }
    const theme = this.view.theme();
    const showSymbols = this.view.symbols();
    const f = this.objs[fromIdx];
    const t = this.objs[toIdx];
    if (!f || !t) {
      this.render();
      done();
      return;
    }
    const fGeom = this.tubeGeom(fromIdx);
    const tGeom = this.tubeGeom(toIdx);
    const moved = fromBefore.slice(-count);
    const tgtShown = toBefore.concat(moved);
    const state = { p: 0 };
    this.drawLiquid(f.liquid, f.baseX, f.baseY, fGeom.tubeW, fGeom.tubeH, fromBefore, theme, showSymbols, null);
    this.drawLiquid(t.liquid, t.baseX, t.baseY, tGeom.tubeW, tGeom.tubeH, toBefore, theme, showSymbols, null);
    this.tweens.add({
      targets: state,
      p: 1,
      duration: durMs,
      onUpdate: () => {
        const p = state.p;
        const liftPhase = Math.min(1, p * 3);
        const movePhase = Math.min(1, Math.max(0, p * 1.6 - 0.3));
        const pourPhase = Math.min(1, Math.max(0, p * 2 - 0.6));
        const fx = f.baseX + (t.baseX - f.baseX) * movePhase;
        const fy = f.baseY - 26 * liftPhase + (t.baseY - 54 - (f.baseY - 26)) * movePhase;
        f.zone.setPosition(fx, fy);
        f.glass.clear();
        const gcol = theme === 'light' ? 0x94a3b8 : 0x64748b;
        f.glass.fillStyle(theme === 'light' ? 0xffffff : 0x1e293b, 0.55);
        f.glass.fillRoundedRect(fx - fGeom.tubeW / 2, fy - fGeom.tubeH / 2, fGeom.tubeW, fGeom.tubeH, 10);
        f.glass.lineStyle(3, gcol, 0.9);
        f.glass.strokeRoundedRect(fx - fGeom.tubeW / 2, fy - fGeom.tubeH / 2, fGeom.tubeW, fGeom.tubeH, 10);
        // Source drains, target fills.
        this.drawLiquid(f.liquid, fx, fy, fGeom.tubeW, fGeom.tubeH, fromBefore, theme, showSymbols, {
          topFrac: 1 - pourPhase,
        });
        this.drawLiquid(t.liquid, t.baseX, t.baseY, tGeom.tubeW, tGeom.tubeH, tgtShown, theme, showSymbols, {
          topFrac: pourPhase,
        });
        f.fx.clear();
        if (pourPhase > 0 && pourPhase < 1 && moved.length > 0) {
          const top = moved[moved.length - 1];
          const sx = fx + fGeom.tubeW / 2 - 4;
          const sy = fy - fGeom.tubeH / 2 + 6;
          f.fx.lineStyle(5, top.hidden ? 0x334155 : paletteColor(top.color, theme), 1);
          f.fx.lineBetween(sx, sy, t.baseX, t.baseY - tGeom.tubeH / 2 + 4);
        }
      },
      onComplete: () => {
        f.zone.setPosition(f.baseX, f.baseY);
        this.render();
        done();
      },
    });
  }

  celebrate(done: () => void): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const g = this.add.graphics().setDepth(10);
    const cols = [0x38bdf8, 0xa78bfa, 0x34d399, 0xfbbf24, 0xfb7185];
    const parts = cols.map((c, i) => ({ x: w / 2, y: h * 0.3, vx: (i - 2) * 60, vy: -160 - i * 20, c }));
    let t = 0;
    const timer = this.time.addEvent({
      delay: 40,
      repeat: 30,
      callback: () => {
        t++;
        g.clear();
        for (const p of parts) {
          p.x += p.vx * 0.04;
          p.y += p.vy * 0.04;
          p.vy += 14;
          g.fillStyle(p.c, Math.max(0, 1 - t / 32));
          g.fillCircle(p.x, p.y, 4);
        }
        if (t >= 30) {
          g.destroy();
          timer.destroy();
          done();
        }
      },
    });
  }
}
