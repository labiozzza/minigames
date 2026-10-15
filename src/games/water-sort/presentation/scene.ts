// Phaser 4 view layer. Renders computed state only; all rules live in domain/.
//
// Animation architecture (no hide/show handoff):
//   - The animated tube is NEVER hidden. Its own container is lifted above the
//     rest (depth 30) and moved/tilted back to its base afterwards.
//   - The stream lives in a dedicated layer (depth 40).
//   - Static tubes stay at depth 0. There is exactly one visible copy of every
//     tube at all times, so an interrupted animation cannot leave a tube hidden.
//   - A generation token aborts stale tweens after a rebuild (resize): the
//     visual state snaps to the current logical state, `done` still fires.
// No per-frame work: redraws happen only during animations.
import * as Phaser from 'phaser';
import { TUBE_CAPACITY } from '../domain/model';
import { paletteColor, paletteSymbol } from '../config/palette';
import { computeLayout, type TubeLayout } from './layout';

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
  /** Viewport rect of the game canvas (set by the host, which owns the DOM). */
  canvasBox: () => { x: number; y: number; width: number; height: number } | null;
  /** Fired once the scene objects exist; fired again after every relayout. */
  onReady: () => void;
  onRelayout: () => void;
}

export type { TubeLayout };

export type PourStage = 'idle' | 'lift' | 'move' | 'tilt' | 'pour' | 'return' | 'settle';

/**
 * Total flight time for a pour of `count` blocks: the base flight plus one
 * extra unit window per additional block, so every block gets visible pour
 * time instead of being teleported.
 */
export function pourAnimTotal(count: number, durMs: number): number {
  const unitMs = Math.max(160, Math.min(420, durMs * 0.5));
  return durMs + 560 + Math.max(0, count - 1) * unitMs;
}

export interface PourAudit {
  /** The source container stayed visible for the whole pour phase. */
  srcVisible: boolean;
  /** The source stayed fully inside the field bounds. */
  srcInBounds: boolean;
  /** A stream with real width was drawn during the pour phase. */
  streamOn: boolean;
}

interface TubeObjs {
  root: Phaser.GameObjects.Container;
  glass: Phaser.GameObjects.Graphics;
  liquid: Phaser.GameObjects.Graphics;
  fx: Phaser.GameObjects.Graphics;
  symbol: Phaser.GameObjects.Text;
  mark: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  baseX: number;
  baseY: number;
}

const LAYER_GAP = 3;
const FRONT_DEPTH = 30;
const STREAM_DEPTH = 40;

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export class SortScene extends Phaser.Scene {
  private view: SceneView;
  private objs: TubeObjs[] = [];
  private selected: number | null = null;
  private hintPair: { from: number; to: number } | null = null;
  private completed: boolean[] = [];
  private streamG: Phaser.GameObjects.Graphics | null = null;
  private animToken = 0;
  stage: PourStage = 'idle';
  lastAudit: PourAudit | null = null;

  constructor(view: SceneView) {
    super('water-sort');
    this.view = view;
  }

  create(): void {
    this.buildTubes();
    this.scale.on('resize', () => {
      this.buildTubes();
      this.view.onRelayout();
    });
    this.render();
    this.view.onReady();
  }

  private clearObjs(): void {
    this.animToken++;
    this.tweens.killAll();
    for (const o of this.objs) o.root.destroy(true);
    this.objs = [];
    this.streamG?.destroy(true);
    this.streamG = null;
    this.stage = 'idle';
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
      const symbol = this.add.text(0, L.tubeH / 2 + 16, '', { fontSize: '13px', color: '#8892aa' }).setOrigin(0.5, 0);
      const mark = this.add
        .text(0, 0, '', { fontSize: '22px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5, 0.5);
      const zone = this.add.zone(0, 0, L.tubeW + 30, L.tubeH + 46).setInteractive({ useHandCursor: true });
      const idx = i;
      zone.on('pointerdown', () => this.view.onTap(idx));
      const root = this.add.container(L.x, L.y, [glass, liquid, fx, symbol, mark, zone]);
      root.setDepth(0);
      this.objs.push({ root, glass, liquid, fx, symbol, mark, zone, baseX: L.x, baseY: L.y });
    }
    this.streamG = this.add.graphics();
    this.streamG.setDepth(STREAM_DEPTH);
    this.render();
  }

  render(wobble = 0): void {
    const tubes = this.view.tubes();
    const theme = this.view.theme();
    const showSymbols = this.view.symbols();
    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i];
      const layers = tubes[i] ?? [];
      const { tubeW: tw, tubeH: th } = this.tubeGeom(i);
      const lift = this.selected === i ? -16 : 0;
      o.root.setPosition(o.baseX, o.baseY + lift);
      o.root.setAngle(0);
      const top = layers[layers.length - 1];
      o.symbol.setText(showSymbols && top && !top.hidden ? paletteSymbol(top.color) : '');
      o.mark.setText(top && top.hidden ? '?' : '');
      this.drawGlass(o.glass, tw, th, theme);
      this.drawLiquid(o.liquid, tw, th, layers, theme, 1, wobble);
      o.fx.clear();
      if (this.hintPair && (this.hintPair.from === i || this.hintPair.to === i)) {
        o.fx.lineStyle(4, this.hintPair.from === i ? 0x22d3ee : 0xa3e635, 1);
        o.fx.strokeRoundedRect(-tw / 2 - 5, -th / 2 - 5, tw + 10, th + 10, 12);
      }
      if (this.completed[i]) {
        o.fx.lineStyle(3, 0xfacc15, 0.9);
        o.fx.strokeRoundedRect(-tw / 2 - 2, -th / 2 - 2, tw + 4, th + 4, 11);
      }
    }
    this.streamG?.clear();
  }

  private tubeGeom(i: number): { tubeW: number; tubeH: number } {
    const w = this.scale.width;
    const h = this.scale.height;
    const L = computeLayout(w, h, this.objs.length)[i];
    if (!L) return { tubeW: 56, tubeH: 140 };
    return { tubeW: L.tubeW, tubeH: L.tubeH };
  }

  /** Viewport (client) coordinates of a tube center — for DOM tutorial overlay. */
  tubeClientPos(i: number): { x: number; y: number } | null {
    if (!this.objs[i]) return null;
    const r = this.view.canvasBox();
    if (!r) return null;
    const L = computeLayout(this.scale.width, this.scale.height, this.objs.length)[i];
    if (!L) return null;
    const sx = r.width / this.scale.width;
    const sy = r.height / this.scale.height;
    return { x: r.x + L.x * sx, y: r.y + (L.y + (this.selected === i ? -16 : 0)) * sy };
  }

  private drawGlass(g: Phaser.GameObjects.Graphics, tw: number, th: number, theme: 'light' | 'dark'): void {
    g.clear();
    const rim = theme === 'light' ? 0x8fa3bd : 0x7d8aa5;
    const body = theme === 'light' ? 0xffffff : 0x232f4d;
    g.fillStyle(rim, 0.28);
    g.fillRoundedRect(-tw / 2 - 2, -th / 2 - 2, tw + 4, th + 4, 12);
    g.fillStyle(body, theme === 'light' ? 0.5 : 0.62);
    g.fillRoundedRect(-tw / 2, -th / 2, tw, th, 10);
    g.lineStyle(2.5, rim, 0.95);
    g.strokeRoundedRect(-tw / 2, -th / 2, tw, th, 10);
    g.lineStyle(3, 0xffffff, theme === 'light' ? 0.5 : 0.28);
    g.beginPath();
    g.arc(0, -th / 2 + 2, tw / 2 - 6, Math.PI * 1.15, Math.PI * 1.85);
    g.strokePath();
    g.fillStyle(0xffffff, theme === 'light' ? 0.35 : 0.14);
    g.fillRoundedRect(-tw / 2 + 4, -th / 2 + 8, 4, th * 0.45, 2);
  }

  private drawLiquid(
    g: Phaser.GameObjects.Graphics,
    tw: number,
    th: number,
    layers: ViewLayer[],
    theme: 'light' | 'dark',
    topFrac: number,
    wobble: number,
  ): void {
    g.clear();
    if (layers.length === 0) return;
    const innerW = tw - 14;
    const innerH = th - 18;
    const layerH = (innerH - LAYER_GAP * (TUBE_CAPACITY - 1)) / TUBE_CAPACITY;
    const baseY = th / 2 - 9;
    layers.forEach((l, idx) => {
      const isTop = idx === layers.length - 1;
      const hh = isTop ? layerH * Math.max(0, topFrac) : layerH;
      if (hh <= 0.5) return;
      const yy = baseY - idx * (layerH + LAYER_GAP) - hh;
      if (l.hidden) {
        g.fillStyle(theme === 'light' ? 0x3b4a63 : 0x111a2e, 1);
        g.fillRoundedRect(-innerW / 2, yy, innerW, hh, 5);
        g.fillStyle(0xffffff, 0.16);
        g.fillRoundedRect(-innerW / 2 + 3, yy + 2, 4, Math.max(1, hh - 4), 2);
        return;
      }
      const base = paletteColor(l.color, theme);
      g.fillStyle(base, 1);
      g.fillRoundedRect(-innerW / 2, yy, innerW, hh, 5);
      g.fillStyle(shade(base, 0.72), 0.35);
      const shH = Math.max(1, hh * 0.42);
      g.fillRoundedRect(-innerW / 2, yy + hh - shH, innerW, shH, 4);
      g.fillStyle(0xffffff, 0.4);
      g.fillRoundedRect(-innerW / 2 + 1, yy, innerW - 2, 2.5, 1);
      g.fillStyle(0xffffff, 0.2);
      g.fillRoundedRect(-innerW / 2 + 4, yy + 3, 5, Math.max(1, hh - 8), 2.5);
      if (isTop) {
        const wob = wobble !== 0 ? Math.sin(wobble * 6 + idx) * 1.6 * Math.abs(wobble) : 0;
        g.fillStyle(0xffffff, 0.32);
        g.fillEllipse(wob, yy + 2.5, innerW * 0.62, 5);
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
    this.tweens.killTweensOf(o.zone);
    this.tweens.add({ targets: o.zone, x: '+=7', duration: 45, yoyo: true, repeat: 3 });
  }

  pulse(i: number, color = 0x22d3ee): void {
    const o = this.objs[i];
    if (!o) return;
    const { tubeW: tw, tubeH: th } = this.tubeGeom(i);
    o.fx.clear();
    this.tweens.killTweensOf(o.fx);
    const st = { a: 0.25 };
    this.tweens.add({
      targets: st,
      a: 1,
      duration: 420,
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        o.fx.clear();
        o.fx.lineStyle(4, color, st.a);
        o.fx.strokeRoundedRect(-tw / 2 - 6, -th / 2 - 6, tw + 12, th + 12, 13);
      },
    });
  }

  stopPulse(i: number): void {
    const o = this.objs[i];
    if (!o) return;
    this.tweens.killTweensOf(o.fx);
    this.render();
  }

  flashReveal(i: number, done: () => void): void {
    const o = this.objs[i];
    if (!o) {
      done();
      return;
    }
    const { tubeW: tw, tubeH: th } = this.tubeGeom(i);
    o.fx.clear();
    const st = { a: 1 };
    this.tweens.add({
      targets: st,
      a: 0,
      duration: 700,
      onUpdate: () => {
        o.fx.clear();
        o.fx.lineStyle(5, 0xfacc15, st.a);
        o.fx.strokeRoundedRect(-tw / 2 - 7, -th / 2 - 7, tw + 14, th + 14, 14);
      },
      onComplete: () => {
        this.render();
        done();
      },
    });
    this.render();
  }

  /**
   * Pour animation on the ORIGINAL objects: the source container is raised to
   * the front layer and flown along lift → hover → tilt → pour → return, then
   * restored exactly. The target stays in place and fills. Nothing is hidden,
   * so an interruption can only leave a visible tube slightly displaced — and
   * the generation token snaps it back via render().
   */
  animatePour(
    fromIdx: number,
    toIdx: number,
    fromBefore: ViewLayer[],
    toBefore: ViewLayer[],
    count: number,
    durMs: number,
    done: () => void,
  ): void {
    const token = this.animToken;
    let finished = false;
    const finish = (restore: boolean) => {
      if (finished) return;
      finished = true;
      if (token !== this.animToken) {
        // A rebuild happened mid-flight: snap to the current logical state.
        this.stage = 'idle';
        this.render();
        done();
        return;
      }
      if (restore) {
        const f = this.objs[fromIdx];
        if (f) {
          f.root.setPosition(f.baseX, f.baseY);
          f.root.setAngle(0);
          f.root.setDepth(0);
        }
        this.streamG?.clear();
        this.stage = 'idle';
        this.render();
      }
      done();
    };
    if (durMs <= 40) {
      this.stage = 'idle';
      this.render();
      finish(false);
      return;
    }
    const theme = this.view.theme();
    const showSymbols = this.view.symbols();
    void showSymbols;
    const f = this.objs[fromIdx];
    const t = this.objs[toIdx];
    const streamG = this.streamG;
    if (!f || !t || !streamG) {
      this.render();
      finish(false);
      return;
    }
    const fGeom = this.tubeGeom(fromIdx);
    const tGeom = this.tubeGeom(toIdx);
    const moved = fromBefore.slice(-count);
    const topHidden = moved.length > 0 && moved[moved.length - 1].hidden;
    const pourColor = moved.length > 0 && !topHidden
      ? paletteColor(moved[moved.length - 1].color, theme)
      : 0x3b4a63;
    const dir = t.baseX >= f.baseX ? 1 : -1;
    // Hover point with clearance, clamped inside the field.
    const w = this.scale.width;
    const h = this.scale.height;
    let hx = t.baseX - dir * (tGeom.tubeW * 0.85);
    let hy = t.baseY - tGeom.tubeH * 0.88;
    hx = Math.min(w - fGeom.tubeW * 0.6, Math.max(fGeom.tubeW * 0.6, hx));
    hy = Math.max(fGeom.tubeH * 0.55, hy);
    const tilt = dir * 24;

    f.root.setDepth(FRONT_DEPTH);
    streamG.clear();
    this.lastAudit = null;
    this.stage = 'lift';
    const phase = { p: 0 };
    const total = pourAnimTotal(count, durMs);
    // Target keeps its pre-move picture until the pour phase.
    this.drawLiquid(t.liquid, tGeom.tubeW, tGeom.tubeH, toBefore, theme, 1, 0);

    const drawStream = (wobPhase: number, width: number) => {
      streamG.clear();
      if (width <= 0.5) return;
      const ang = (f.root.angle * Math.PI) / 180;
      const mx = f.root.x + Math.sin(ang) * fGeom.tubeH * 0.5 + dir * fGeom.tubeW * 0.28;
      const my = f.root.y - Math.cos(ang) * fGeom.tubeH * 0.5;
      const tx = t.baseX;
      const ty = t.baseY - tGeom.tubeH / 2 + 6;
      const sway = Math.sin(wobPhase * 9) * 1.8;
      const hw = width / 2;
      streamG.fillStyle(pourColor, 0.92);
      streamG.beginPath();
      streamG.moveTo(mx - hw, my);
      streamG.lineTo(mx + hw, my);
      streamG.lineTo(tx + hw * 0.7 + sway, ty);
      streamG.lineTo(tx - hw * 0.7 + sway, ty);
      streamG.closePath();
      streamG.fillPath();
      streamG.fillStyle(0xffffff, 0.3);
      streamG.fillRoundedRect((mx + tx) / 2 - 1.5 + sway * 0.5, (my + ty) / 2, 3, Math.max(2, (ty - my) / 2), 1.5);
      streamG.fillStyle(pourColor, 0.5);
      streamG.fillEllipse(tx + sway * 0.4, ty + 2, hw * 2.4, 5);
    };

    this.tweens.add({
      targets: phase,
      p: 1,
      duration: total,
      onUpdate: () => {
        if (token !== this.animToken) {
          finish(false);
          return;
        }
        const p = phase.p;
        const lift = Math.min(1, p / 0.14);
        const move = Math.min(1, Math.max(0, (p - 0.1) / 0.2));
        const tiltP = Math.min(1, Math.max(0, (p - 0.28) / 0.1));
        const pourP = Math.min(1, Math.max(0, (p - 0.36) / 0.34));
        const back = Math.min(1, Math.max(0, (p - 0.74) / 0.18));
        const ease = (x: number) => x * x * (3 - 2 * x);
        const eLift = ease(lift);
        const eMove = ease(move);
        const eBack = ease(back);
        const x = f.baseX + (hx - f.baseX) * eMove * (1 - eBack);
        const y = f.baseY - 30 * eLift + (hy - (f.baseY - 30)) * eMove * (1 - eBack);
        f.root.setPosition(x, y);
        f.root.setAngle(tilt * ease(tiltP) * (1 - eBack));
        const wob = Math.sin(pourP * Math.PI) * 0.8;
        this.stage = back > 0
          ? 'return'
          : pourP > 0
            ? 'pour'
            : tiltP < 1
              ? move < 1
                ? lift < 1
                  ? 'lift'
                  : 'move'
                : 'tilt'
              : 'tilt';
        // Per-unit progress: each block visibly drains from the source and
        // grows in the target before the next one starts (no teleporting).
        const uc = Math.min(count, pourP * count);
        const k = Math.min(count, Math.floor(uc));
        const frac = uc - k;
        const n = fromBefore.length;
        let srcShown: ViewLayer[];
        let srcFrac: number;
        if (frac <= 0.001) {
          srcShown = fromBefore.slice(0, Math.max(0, n - k));
          srcFrac = 1;
        } else {
          srcShown = fromBefore.slice(0, Math.max(0, n - k));
          srcFrac = 1 - frac;
        }
        const dstFull = toBefore.concat(moved.slice(0, k));
        let dstShown: ViewLayer[];
        let dstFrac: number;
        if (frac > 0.001 && k < moved.length) {
          dstShown = dstFull.concat([moved[k]]);
          dstFrac = frac;
        } else {
          dstShown = dstFull;
          dstFrac = 1;
        }
        this.drawLiquid(f.liquid, fGeom.tubeW, fGeom.tubeH, srcShown, theme, srcFrac, wob);
        this.drawLiquid(t.liquid, tGeom.tubeW, tGeom.tubeH, dstShown, theme, dstFrac, wob * 0.7);
        // Stream pulses once per block with a visible gap at unit boundaries.
        const sw = pourP > 0 && pourP < 1 && frac > 0.02 && frac < 0.98
          ? 5 + Math.sin(frac * Math.PI) * 5
          : 0;
        drawStream(pourP * 10, sw);
        if (pourP > 0.15 && pourP < 0.85 && !this.lastAudit) {
          const hw = sw / 2;
          const inX = x - fGeom.tubeW / 2 >= -2 && x + fGeom.tubeW / 2 <= w + 2;
          const inY = y - fGeom.tubeH / 2 >= -2 && y + fGeom.tubeH / 2 <= h + 2;
          this.lastAudit = {
            srcVisible: f.root.visible && f.root.alpha > 0,
            srcInBounds: inX && inY,
            streamOn: hw > 2,
          };
        }
      },
      onComplete: () => {
        if (token !== this.animToken) {
          finish(false);
          return;
        }
        this.stage = 'settle';
        const st = { w: 1 };
        this.tweens.add({
          targets: st,
          w: 0,
          duration: 220,
          onUpdate: () => {
            if (token !== this.animToken) {
              finish(false);
              return;
            }
            this.render(st.w * 0.9);
          },
          onComplete: () => finish(true),
        });
      },
    });
  }

  celebrate(done: () => void): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const g = this.add.graphics().setDepth(40);
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
