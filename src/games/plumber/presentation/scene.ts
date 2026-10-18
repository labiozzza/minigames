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

/** Field art (no ports): ground texture only. Empty cells are plain ground. */
const GROUND_FRAME = 'env_ground';
/** Art variants for a logical `blocked` cell — chosen deterministically per cell. */
const OBSTACLE_FRAMES = ['obstacle_rock', 'obstacle_rocks', 'obstacle_mound'];

const WATER_COLORS: Record<string, number> = {
  blue: 0x2fa8de,
  red: 0xe05a4e,
  yellow: 0xf2c230,
  green: 0x44b570,
  purple: 0x9a6ee8,
};

/** Blend a 0xRRGGBB colour toward white (amt>0) — volume highlights. */
function lighten(color: number, amt: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const up = (v: number): number => Math.round(v + (255 - v) * amt);
  return (up(r) << 16) | (up(g) << 8) | up(b);
}

/** Blend a 0xRRGGBB colour toward black — refraction edges. */
function darken(color: number, amt: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const dn = (v: number): number => Math.round(v * (1 - amt));
  return (dn(r) << 16) | (dn(g) << 8) | dn(b);
}

export type Quality = 'auto' | 'high' | 'low';

export interface SceneSettings {
  symbols: boolean;
  reducedMotion: boolean;
  flashFree: boolean;
  noDrag: boolean;
  quality: Quality;
}

export interface SceneRefs {
  /** Short tap on a cell (rotate / phase-appropriate action). */
  onTapCell: (index: number) => void;
  /** Long press: "select / carry" this cell according to available operations. */
  onSelectCell?: (index: number) => void;
  /** Drag started from this cell (highlight only, no state change yet). */
  onDragStart?: (index: number) => void;
  /** Drag-and-drop move from one cell to another (only when moves are allowed). */
  onMoveCell?: (from: number, to: number) => void;
  /** Whether the current level allows moving pipes (drag/carry). */
  canMove?: () => boolean;
  /** §12 shared accessibility + graphics preferences. */
  settings?: () => SceneSettings;
  /** Fired once sprites/tiles exist. The host syncs state here instead of a timer. */
  onReady?: () => void;
}

interface PointerTrack {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  cell: number;
  startT: number;
  moved: boolean;
  dragging: boolean;
  longTimer: number;
}

export class PlumberScene extends Phaser.Scene {
  private def!: LevelDefinition;
  private cell = 96;
  private ox = 0;
  private oy = 0;
  private focusGfx!: Phaser.GameObjects.Graphics;
  private focus = -1;
  /** Focus ring is a *keyboard* affordance: hidden for pointer/touch input. */
  private focusKeyboard = false;
  private guideGfx!: Phaser.GameObjects.Graphics;
  private guideIcon: Phaser.GameObjects.Text | null = null;
  private carryGfx!: Phaser.GameObjects.Graphics;
  private carryChip: Phaser.GameObjects.Image | null = null;
  private errorGfx!: Phaser.GameObjects.Graphics;
  private pointers = new Map<number, PointerTrack>();
  private pinchStart = 0;
  private pinchZoom = 1;
  private cameraBound = false;
  private sprites: Array<Phaser.GameObjects.Image | null> = [];
  private shownKinds: string[] = [];
  private gfx: Array<Phaser.GameObjects.Graphics> = [];
  private waterGfx: Array<Phaser.GameObjects.Graphics> = [];
  private groundGfx: Phaser.GameObjects.Graphics | null = null;
  private groundLayer: Phaser.GameObjects.TileSprite | null = null;
  private lockLayer: Phaser.GameObjects.Graphics | null = null;
  private fallback = false;
  private refs: SceneRefs = { onTapCell: () => undefined };
  private rots: number[] = [];
  private kinds: string[] = [];
  private valves: boolean[] = [];
  private colors: Array<string | null> = [];
  private fractions: number[] = [];
  /** Smoothed fill levels: ease toward `fractions` between fixed sim ticks. */
  private shownFractions: number[] = [];
  private targetFractions: number[] = [];
  private waterAnim = false;
  private cameFrom: Array<Side | null> = [];
  private leak = -1;
  private hint = -1;
  private qLevel = 0;
  private frames: number[] = [];
  private lowStreak = 0;

  private prefs(): SceneSettings {
    return this.refs.settings?.() ?? { symbols: false, reducedMotion: false, flashFree: false, noDrag: false, quality: 'auto' };
  }

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
    this.focusGfx = this.add.graphics();
    this.focusGfx.setDepth(1000);
    this.guideGfx = this.add.graphics();
    this.guideGfx.setDepth(1001);
    this.carryGfx = this.add.graphics();
    this.carryGfx.setDepth(998);
    this.errorGfx = this.add.graphics();
    this.errorGfx.setDepth(1002);
    this.installCamera();
    this.scale.on('resize', () => {
      this.layout();
      this.buildCells();
      this.installCamera();
      this.redrawAll();
      this.drawFocus();
    });
    this.installGestures();
    // Tiles now exist: let the host push the model state (no deferred timer).
    this.refs.onReady?.();
  }

  /** Camera: zoom bounds, clamped pan, pointer/wheel zoom. */
  private installCamera(): void {
    const cam = this.cameras.main;
    if (!this.cameraBound) {
      cam.setZoom(1);
      this.cameraBound = true;
    }
    this.clampCamera();
  }

  private minZoom(): number { return 1; }
  private maxZoom(): number { return this.def.gridW * this.def.gridH <= 25 ? 4 : 3; }

  private clampCamera(): void {
    const cam = this.cameras.main;
    const z = Phaser.Math.Clamp(cam.zoom, this.minZoom(), this.maxZoom());
    cam.setZoom(z);
    // At fit zoom the whole grid is visible: never scroll (keeps tap coords stable).
    if (z <= 1.001) {
      cam.setScroll(0, 0);
      return;
    }
    const gw = this.def.gridW * this.cell;
    const gh = this.def.gridH * this.cell;
    const viewW = cam.width / z;
    const viewH = cam.height / z;
    const minX = this.ox + this.cell / 2 - viewW / 2;
    const maxX = this.ox + gw - this.cell / 2 - viewW / 2;
    const minY = this.oy + this.cell / 2 - viewH / 2;
    const maxY = this.oy + gh - this.cell / 2 - viewH / 2;
    cam.scrollX = minX <= maxX ? Phaser.Math.Clamp(cam.scrollX, minX, maxX) : this.ox + gw / 2 - viewW / 2;
    cam.scrollY = minY <= maxY ? Phaser.Math.Clamp(cam.scrollY, minY, maxY) : this.oy + gh / 2 - viewH / 2;
  }

  private zoomAt(px: number, py: number, factor: number): void {
    const cam = this.cameras.main;
    const before = this.pickWorld(px, py);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, this.minZoom(), this.maxZoom()));
    const after = this.pickWorld(px, py);
    // Keep the point under the pointer/fingers stable.
    cam.scrollX += (before.x - after.x) / cam.zoom;
    cam.scrollY += (before.y - after.y) / cam.zoom;
    this.clampCamera();
  }

  private pickWorld(px: number, py: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: px / cam.zoom + cam.scrollX, y: py / cam.zoom + cam.scrollY };
  }

  private installGestures(): void {
    const input = this.input;
    input.addPointer(3);
    input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p, true));
    input.on('gameout', (p: Phaser.Input.Pointer) => this.onUp(p, false));
    input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, dy > 0 ? 0.9 : 1.1);
    });
    // Safety net: releases outside the canvas must not leave a stuck drag.
    // Phaser's Pointer.id is the DOM pointerId, so window events match the map.
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', (e) => {
        const t = this.pointers.get(e.pointerId);
        if (t) this.endTrack(e.pointerId, null, false);
      });
      window.addEventListener('pointercancel', (e) => this.endTrack(e.pointerId, null, false));
      // Losing focus (tab switch, system gesture) must drop every pending track.
      window.addEventListener('blur', () => {
        for (const id of [...this.pointers.keys()]) this.endTrack(id, null, false);
      });
    }
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const w = p.worldX !== undefined ? { x: p.worldX, y: p.worldY } : this.pickWorld(p.x, p.y);
    const cellIdx = this.pickAt(w.x, w.y);
    if (this.pointers.size >= 1 && !this.pointers.has(p.id)) {
      // Second finger: switch to pinch, cancel any pending tap/drag.
      for (const t of this.pointers.values()) this.clearLong(t);
    }
    const track: PointerTrack = {
      id: p.id, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y,
      cell: cellIdx, startT: this.time.now, moved: false, dragging: false, longTimer: 0,
    };
    // Register the pointer *before* arming the hold timer: the first touch sees
    // size 0 here, so checking size===1 later would otherwise never start it.
    this.pointers.set(p.id, track);
    if (this.pointers.size === 1 && cellIdx >= 0 && !this.prefs().noDrag) {
      track.longTimer = window.setTimeout(() => {
        if (!track.moved && this.pointers.size === 1 && this.refs.onSelectCell && this.refs.canMove?.()) {
          this.refs.onSelectCell(cellIdx);
          track.dragging = true;
        }
      }, 380);
    }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
      this.pinchZoom = this.cameras.main.zoom;
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const t = this.pointers.get(p.id);
    if (!t) return;
    const dx = p.x - t.startX;
    const dy = p.y - t.startY;
    const dist = Math.hypot(dx, dy);
    const slop = 12;
    t.lastX = p.x;
    t.lastY = p.y;
    if (!t.moved && dist > slop) {
      t.moved = true;
      this.clearLong(t);
    }
    // Zoom > 1: one finger pans (predictable camera control).
    if (this.pointers.size === 1 && this.cameras.main.zoom > 1.001) {
      if (t.moved) this.panCamera(t);
      return;
    }
    // Two fingers: pinch zoom + centroid pan.
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist2 = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
      if (this.pinchStart > 0 && dist2 > 0) {
        const factor = dist2 / this.pinchStart;
        const cam = this.cameras.main;
        cam.setZoom(Phaser.Math.Clamp(this.pinchZoom * factor, this.minZoom(), this.maxZoom()));
        this.clampCamera();
      }
      return;
    }
    // Single finger drag when moves are allowed → drag-and-drop move.
    if (t.moved && !this.prefs().noDrag && this.refs.canMove?.() && !t.dragging) {
      t.dragging = true;
      this.refs.onDragStart?.(t.cell);
    }
  }

  private panCamera(t: PointerTrack): void {
    const cam = this.cameras.main;
    cam.scrollX -= (t.lastX - t.startX) / cam.zoom;
    cam.scrollY -= (t.lastY - t.startY) / cam.zoom;
    this.clampCamera();
    t.startX = t.lastX;
    t.startY = t.lastY;
  }

  private onUp(p: Phaser.Input.Pointer, inCanvas: boolean): void {
    const t = this.pointers.get(p.id);
    if (!t) return;
    const w = p.worldX !== undefined ? { x: p.worldX, y: p.worldY } : this.pickWorld(p.x, p.y);
    const target = inCanvas ? this.pickAt(w.x, w.y) : -1;
    const wasPinch = this.pointers.size >= 2;
    const quick = this.time.now - t.startT < 380;
    if (!wasPinch && !t.moved && quick && t.cell >= 0 && target === t.cell) {
      this.refs.onTapCell(t.cell);
    } else if (!wasPinch && t.dragging && this.refs.canMove?.() && target >= 0 && target !== t.cell) {
      this.refs.onMoveCell?.(t.cell, target);
    }
    this.endTrack(p.id, null, false);
  }

  private endTrack(id: number, _unused: unknown, _flag: boolean): void {
    const t = this.pointers.get(id);
    if (t) this.clearLong(t);
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinchStart = 0;
    if (this.pointers.size === 0) this.clampCamera();
  }

  private clearLong(t: PointerTrack): void {
    if (t.longTimer) {
      window.clearTimeout(t.longTimer);
      t.longTimer = 0;
    }
  }

  private pickAt(wx: number, wy: number): number {
    const gx = Math.floor((wx - this.ox) / this.cell);
    const gy = Math.floor((wy - this.oy) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.def.gridW || gy >= this.def.gridH) return -1;
    return gy * this.def.gridW + gx;
  }

  /** Visible keyboard focus ring (independent of hint/selection). */
  setFocus(index: number, keyboard = false): void {
    this.focus = index;
    this.focusKeyboard = keyboard;
    this.drawFocus();
  }

  private drawFocus(): void {
    if (!this.focusGfx) return;
    this.focusGfx.clear();
    if (!this.focusKeyboard) return;
    if (this.focus < 0 || this.focus >= this.def.gridW * this.def.gridH) return;
    const { x, y } = this.cellXY(this.focus);
    this.focusGfx.lineStyle(3, 0xffffff, 0.9);
    this.focusGfx.strokeRoundedRect(x + 2, y + 2, this.cell - 4, this.cell - 4, 8);
  }

  /**
   * Carry affordance (take→place): a floating chip of the carried pipe plus an
   * accent outline on every cell the pipe can be dropped into. Always cleared
   * when nothing is carried, so no phantom "carry" frame ever sticks around.
   */
  setCarry(carried: string | null, valid: number[]): void {
    if (this.carryGfx) this.carryGfx.clear();
    if (this.carryChip) { this.carryChip.destroy(); this.carryChip = null; }
    if (!carried) return;
    const accent = 0x6fd3ff;
    if (this.carryGfx) {
      for (const i of valid) {
        const { x, y } = this.cellXY(i);
        this.carryGfx.lineStyle(3, accent, 0.9);
        this.carryGfx.strokeRoundedRect(x + 4, y + 4, this.cell - 8, this.cell - 8, 8);
      }
    }
    const frame = KIND_TEXTURE[carried];
    if (frame && this.hasFrame(frame)) {
      const cx = this.ox + (this.cell * this.def.gridW) / 2;
      const chip = this.add.image(cx, this.oy - this.cell * 0.5, 'plumber', frame);
      chip.setDisplaySize(this.cell * 0.7, this.cell * 0.7);
      chip.setDepth(1004);
      this.carryChip = chip;
    }
  }

  private reducedMotion(): boolean {
    const p = this.prefs();
    if (p.reducedMotion || p.flashFree) return true;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * §12 automatic quality: watch real frame times and step decoration down after
   * a sustained p95 drop, step back up when the render recovers. Physics, masks,
   * colors and command order are never touched. A manual setting pins the level.
   */
  update(_time: number, delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    if (this.waterAnim) this.stepWater(Math.min(delta, 60));
    this.frames.push(delta);
    if (this.frames.length > 120) this.frames.shift();
    const override = this.prefs().quality;
    if (override === 'low') { this.setQuality(2); return; }
    if (override === 'high') { this.setQuality(0); return; }
    if (this.frames.length < 60) return;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    if (p95 > 33) this.lowStreak = Math.min(60, this.lowStreak + 1);
    else if (p95 < 22) this.lowStreak = Math.max(-60, this.lowStreak - 1);
    if (this.lowStreak >= 3 && this.qLevel < 2) { this.setQuality(this.qLevel + 1); this.lowStreak = 0; }
    else if (this.lowStreak <= -6 && this.qLevel > 0) { this.setQuality(this.qLevel - 1); this.lowStreak = 0; }
  }

  private setQuality(level: number): void {
    if (level === this.qLevel) return;
    this.qLevel = level;
    this.redrawAll();
  }

  /** Ease drawn fill levels toward the model's per-tick truth. */
  private stepWater(deltaMs: number): void {
    const k = Math.min(1, deltaMs / 110);
    let active = false;
    for (let i = 0; i < this.targetFractions.length; i++) {
      const t = this.targetFractions[i] ?? 0;
      const c = this.shownFractions[i] ?? 0;
      if (Math.abs(t - c) > 0.002) {
        this.shownFractions[i] = c + (t - c) * k;
        active = true;
      } else this.shownFractions[i] = t;
    }
    if (active) this.redrawAll();
    else this.waterAnim = false;
  }

  /** §12 measured render stats (frame time in ms). */
  perf(): { min: number; median: number; p95: number; samples: number; quality: number } {
    if (this.frames.length === 0) return { min: 0, median: 0, p95: 0, samples: 0, quality: this.qLevel };
    const s = [...this.frames].sort((a, b) => a - b);
    return {
      min: s[0],
      median: s[Math.floor(s.length / 2)],
      p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
      samples: s.length,
      quality: this.qLevel,
    };
  }

  /**
   * Onboarding highlight (§8): a pulsing ring on the real cell to touch plus an
   * action icon. Never text. Respects reduced-motion (static ring, no pulse).
   */
  setGuide(cell: number | null, icon?: string): void {
    if (!this.guideGfx) return;
    this.guideGfx.clear();
    if (this.guideIcon) { this.guideIcon.destroy(); this.guideIcon = null; }
    if (cell === null || cell < 0) return;
    const { x, y } = this.cellXY(cell);
    this.guideGfx.lineStyle(5, 0xf2c230, 0.95);
    this.guideGfx.strokeRoundedRect(x + 3, y + 3, this.cell - 6, this.cell - 6, 10);
    if (icon) {
      this.guideIcon = this.add.text(x + this.cell / 2, y + this.cell / 2, icon, { fontSize: `${Math.round(this.cell * 0.42)}px` });
      this.guideIcon.setOrigin(0.5);
      this.guideIcon.setDepth(1003);
    }
    if (!this.reducedMotion()) {
      this.guideGfx.setAlpha(1);
      this.tweens.add({ targets: this.guideGfx, alpha: 0.45, duration: 700, yoyo: true, repeat: -1 });
    }
  }

  /** Non-textual failure cue: the real leaking cell pulses red. */
  flashError(cell: number): void {
    if (!this.errorGfx || cell < 0 || cell >= this.def.gridW * this.def.gridH) return;
    const { x, y } = this.cellXY(cell);
    this.errorGfx.clear();
    this.errorGfx.lineStyle(6, 0xe05a4e, 1);
    this.errorGfx.strokeRoundedRect(x + 3, y + 3, this.cell - 6, this.cell - 6, 10);
    if (this.reducedMotion()) return;
    this.errorGfx.setAlpha(1);
    this.tweens.add({
      targets: this.errorGfx,
      alpha: 0,
      duration: 900,
      repeat: 2,
      yoyo: true,
      onComplete: () => this.errorGfx.clear(),
    });
  }

  cameraState(): { zoom: number; scrollX: number; scrollY: number } {
    const cam = this.cameras.main;
    return { zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY };
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
    this.groundLayer?.destroy();
    this.groundLayer = null;
    this.groundGfx?.destroy();
    this.lockLayer?.destroy();
    this.sprites = [];
    this.gfx = [];
    this.waterGfx = [];
    this.shownKinds = this.def.cells.map((_, i) => this.kindOf(i));
    this.buildGround();
    const n = this.def.gridW * this.def.gridH;
    for (let i = 0; i < n; i++) {
      const { x, y } = this.cellXY(i);
      const kind = this.kindOf(i);
      const frame = kind === 'empty' ? null : this.frameFor(kind, i);
      if (frame) {
        const img = this.add.image(x + this.cell / 2, y + this.cell / 2, 'plumber', frame);
        img.setDisplaySize(this.cell * 0.96, this.cell * 0.96);
        // Orientation is applied at creation: the very first frame already matches
        // the model. Obstacles/ground are never rotated.
        img.setAngle(kind === 'blocked' ? 0 : (this.rots[i] ?? 0) * 90);
        img.setData('cell', i);
        // The approved glass tiles are opaque through the bore, so the liquid layer
        // must sit *above* the sprite (depth 2) and be clipped to a band narrower
        // than the tube, leaving the walls visible around it → reads as inside.
        img.setDepth(1);
        this.sprites.push(img);
      } else if (kind === 'empty') {
        // Free ground: no tile, no marker and no scenery — only the ground shows.
        this.sprites.push(null);
      } else {
        const g = this.add.graphics();
        g.setData('cell', i);
        this.drawPrimitive(g, i, x, y);
        this.sprites.push(null);
        this.gfx.push(g);
      }
      const wg = this.add.graphics();
      wg.setDepth(2);
      this.waterGfx.push(wg);
    }
    this.lockLayer = this.add.graphics();
    this.lockLayer.setDepth(3);
    this.redrawAll();
  }

  /** Texture frame for a cell: pipe sprite, obstacle variant, or null (empty/no art). */
  private frameFor(kind: string, i: number): string | null {
    if (kind === 'empty') return null;
    if (kind === 'blocked') {
      const list = OBSTACLE_FRAMES.filter((f) => this.hasFrame(f));
      if (list.length === 0) return null;
      return list[(i * 2654435761 >>> 0) % list.length];
    }
    const f = KIND_TEXTURE[kind];
    return f && this.hasFrame(f) ? f : null;
  }

  private hasFrame(frame: string): boolean {
    return !this.fallback && this.textures.get('plumber').has(frame);
  }

  /** One cohesive ground for the whole field: a soil texture clipped to the bounds. */
  private buildGround(): void {
    const pad = Math.round(this.cell * 0.14);
    const w = this.cell * this.def.gridW + pad * 2;
    const h = this.cell * this.def.gridH + pad * 2;
    const x0 = this.ox - pad;
    const y0 = this.oy - pad;
    const g = this.add.graphics();
    g.setDepth(-11);
    if (this.hasFrame(GROUND_FRAME)) {
      const ts = this.add.tileSprite(x0 + w / 2, y0 + h / 2, w, h, 'plumber', GROUND_FRAME);
      ts.setDepth(-13);
      const scale = (this.cell * 1.4) / Math.max(1, ts.frame.width || 256);
      ts.setTileScale(scale, scale);
      this.groundLayer = ts;
    } else {
      g.fillStyle(0x3a3128, 1);
      g.fillRect(x0, y0, w, h);
    }
    // Border + inner shade drawn above the ground so the field reads as one panel.
    g.fillStyle(0x000000, 0.16);
    g.fillRect(x0, y0, w, Math.max(3, this.cell * 0.05));
    g.lineStyle(Math.max(2, this.cell * 0.04), 0x1b140d, 0.9);
    g.strokeRect(x0, y0, w, h);
    this.groundGfx = g;
  }

  cellXY(i: number): { x: number; y: number } {
    const gx = i % this.def.gridW;
    const gy = Math.floor(i / this.def.gridW);
    return { x: this.ox + gx * this.cell, y: this.oy + gy * this.cell };
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
    // Smooth fill: ease the drawn level toward the tick's true level. Snap on
    // reduced motion, on a level change and whenever no interpolation is wanted.
    if (this.shownFractions.length !== fractions.length || this.reducedMotion()) {
      this.shownFractions = [...fractions];
      this.waterAnim = false;
    } else {
      this.targetFractions = [...fractions];
      this.waterAnim = true;
    }
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
    this.sprites[i]?.destroy();
    this.sprites[i] = null;
    for (const g of this.gfx) if (g.getData('cell') === i) g.destroy();
    this.gfx = this.gfx.filter((g) => g.getData('cell') !== i);
    const { x, y } = this.cellXY(i);
    const kind = this.kindOf(i);
    const frame = kind === 'empty' ? null : this.frameFor(kind, i);
    if (frame) {
      const img = this.add.image(x + this.cell / 2, y + this.cell / 2, 'plumber', frame);
      img.setDisplaySize(this.cell * 0.96, this.cell * 0.96);
      img.setAngle(kind === 'blocked' ? 0 : (this.rots[i] ?? 0) * 90);
      img.setDepth(1);
      this.sprites[i] = img;
    } else if (kind !== 'empty') {
      const g = this.add.graphics();
      g.setData('cell', i);
      this.drawPrimitive(g, i, x, y);
      this.gfx.push(g);
    }
    this.redrawAll();
  }

  private redrawAll(): void {
    const n = this.def.gridW * this.def.gridH;
    for (let i = 0; i < n; i++) this.drawWater(i);
    this.drawLocks();
  }

  /** Locked cells get an explicit padlock: a clear "not movable" state, not a grey dot. */
  private drawLocks(): void {
    const g = this.lockLayer;
    if (!g) return;
    g.clear();
    const n = this.def.gridW * this.def.gridH;
    for (let i = 0; i < n; i++) {
      if (!this.def.cells[i].locked) continue;
      this.drawLockBadge(g, this.cellXY(i).x, this.cellXY(i).y);
    }
  }

  private drawLockBadge(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const c = this.cell;
    const cx = x + c / 2;
    const cy = y + c * 0.6;
    const s = c * 0.3;
    g.fillStyle(0x0b111c, 0.5);
    g.fillCircle(cx, cy, s * 0.95);
    g.fillStyle(0xf2c230, 1);
    g.fillRoundedRect(cx - s / 2, cy - s * 0.08, s, s * 0.7, s * 0.16);
    g.lineStyle(Math.max(2, s * 0.16), 0xf2c230, 1);
    g.beginPath();
    g.arc(cx, cy - s * 0.08, s * 0.32, Math.PI, 0, false);
    g.strokePath();
    g.fillStyle(0x3a2c00, 1);
    g.fillCircle(cx, cy + s * 0.26, s * 0.11);
  }

  private drawWater(i: number): void {
    const g = this.waterGfx[i];
    if (!g) return;
    g.clear();
    const { x, y } = this.cellXY(i);
    const frac = this.shownFractions[i] ?? this.fractions[i] ?? 0;
    const kind = this.kindOf(i);
    const color = WATER_COLORS[this.colors[i] ?? 'blue'] ?? 0x2fa8de;

    if (i === this.leak && frac <= 0) {
      g.fillStyle(0xe05a4e, 0.9);
      g.fillCircle(x + this.cell / 2, y + this.cell / 2, this.cell * 0.1);
    }

    if (frac > 0) {
      if (kind === 'source' || kind === 'receiver') {
        // Tanks are reservoirs, not pipes. A source is an infinite tank → always full;
        // a receiver fills with what it has actually received.
        this.drawTankWater(g, x, y, color, kind === 'source' ? 1 : frac);
      } else {
        this.drawChannelWater(g, i, x, y, kind, color, frac);
      }
    }

    if (i === this.hint) {
      g.lineStyle(3, 0xf2c230, 1);
      g.strokeRoundedRect(x + 3, y + 3, this.cell - 6, this.cell - 6, 8);
    }
    // §12 colour-independent liquid symbols (same shape per liquid everywhere).
    if (frac > 0 && this.prefs().symbols) this.drawSymbol(g, x + this.cell / 2, y + this.cell / 2, this.colors[i] ?? 'blue');
  }

  /** A white glyph with a dark outline: readable without distinguishing colour. */
  private drawSymbol(g: Phaser.GameObjects.Graphics, cx: number, cy: number, liquid: string): void {
    const r = this.cell * 0.15;
    const lw = Math.max(2, r * 0.5);
    const dark = 0x10202e;
    const poly = (pts: Array<[number, number]>) => () => {
      g.beginPath();
      pts.forEach(([px2, py2], idx) => (idx === 0 ? g.moveTo(px2, py2) : g.lineTo(px2, py2)));
      g.closePath();
    };
    if (liquid === 'red') {
      g.lineStyle(lw, dark, 1);
      g.strokeTriangle(cx, cy - r, cx - r, cy + r * 0.8, cx + r, cy + r * 0.8);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(cx, cy - r, cx - r, cy + r * 0.8, cx + r, cy + r * 0.8);
    } else if (liquid === 'yellow') {
      g.lineStyle(lw, dark, 1);
      g.strokeRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      g.fillStyle(0xffffff, 1);
      g.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
    } else if (liquid === 'green') {
      poly([[cx - r, cy], [cx + r, cy], [cx, cy - r], [cx, cy + r]]);
      g.lineStyle(lw * 1.7, dark, 1);
      g.strokePath();
      g.lineStyle(lw, 0xffffff, 1);
      g.strokePath();
    } else if (liquid === 'purple') {
      poly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]]);
      g.lineStyle(lw, dark, 1);
      g.strokePath();
      g.fillStyle(0xffffff, 1);
      g.fillPath();
    } else {
      g.lineStyle(lw, dark, 1);
      g.strokeCircle(cx, cy, r * 0.9);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(cx, cy, r * 0.9);
    }
  }

  /**
   * Liquid follows the *internal channel* of the pipe, from the inlet side. Because
   * the approved glass tiles are opaque through the bore (proven: pipe_straight
   * centre pixel alpha≈252), the liquid has to be painted *over* the sprite and
   * confined to a band narrower than the tube so the glass walls stay visible → it
   * reads as volume inside the tube, not a line on top of it. Geometry is pure
   * presentation; the fill level comes from the model.
   */
  private drawChannelWater(g: Phaser.GameObjects.Graphics, i: number, x: number, y: number, kind: string, color: number, frac: number): void {
    const rot = this.rots[i] ?? 0;
    const open = kind !== 'valve' || (this.valves[i] ?? true);
    const geo = channelGeometry(kind as never, rot, open);
    if (geo.segments.length === 0) return;
    const filled = fillFrom(geo, this.cameFrom[i] ?? null, frac);
    if (filled.length === 0) return;
    const c = this.cell;
    const width = Math.max(4, geo.halfWidth * 2 * c);
    const w2 = width / 2;
    const light = lighten(color, 0.5);
    const dark = darken(color, 0.45);
    const px = (p: { x: number; y: number }) => ({ x: x + p.x * c, y: y + p.y * c });
    const stroke = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, col: number, alpha: number) => {
      g.lineStyle(w, col, alpha);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
    };
    const pts = filled.map((s) => ({ a: px(s.a), b: px(s.b) }));
    const cap = pts[pts.length - 1].b;
    // A capsule run: stroke every arm, then round the joints and the front cap so
    // the run stays seamless across arms and across neighbouring cells.
    const band = (w: number, col: number, alpha: number) => {
      for (const s of pts) stroke(s.a, s.b, w, col, alpha);
      for (const s of pts) { g.fillStyle(col, alpha); g.fillCircle(s.a.x, s.a.y, w / 2); }
      g.fillStyle(col, alpha);
      g.fillCircle(cap.x, cap.y, w / 2);
    };
    // 1. wet seat: a slightly wider dark rim where the liquid meets the inner glass.
    band(width * 1.22, dark, 0.45);
    // 2. body: the liquid volume — the layer that must be clearly visible.
    band(width, color, 0.94);
    // 3. volume core: a lighter inner mass so it reads as depth, not a flat line.
    band(width * 0.56, light, 0.34);
    if (this.qLevel >= 2) return; // decoration budget exhausted: keep the visible volume.
    // 4. front-glass sheen, offset perpendicular to each arm.
    for (const s of pts) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const off = w2 * 0.34;
      stroke({ x: s.a.x + nx * off, y: s.a.y + ny * off }, { x: s.b.x + nx * off, y: s.b.y + ny * off }, Math.max(1.5, width * 0.16), 0xffffff, 0.3);
    }
    // 5. meniscus at the moving fill front.
    g.fillStyle(light, 0.75);
    g.fillCircle(cap.x, cap.y, w2 * 0.7);
    g.fillStyle(0xffffff, 0.2);
    g.fillCircle(cap.x, cap.y, w2 * 0.3);
  }

  /**
   * Source/receiver are reservoirs, not channels. The approved tank tiles ship with
   * a fixed liquid colour baked in, so repaint the interior as empty glass first,
   * then fill it from the bottom with the *actual* liquid colour and level.
   */
  private drawTankWater(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, frac: number): void {
    const c = this.cell;
    const inset = c * 0.2;
    const wdt = c - inset * 2;
    const bodyH = c - inset * 2;
    const rad = Math.min(12, wdt * 0.2);
    const top = y + inset;
    const bottom = y + c - inset;
    g.fillStyle(0x0e1a2b, 0.62);
    g.fillRoundedRect(x + inset, top, wdt, bodyH, rad);
    const hgt = bodyH * Math.min(1, Math.max(0, frac));
    if (hgt > 0) {
      g.fillStyle(darken(color, 0.35), 0.95);
      g.fillRoundedRect(x + inset + 1, bottom - hgt, wdt - 2, hgt, rad);
      g.fillStyle(color, 0.95);
      g.fillRoundedRect(x + inset + 3, bottom - hgt + 2, wdt - 6, Math.max(0, hgt - 3), rad * 0.8);
      if (this.qLevel < 2 && hgt > 8) {
        g.fillStyle(lighten(color, 0.55), 0.4);
        g.fillRoundedRect(x + inset + wdt * 0.16, bottom - hgt + 4, wdt * 0.26, Math.max(2, hgt - 8), rad * 0.6);
      }
    }
    g.fillStyle(0xffffff, 0.06);
    g.fillRoundedRect(x + inset + 2, top + 2, wdt * 0.5, bodyH - 4, rad * 0.6);
    g.lineStyle(2, 0xffffff, 0.16);
    g.strokeRoundedRect(x + inset, top, wdt, bodyH, rad);
  }

  private kindOf(i: number): string {
    return this.kinds[i] ?? this.def.cells[i].kind;
  }

  /**
   * Procedural tile for cells with no approved art. Semantics are explicit:
   * empty → nothing (free ground), blocked → a real rock/obstacle, source/receiver
   * → a reservoir; pipe kinds only reach here on a broken/absent atlas (their own
   * marker shows then). The old grey circle + red bar for every kind is gone.
   */
  private drawPrimitive(g: Phaser.GameObjects.Graphics, i: number, x: number, y: number): void {
    const kind = this.kindOf(i);
    if (kind === 'empty') return;
    if (kind === 'blocked') {
      this.drawRock(g, i, x, y);
      return;
    }
    if (kind === 'source' || kind === 'receiver') {
      this.drawTankPrimitive(g, x, y);
      return;
    }
    const c = this.cell;
    const cx = x + c / 2;
    const cy = y + c / 2;
    const open = kind !== 'valve' || (this.valves[i] ?? true);
    const body = open ? 0x3e4e61 : 0x2a3442;
    g.fillStyle(body, 1);
    if (kind === 'mixer') g.fillRect(cx - c * 0.28, cy - c * 0.28, c * 0.56, c * 0.56);
    else g.fillCircle(cx, cy, c * 0.3);
    const ports = portsOf({ kind: kind as never, rot: this.rots[i] ?? 0, valveOpen: open }, this.rots[i] ?? 0);
    const stub = c * 0.22;
    const th = c * 0.2;
    if (ports.top) g.fillRect(cx - th / 2, y + 2, th, stub);
    if (ports.bottom) g.fillRect(cx - th / 2, y + c - 2 - stub, th, stub);
    if (ports.left) g.fillRect(x + 2, cy - th / 2, stub, th);
    if (ports.right) g.fillRect(x + c - 2 - stub, cy - th / 2, stub, th);
    if (kind === 'filter') { g.fillStyle(0xf2c230, 1); g.fillRect(cx - th / 2, cy - 2, th, 4); }
    if (kind === 'mixer') { g.fillStyle(0x9a6ee8, 1); g.fillCircle(cx, cy, c * 0.08); }
    if (kind === 'distributor') { g.fillStyle(0xf2c230, 1); g.fillCircle(cx, cy, c * 0.07); }
    if (kind === 'valve' && !open) {
      g.lineStyle(3, 0xe05a4e, 1);
      g.lineBetween(cx - c * 0.2, cy - c * 0.2, cx + c * 0.2, cy + c * 0.2);
    }
    // Missing-art marker only when the whole atlas is absent (dev/diagnostic build).
    if (this.fallback) {
      g.fillStyle(0xca443e, 1);
      g.fillRect(cx - c * 0.16, y + c - 14, c * 0.32, 10);
    }
  }

  /** A faceted boulder cluster — reads as terrain, never as a UI marker. */
  private drawRock(g: Phaser.GameObjects.Graphics, i: number, x: number, y: number): void {
    const c = this.cell;
    const cx = x + c / 2;
    const cy = y + c * 0.58;
    const s = ((i * 2654435761) >>> 0) % 997 / 997; // deterministic 0..1
    const r = c * (0.3 + s * 0.06);
    const poly = (pts: Array<[number, number]>, col: number, a = 1): void => {
      g.fillStyle(col, a);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.closePath();
      g.fillPath();
    };
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(cx, cy + r * 0.75, r * 2.1, r * 0.7);
    poly([
      [cx - r, cy + r * 0.5], [cx - r * 0.8, cy - r * 0.35], [cx - r * 0.1, cy - r * 0.72],
      [cx + r * 0.7, cy - r * 0.3], [cx + r, cy + r * 0.5],
    ], 0x6b6258);
    poly([
      [cx - r * 0.8, cy - r * 0.35], [cx - r * 0.1, cy - r * 0.72], [cx + r * 0.1, cy - r * 0.15], [cx - r * 0.5, cy + r * 0.1],
    ], 0x8a8177);
    g.fillStyle(0x554d45, 1);
    g.fillCircle(cx + r * 0.55, cy + r * 0.4, r * 0.22);
  }

  private drawTankPrimitive(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const c = this.cell;
    const inset = c * 0.2;
    g.fillStyle(0x22364a, 1);
    g.fillRoundedRect(x + inset, y + inset, c - inset * 2, c - inset * 2, c * 0.16);
    g.lineStyle(2, 0x9fc4dd, 0.8);
    g.strokeRoundedRect(x + inset, y + inset, c - inset * 2, c - inset * 2, c * 0.16);
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

  /** Empty cells must be plain ground: any sprite sitting on one is a regression. */
  emptyArtCount(): number {
    const n = this.def.gridW * this.def.gridH;
    let count = 0;
    for (let i = 0; i < n; i++) if (this.sprites[i] && this.kindOf(i) === 'empty') count++;
    return count;
  }

  /** True while a carried-pipe chip is drawn (take→place affordance). */
  carryChipVisible(): boolean {
    return this.carryChip !== null;
  }

  /** True when the white keyboard focus ring is currently drawn. */
  focusRingVisible(): boolean {
    return this.focusKeyboard && this.focus >= 0;
  }

  /** Quarter-turns currently drawn per cell (-1 where a primitive fallback is used). */
  spriteAngles(): number[] {
    return this.sprites.map((s) => (s ? ((Math.round(s.angle / 90) % 4) + 4) % 4 : -1));
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
