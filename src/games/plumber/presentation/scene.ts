// Plumber Phaser scene: pure presentation of RuntimeState. No game logic here.
import * as Phaser from 'phaser';
import { PIPE_CAPACITY, portsOf, type LevelDefinition } from '../domain/model';
import { channelGeometry, fillFrom, type Side } from './channel';

export const TILE = 256;

const KIND_TEXTURE: Record<string, string> = {
  straight: 'pipe_straight',
  elbow: 'pipe_elbow',
  t: 'pipe_t',
  cross: 'pipe_cross',
  cap: 'pipe_cap',
  valve: 'valve_basic',
  filter: 'filter_basic',
  mixer: 'mixer_basic',
  distributor: 'distributor_basic',
  source: 'source_basic',
  receiver: 'receiver_basic',
};

const WATER_COLORS: Record<string, number> = {
  blue: 0x2fa8de,
  red: 0xe05a4e,
  yellow: 0xf2c230,
  green: 0x44b570,
  purple: 0x9a6ee8,
};

export interface SceneRefs {
  onTapCell: (index: number) => void;
}

export class PlumberScene extends Phaser.Scene {
  private def!: LevelDefinition;
  private cell = 96;
  private ox = 0;
  private oy = 0;
  private sprites: Array<Phaser.GameObjects.Image | null> = [];
  private shownKinds: string[] = [];
  private gfx: Array<Phaser.GameObjects.Graphics> = [];
  private waterGfx: Array<Phaser.GameObjects.Graphics> = [];
  private fallback = false;
  private refs: SceneRefs = { onTapCell: () => undefined };
  private rots: number[] = [];
  private kinds: string[] = [];
  private valves: boolean[] = [];
  private colors: Array<string | null> = [];
  private fractions: number[] = [];
  private cameFrom: Array<Side | null> = [];
  private leak = -1;
  private hint = -1;

  constructor() {
    super('plumber');
  }

  init(data: { def: LevelDefinition; refs: SceneRefs }): void {
    this.def = data.def;
    this.refs = data.refs;
    this.kinds = data.def.cells.map((c) => c.kind);
    this.valves = data.def.cells.map((c) => c.valveOpen !== false);
    this.rots = data.def.cells.map((c) => c.rot);
    this.shownKinds = [...this.kinds];
  }

  preload(): void {
    if (!this.textures.exists('plumber-atlas')) {
      this.load.atlas('plumber', 'assets/plumber/atlas.png', 'assets/plumber/atlas.json');
    }
  }

  create(): void {
    this.fallback = !this.textures.exists('plumber') || !this.textures.get('plumber').has('pipe_straight');
    this.layout();
    this.buildCells();
    this.scale.on('resize', () => {
      this.layout();
      this.buildCells();
      this.redrawAll();
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const idx = this.pick(p.x, p.y);
      if (idx >= 0) this.refs.onTapCell(idx);
    });
  }

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.cell = Math.max(40, Math.floor(Math.min(w / this.def.gridW, h / this.def.gridH)));
    this.ox = Math.floor((w - this.cell * this.def.gridW) / 2);
    this.oy = Math.floor((h - this.cell * this.def.gridH) / 2);
  }

  private buildCells(): void {
    for (const s of this.sprites) s?.destroy();
    for (const g of [...this.gfx, ...this.waterGfx]) g.destroy();
    this.sprites = [];
    this.gfx = [];
    this.waterGfx = [];
    this.shownKinds = this.def.cells.map((_, i) => this.kindOf(i));
    const n = this.def.gridW * this.def.gridH;
    for (let i = 0; i < n; i++) {
      const { x, y } = this.cellXY(i);
      const bg = this.add.graphics();
      bg.fillStyle(0x141c2e, 1);
      bg.fillRoundedRect(x, y, this.cell, this.cell, Math.max(4, this.cell * 0.08));
      bg.lineStyle(1, 0x2a3a55, 1);
      bg.strokeRoundedRect(x, y, this.cell, this.cell, Math.max(4, this.cell * 0.08));
      this.gfx.push(bg);
      const kind = this.kindOf(i);
      const frame = KIND_TEXTURE[kind];
      if (!this.fallback && frame && this.textures.get('plumber').has(frame)) {
        const img = this.add.image(x + this.cell / 2, y + this.cell / 2, 'plumber', frame);
        img.setDisplaySize(this.cell * 0.96, this.cell * 0.96);
        img.setData('cell', i);
        this.sprites.push(img);
      } else {
        const g = this.add.graphics();
        g.setData('cell', i);
        this.drawPrimitive(g, i, x, y);
        this.sprites.push(null);
        this.gfx.push(g);
      }
      const wg = this.add.graphics();
      this.waterGfx.push(wg);
    }
    this.redrawAll();
  }

  cellXY(i: number): { x: number; y: number } {
    const gx = i % this.def.gridW;
    const gy = Math.floor(i / this.def.gridW);
    return { x: this.ox + gx * this.cell, y: this.oy + gy * this.cell };
  }

  private pick(px: number, py: number): number {
    const gx = Math.floor((px - this.ox) / this.cell);
    const gy = Math.floor((py - this.oy) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.def.gridW || gy >= this.def.gridH) return -1;
    return gy * this.def.gridW + gx;
  }

  /** Full state sync from model (rots, kinds, valves, water per cell, extras). */
  sync(rots: number[], _water: number[], colors: Array<string | null>, fractions: number[], leak: number, hint: number, animate: number | null, kinds?: string[], valves?: boolean[], cameFrom?: Array<Side | null>): void {
    this.rots = [...rots];
    if (kinds) this.kinds = [...kinds];
    if (valves) this.valves = [...valves];
    if (cameFrom) this.cameFrom = [...cameFrom];
    void _water;
    this.colors = [...colors];
    this.fractions = [...fractions];
    this.leak = leak;
    this.hint = hint;
    const n = this.def.gridW * this.def.gridH;
    for (let i = 0; i < n; i++) {
      const spr = this.sprites[i];
      const target = this.rots[i] * 90;
      if (spr) {
        const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (i === animate && !reduceMotion) {
          this.tweens.killTweensOf(spr);
          this.tweens.add({ targets: spr, angle: spr.angle + 90, duration: 140, ease: 'Sine.easeInOut' });
        } else {
          spr.setAngle(target);
        }
        const closed = this.kindOf(i) === 'valve' && !(this.valves[i] ?? true);
        spr.setAlpha(closed ? 0.55 : 1);
      }
      if (this.shownKinds[i] !== this.kindOf(i)) {
        this.shownKinds[i] = this.kindOf(i);
        this.rebuildCell(i);
      }
    }
    this.redrawAll();
  }

  private rebuildCell(i: number): void {
    const spr = this.sprites[i];
    spr?.destroy();
    this.sprites[i] = null;
    const { x, y } = this.cellXY(i);
    const kind = this.kindOf(i);
    const frame = KIND_TEXTURE[kind];
    if (!this.fallback && frame && this.textures.get('plumber').has(frame)) {
      const img = this.add.image(x + this.cell / 2, y + this.cell / 2, 'plumber', frame);
      img.setDisplaySize(this.cell * 0.96, this.cell * 0.96);
      img.setAngle((this.rots[i] ?? 0) * 90);
      this.sprites[i] = img;
    } else {
      const g = this.add.graphics();
      this.drawPrimitive(g, i, x, y);
      this.gfx.push(g);
    }
    this.redrawAll();
  }

  private redrawAll(): void {
    const n = this.def.gridW * this.def.gridH;
    for (let i = 0; i < n; i++) this.drawWater(i);
  }

  private drawWater(i: number): void {
    const g = this.waterGfx[i];
    if (!g) return;
    g.clear();
    const { x, y } = this.cellXY(i);
    const frac = this.fractions[i] ?? 0;
    const kind = this.kindOf(i);
    const color = WATER_COLORS[this.colors[i] ?? 'blue'] ?? 0x2fa8de;

    if (i === this.leak && frac <= 0) {
      g.fillStyle(0xe05a4e, 0.9);
      g.fillCircle(x + this.cell / 2, y + this.cell / 2, this.cell * 0.1);
    }

    if (frac > 0) {
      if (kind === 'source' || kind === 'receiver') {
        // Tanks are reservoirs, not pipes: fill a bounded reservoir body.
        const inset = this.cell * 0.24;
        const wdt = this.cell - inset * 2;
        const bodyH = this.cell - inset * 2;
        const hgt = bodyH * Math.min(1, frac);
        g.fillStyle(color, 0.85);
        g.fillRoundedRect(x + inset, y + this.cell - inset - hgt, wdt, hgt, Math.min(10, wdt * 0.18));
        g.lineStyle(2, 0xffffff, 0.18);
        g.strokeRoundedRect(x + inset, y + this.cell - inset - bodyH, wdt, bodyH, Math.min(10, wdt * 0.18));
      } else {
        this.drawChannelWater(g, i, x, y, kind, color, frac);
      }
    }

    if (i === this.hint) {
      g.lineStyle(3, 0xf2c230, 1);
      g.strokeRoundedRect(x + 3, y + 3, this.cell - 6, this.cell - 6, 8);
    }
  }

  /** Liquid follows the internal channel of the pipe, from the inlet side. */
  private drawChannelWater(g: Phaser.GameObjects.Graphics, i: number, x: number, y: number, kind: string, color: number, frac: number): void {
    const rot = this.rots[i] ?? 0;
    const open = kind !== 'valve' || (this.valves[i] ?? true);
    const geo = channelGeometry(kind as never, rot, open);
    if (geo.segments.length === 0) return;
    const filled = fillFrom(geo, this.cameFrom[i] ?? null, frac);
    if (filled.length === 0) return;
    const c = this.cell;
    const width = Math.max(3, geo.halfWidth * 2 * c);
    const px = (p: { x: number; y: number }) => ({ x: x + p.x * c, y: y + p.y * c });
    // Outer wet band.
    g.lineStyle(width, color, 0.85);
    for (const s of filled) {
      const a = px(s.a);
      const b = px(s.b);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
    }
    // Round joints so corners/tees connect seamlessly.
    g.fillStyle(color, 0.85);
    for (const s of filled) {
      const a = px(s.a);
      g.fillCircle(a.x, a.y, width / 2);
    }
    const last = filled[filled.length - 1];
    if (last) {
      const b = px(last.b);
      g.fillCircle(b.x, b.y, width / 2);
    }
    // Inner highlight (reads as liquid depth, no topology change).
    g.lineStyle(Math.max(1, width * 0.32), 0xffffff, 0.16);
    for (const s of filled) {
      const a = px(s.a);
      const b = px(s.b);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
    }
  }

  private kindOf(i: number): string {
    return this.kinds[i] ?? this.def.cells[i].kind;
  }

  /** Primitive fallback tile (no atlas frame): port stubs + kind glyph + TMP badge. */
  private drawPrimitive(g: Phaser.GameObjects.Graphics, i: number, x: number, y: number): void {
    const c = this.cell;
    const cx = x + c / 2;
    const cy = y + c / 2;
    const kind = this.kindOf(i);
    const open = kind !== 'valve' || (this.valves[i] ?? true);
    g.fillStyle(open ? 0x3e4e61 : 0x2a3442, 1);
    if (kind === 'mixer') g.fillRect(cx - c * 0.28, cy - c * 0.28, c * 0.56, c * 0.56);
    else g.fillCircle(cx, cy, c * 0.3);
    const ports = portsOf({ kind: kind as never, rot: this.rots[i] ?? 0, valveOpen: open }, this.rots[i] ?? 0);
    g.fillStyle(open ? 0x3e4e61 : 0x2a3442, 1);
    const stub = c * 0.22;
    const th = c * 0.2;
    if (ports.top) g.fillRect(cx - th / 2, y + 2, th, stub);
    if (ports.bottom) g.fillRect(cx - th / 2, y + c - 2 - stub, th, stub);
    if (ports.left) g.fillRect(x + 2, cy - th / 2, stub, th);
    if (ports.right) g.fillRect(x + c - 2 - stub, cy - th / 2, stub, th);
    if (kind === 'filter') {
      g.fillStyle(0xf2c230, 1);
      g.fillRect(cx - th / 2, cy - 2, th, 4);
    }
    if (kind === 'mixer') {
      g.fillStyle(0x9a6ee8, 1);
      g.fillCircle(cx, cy, c * 0.08);
    }
    if (kind === 'distributor') {
      g.fillStyle(0xf2c230, 1);
      g.fillCircle(cx, cy, c * 0.07);
    }
    if (kind === 'valve' && !open) {
      g.lineStyle(3, 0xe05a4e, 1);
      g.lineBetween(cx - c * 0.2, cy - c * 0.2, cx + c * 0.2, cy + c * 0.2);
    }
    g.fillStyle(0xca443e, 1);
    g.fillRect(cx - c * 0.16, y + c - 14, c * 0.32, 10);
  }

  /** Primitive fallback tile (no atlas): port stubs + TMP badge, dev-visible. */
  drawFallbackTile(i: number, ports: { top: boolean; right: boolean; bottom: boolean; left: boolean }): void {
    const g = this.gfx.find((gg) => gg.getData('cell') === i);
    if (!g) return;
    void ports;
  }

  usesFallback(): boolean {
    return this.fallback;
  }

  cellCenter(i: number): { x: number; y: number } {
    const { x, y } = this.cellXY(i);
    return { x: x + this.cell / 2, y: y + this.cell / 2 };
  }

  gridDims(): { w: number; h: number; cell: number; ox: number; oy: number } {
    return { w: this.def.gridW, h: this.def.gridH, cell: this.cell, ox: this.ox, oy: this.oy };
  }
}

export { PIPE_CAPACITY };
