// Plumber game orchestrator: DOM chrome, trial driver, persistence, test hooks.
// All rules live in domain/model; this file only wires commands -> scene -> save.
import * as Phaser from 'phaser';
import { AudioEngine } from '../../audio/engine';
import { button, el, toast } from '../../platform/ui/ui';
import type { GameContext, GameHandle } from '../../platform/games/registry';
import { getPlumberSave, type PlumberSessionSave } from '../../platform/storage/save';
import {
  PIPE_CAPACITY,
  applyCommand,
  checksum,
  createRuntime,
  restore,
  snapshot,
  stepTick,
  totalVolume,
  type LevelDefinition,
  type RuntimeState,
} from './domain/model';
import { generateLevel } from './domain/generator';
import { hintFromWitness } from './domain/solver';
import { PLUMBER_ID } from './index';
import { PlumberScene } from './presentation/scene';

const TICK_MS = 200;

function modeForLevel(level: number): 'child' | 'normal' {
  return level <= 2 ? 'child' : 'normal';
}

export class PlumberGame implements GameHandle {
  private ctx!: GameContext;
  private level!: number;
  private root!: HTMLElement;
  private fieldEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private goalEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private startBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private game: Phaser.Game | null = null;
  private scene: PlumberScene | null = null;
  private audio = new AudioEngine();
  private def!: LevelDefinition;
  private state!: RuntimeState;
  private undoStack: Array<ReturnType<typeof snapshot>> = [];
  private timer: number | null = null;
  private disposed = false;
  private hintCell = -1;
  private toastRoot: HTMLElement | null = null;
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onVis = () => this.handleVisibility();
  private cursor = 0;

  private constructor() {}

  static async create(ctx: GameContext, level: number): Promise<PlumberGame> {
    const g = new PlumberGame();
    g.ctx = ctx;
    g.level = level;
    g.buildChrome();
    g.loadOrGenerate();
    g.initPhaser();
    g.exposeTestHook();
    window.addEventListener('keydown', g.onKey);
    document.addEventListener('visibilitychange', g.onVis);
    await g.persist();
    return g;
  }

  private get slot() {
    return getPlumberSave(this.ctx.save);
  }

  private buildChrome(): void {
    const { t } = this.ctx;
    this.root = el('div', 'game plumber-game');
    this.ctx.root.appendChild(this.root);
    const top = el('header', 'topbar');
    const back = button('‹', 'icon-btn', () => this.exitToCatalog(), t('game.back'));
    back.classList.add('back-btn');
    this.titleEl = el('div', 'level-title', '');
    const spacer = el('div', 'top-actions');
    const settings = button('⚙', 'icon-btn', () => window.dispatchEvent(new CustomEvent('mg:open-settings')), t('game.settings'));
    spacer.append(settings);
    top.append(back, this.titleEl, spacer);
    this.goalEl = el('div', 'plumber-goal', '');
    const fieldWrap = el('div', 'field-wrap');
    this.fieldEl = el('div', 'field');
    this.fieldEl.id = 'plumber-field';
    fieldWrap.appendChild(this.fieldEl);
    const bottom = el('nav', 'bottombar');
    this.undoBtn = button('↩', 'action-btn', () => this.onUndo(), t('game.undo'));
    const restartBtn = button('⟳', 'action-btn', () => this.onRestart(), t('game.restart'));
    const hintBtn = button('💡', 'action-btn', () => this.onHint(), t('game.hint'));
    this.startBtn = button('', 'btn primary big', () => this.onStartPause(), t('plumber.start'));
    bottom.append(this.undoBtn, restartBtn, hintBtn, this.startBtn);
    this.bannerEl = el('div', 'plumber-banner');
    this.bannerEl.hidden = true;
    this.root.append(top, this.goalEl, fieldWrap, bottom, this.bannerEl);
    this.toastRoot = el('div', 'toast-root');
    document.body.appendChild(this.toastRoot);
    this.refreshChrome();
  }

  private loadOrGenerate(): void {
    const saved = this.slot.active;
    if (saved && saved.levelNumber === this.level && saved.gridW * saved.gridH === saved.rots.length) {
      const def = this.defFromSave(saved);
      if (def) {
        this.def = def;
        this.state = createRuntime(def);
        restore(this.state, {
          rots: [...saved.rots],
          water: [...saved.water],
          waterColor: [...saved.waterColor],
          sourceLeft: [...saved.sourceLeft],
          receiverGot: [...saved.receiverGot],
          lost: saved.lost,
          tick: saved.tick,
          phase: saved.phase === 'RUNNING' ? 'PAUSED' : saved.phase,
        });
        this.state.log = [];
        this.refreshChrome();
        return;
      }
    }
    this.def = generateLevel(`plumber-lvl-${this.level}`, (this.level * 2654435761) >>> 0, { mode: modeForLevel(this.level) });
    this.state = createRuntime(this.def);
    this.undoStack = [];
    this.refreshChrome();
  }

  private defFromSave(saved: PlumberSessionSave): LevelDefinition | null {
    try {
      const d = saved.def;
      const cells = d.cells.map((c) => ({ kind: c.kind as LevelDefinition['cells'][number]['kind'], rot: c.rot, valveOpen: c.valveOpen, locked: c.locked }));
      const def: LevelDefinition = {
        schemaVersion: 1,
        rulesetVersion: 'plumber-rules/1',
        generatorVersion: 'plumber-gen/0.1-stage1',
        puzzleId: d.puzzleId,
        seed: d.seed,
        mode: d.mode,
        gridW: d.gridW,
        gridH: d.gridH,
        cells,
        sources: d.sources.map((s) => ({ ...s })),
        receivers: d.receivers.map((r) => ({ ...r })),
        solutionWitness: d.solutionWitness.map((c) => (c.type === 'rotate' ? { type: 'rotate' as const, index: c.index ?? 0 } : { type: 'start' as const })),
        difficultyEvidence: { pathLength: 0, rotatable: 0, branches: 0 },
      };
      return def;
    } catch {
      return null;
    }
  }

  private initPhaser(): void {
    const rect = this.fieldEl.getBoundingClientRect();
    const w = Math.max(280, Math.floor(rect.width) || 360);
    const h = Math.max(280, Math.floor(rect.height) || 420);
    try {
      this.game = new Phaser.Game({
        type: Phaser.WEBGL,
        parent: this.fieldEl,
        transparent: true,
        scale: { mode: Phaser.Scale.RESIZE, width: w, height: h },
        scene: [PlumberScene],
        render: { antialias: true },
      });
    } catch {
      toast(this.toastRoot!, this.ctx.t('err.webgl'));
      return;
    }
    this.game.scene.start('plumber', {
      def: this.def,
      refs: { onTapCell: (i: number) => this.onTapCell(i) },
    });
    this.scene = this.game.scene.getScene('plumber') as PlumberScene;
    // First sync after scene creation (scene registers on create via event loop).
    window.setTimeout(() => {
      this.scene = this.game?.scene.getScene('plumber') as PlumberScene;
      this.syncScene(null);
    }, 60);
  }

  // ---------- commands ----------

  private onTapCell(i: number): void {
    if (this.state.phase !== 'PREPARING') return;
    this.cursor = i;
    this.undoStack.push(snapshot(this.state));
    if (this.undoStack.length > 200) this.undoStack.shift();
    if (applyCommand(this.state, { type: 'rotate', index: i })) {
      this.audio.select();
      this.hintCell = -1;
      this.syncScene(i);
      void this.persist();
    } else {
      this.undoStack.pop();
      this.audio.error();
    }
    this.refreshChrome();
  }

  private onUndo(): void {
    if (this.state.phase !== 'PREPARING') return;
    const prev = this.undoStack.pop();
    if (!prev) return;
    restore(this.state, prev);
    this.hintCell = -1;
    this.audio.ui();
    this.syncScene(null);
    this.refreshChrome();
    void this.persist();
  }

  private onRestart(): void {
    applyCommand(this.state, { type: 'restart' });
    this.undoStack = [];
    this.hintCell = -1;
    this.stopTicker();
    this.audio.ui();
    this.syncScene(null);
    this.refreshChrome();
    void this.persist();
  }

  private onHint(): void {
    if (this.state.phase !== 'PREPARING') return;
    const hint = hintFromWitness(this.def, this.state.rots);
    if (hint && hint.type === 'rotate') {
      this.hintCell = hint.index;
      this.audio.reveal();
    } else {
      this.audio.error();
      toast(this.toastRoot!, this.ctx.t('game.noHint'));
    }
    this.syncScene(null);
  }

  private onStartPause(): void {
    const ph = this.state.phase;
    if (ph === 'PREPARING' || ph === 'STOPPED' || ph === 'FAILED') {
      this.bannerEl.hidden = true;
      if (applyCommand(this.state, { type: 'start' })) {
        this.audio.pour(0.4);
        this.startTicker();
      }
    } else if (ph === 'RUNNING') {
      if (applyCommand(this.state, { type: 'pause' })) this.stopTicker();
    } else if (ph === 'PAUSED') {
      if (applyCommand(this.state, { type: 'resume' })) this.startTicker();
    } else if (ph === 'WON') {
      this.nextLevel();
      return;
    }
    this.syncScene(null);
    this.refreshChrome();
    void this.persist();
  }

  private startTicker(): void {
    this.stopTicker();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.disposed || this.state.phase !== 'RUNNING') {
      this.stopTicker();
      return;
    }
    stepTick(this.state);
    this.syncScene(null);
    this.refreshChrome();
    if (this.state.tick % 10 === 0) void this.persist();
    const done: string = this.state.phase;
    if (done === 'WON') this.onWin();
    else if (done === 'FAILED') this.onFailed();
  }

  private onWin(): void {
    this.stopTicker();
    this.audio.win();
    const slot = this.slot;
    if (!slot.completed.includes(this.level)) slot.completed.push(this.level);
    slot.completed.sort((a, b) => a - b);
    slot.maxLevel = Math.max(slot.maxLevel, this.level + 1);
    slot.active = null;
    this.ctx.save.lastPlayed = { gameId: PLUMBER_ID, levelNumber: this.level + 1 };
    this.bannerEl.textContent = this.ctx.t('plumber.won');
    this.bannerEl.hidden = false;
    this.startBtn.textContent = this.ctx.t('plumber.next');
    void this.persist();
    window.dispatchEvent(new CustomEvent('mg:first-win'));
  }

  private onFailed(): void {
    this.stopTicker();
    this.audio.error();
    this.bannerEl.textContent = this.ctx.t('plumber.failed') + (this.state.leakCell !== null ? ` (#${this.state.leakCell})` : '');
    this.bannerEl.hidden = false;
    void this.persist();
  }

  private nextLevel(): void {
    window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: PLUMBER_ID, level: this.level + 1 } }));
  }

  private exitToCatalog(): void {
    window.dispatchEvent(new CustomEvent('mg:exit-catalog'));
  }

  // ---------- view ----------

  private fractions(): number[] {
    const n = this.def.gridW * this.def.gridH;
    const out = new Array<number>(n).fill(0);
    const recvByCell = new Map(this.def.receivers.map((r, i) => [r.cell, i]));
    for (let i = 0; i < n; i++) {
      const ri = recvByCell.get(i);
      if (ri !== undefined) {
        const goal = this.def.receivers[ri].goal;
        out[i] = goal > 0 ? this.state.receiverGot[ri] / goal : 0;
      } else {
        out[i] = this.state.water[i] / PIPE_CAPACITY;
      }
    }
    return out;
  }

  private syncScene(animate: number | null): void {
    if (!this.scene) return;
    this.scene.sync(this.state.rots, this.state.water, this.state.waterColor, this.fractions(), this.state.phase === 'FAILED' ? (this.state.leakCell ?? -1) : -1, this.hintCell, animate);
  }

  private refreshChrome(): void {
    const { t } = this.ctx;
    if (!this.def || !this.state) {
      this.titleEl.textContent = `${t('plumber.name')} · …`;
      return;
    }
    this.titleEl.textContent = `${t('plumber.name')} · ${t('game.level', { level: this.level })}`;
    const r = this.def.receivers[0];
    const got = this.state.receiverGot[0] ?? 0;
    this.goalEl.textContent = r ? t('plumber.goal', { got, goal: r.goal }) : '';
    const ph = this.state.phase;
    if (ph === 'PREPARING' || ph === 'STOPPED' || ph === 'FAILED') this.startBtn.textContent = t('plumber.start');
    else if (ph === 'RUNNING') this.startBtn.textContent = t('plumber.pause');
    else if (ph === 'PAUSED') this.startBtn.textContent = t('plumber.resume');
    else if (ph === 'WON') this.startBtn.textContent = t('plumber.next');
    this.undoBtn.disabled = ph !== 'PREPARING' || this.undoStack.length === 0;
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === ' ') {
      e.preventDefault();
      this.onStartPause();
    } else if (e.key === 'Enter') {
      this.onTapCell(this.cursor);
    }
  }

  private handleVisibility(): void {
    if (document.hidden && this.state.phase === 'RUNNING') {
      applyCommand(this.state, { type: 'pause' });
      this.stopTicker();
      this.refreshChrome();
      void this.persist();
    }
  }

  private async persist(): Promise<void> {
    const slot = this.slot;
    const s = this.state;
    slot.active = {
      levelNumber: this.level,
      puzzleId: this.def.puzzleId,
      seed: this.def.seed,
      mode: this.def.mode,
      gridW: this.def.gridW,
      gridH: this.def.gridH,
      rots: [...s.rots],
      water: [...s.water],
      waterColor: [...s.waterColor],
      sourceLeft: [...s.sourceLeft],
      receiverGot: [...s.receiverGot],
      lost: s.lost,
      tick: s.tick,
      phase: s.phase,
      def: {
        cells: this.def.cells.map((c) => ({ kind: c.kind, rot: c.rot, valveOpen: c.valveOpen, locked: c.locked })),
        sources: this.def.sources.map((x) => ({ ...x })),
        receivers: this.def.receivers.map((x) => ({ ...x })),
        solutionWitness: this.def.solutionWitness.map((c) => (c.type === 'rotate' ? { type: 'rotate', index: c.index } : { type: 'start' })),
        puzzleId: this.def.puzzleId,
        seed: this.def.seed,
        mode: this.def.mode,
        gridW: this.def.gridW,
        gridH: this.def.gridH,
      },
      updatedAt: Date.now(),
    };
    if (!this.ctx.save.lastPlayed || this.ctx.save.lastPlayed.gameId !== PLUMBER_ID) {
      this.ctx.save.lastPlayed = { gameId: PLUMBER_ID, levelNumber: this.level };
    }
    await this.ctx.persist();
  }

  private exposeTestHook(): void {
    (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ = {
      phase: () => this.state.phase,
      level: () => this.level,
      checksum: () => checksum(this.state),
      volumeOk: () => totalVolume(this.state).ok,
      rotate: (i: number) => this.onTapCell(i),
      start: () => this.onStartPause(),
      restart: () => this.onRestart(),
      undo: () => this.onUndo(),
      solve: () => {
        for (const c of this.def.solutionWitness) {
          if (c.type === 'rotate') this.onTapCell(c.index);
        }
        this.onStartPause();
      },
      runToEnd: () => {
        if (this.state.phase === 'PREPARING') this.onStartPause();
        let guard = 0;
        while (this.state.phase === 'RUNNING' && guard++ < 1200) {
          stepTick(this.state);
        }
        this.syncScene(null);
        this.refreshChrome();
        if (this.state.phase === 'WON') this.onWin();
        else if (this.state.phase === 'FAILED') this.onFailed();
        return this.state.phase;
      },
      cellCenter: (i: number) => this.scene?.cellCenter(i) ?? null,
      usesFallback: () => this.scene?.usesFallback() ?? null,
      receiverGot: () => [...this.state.receiverGot],
      water: () => [...this.state.water],
      tick: () => this.state.tick,
      fractions: () => this.fractions(),
    };
  }

  // ---------- lifecycle ----------

  pause(): void {
    if (this.state.phase === 'RUNNING') {
      applyCommand(this.state, { type: 'pause' });
      this.stopTicker();
      this.refreshChrome();
    }
    this.audio.suspend();
  }

  resume(): void {
    this.audio.resume();
  }

  async unmount(): Promise<void> {
    this.disposed = true;
    this.stopTicker();
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    try {
      await this.persist();
    } catch {
      /* ignore */
    }
    try {
      this.game?.destroy(true);
    } catch {
      /* ignore */
    }
    this.game = null;
    this.scene = null;
    this.audio.dispose();
    this.toastRoot?.remove();
    this.root.remove();
    delete (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__;
  }
}
