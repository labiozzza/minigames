// Plumber game orchestrator: DOM chrome, trial driver, persistence, test hooks.
// All rules live in domain/model; this file only wires commands -> scene -> save.
import * as Phaser from 'phaser';
import { AudioEngine } from '../../audio/engine';
import { button, el, modal, toast } from '../../platform/ui/ui';
import type { GameContext, GameHandle } from '../../platform/games/registry';
import { getPlumberSave, type PlumberSave, type PlumberSessionSave } from '../../platform/storage/save';
import {
  PIPE_CAPACITY,
  RULESET_VERSION,
  GENERATOR_VERSION,
  applyCommand,
  checksum,
  createRuntime,
  kindAt,
  restore,
  snapshot,
  stepTick,
  totalVolume,
  type LevelDefinition,
  type PipeKind,
  type PlumberCommand,
  type ProgramCmd,
  type RuntimeState,
} from './domain/model';
import { generateLevel } from './domain/generator';
import { hintFromWitness } from './domain/solver';
import { computeStars, familyForLevel, modeForLevel, parseShareCode, shareCode, unlockedCollectibles, utcDayString, dailyPuzzleId, dailySeed, COLLECTIBLES, type ProgressSummary } from './domain/progression';
import { PLUMBER_ID } from './index';
import { PlumberScene } from './presentation/scene';

const TICK_MS = 200;

// Test/introspection hooks exist only in dev builds or when a test bundle is
// explicitly requested (VITE_TEST_HOOKS=1). Public release builds expose
// neither `__PLUMBER__` nor any solve() shortcut. Replaced at build time.
declare const __TEST_HOOKS__: boolean;
const TEST_HOOKS = __TEST_HOOKS__;

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
  private redoStack: Array<ReturnType<typeof snapshot>> = [];
  private timer: number | null = null;
  private moveMode = false;
  private valveMode = false;
  private moveBtn: HTMLButtonElement | null = null;
  private valveBtn: HTMLButtonElement | null = null;
  private progBar: HTMLElement | null = null;
  private progList: HTMLElement | null = null;
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
    const redoBtn = button('↪', 'action-btn', () => this.onRedo(), t('plumber.redo'));
    const restartBtn = button('⟳', 'action-btn', () => this.onRestart(), t('game.restart'));
    const hintBtn = button('💡', 'action-btn', () => this.onHint(), t('game.hint'));
    const levelsBtn = button('▦', 'action-btn', () => this.openLevels(), t('game.levels'));
    const albumBtn = button('🏆', 'action-btn', () => this.openAlbum(), t('plumber.album'));
    this.moveBtn = button('✋', 'action-btn', () => this.toggleMoveMode(), t('plumber.moveMode'));
    this.valveBtn = button('🔧', 'action-btn', () => this.toggleValveMode(), t('plumber.valveMode'));
    this.startBtn = button('', 'btn primary big', () => this.onStartPause(), t('plumber.start'));
    bottom.append(this.undoBtn, redoBtn, restartBtn, hintBtn, levelsBtn, albumBtn, this.moveBtn, this.valveBtn, this.startBtn);
    this.bannerEl = el('div', 'plumber-banner');
    this.bannerEl.hidden = true;
    this.progBar = el('div', 'plumber-program');
    this.progList = el('div', 'program-list');
    this.progBar.append(this.progList);
    this.root.append(top, this.goalEl, fieldWrap, this.progBar, bottom, this.bannerEl);
    this.toastRoot = el('div', 'toast-root');
    document.body.appendChild(this.toastRoot);
    this.refreshChrome();
  }

  private loadOrGenerate(): void {
    // Shared level handoff (deep link): exact definition, no generation.
    if (PlumberGame.pendingShared) {
      this.def = PlumberGame.pendingShared;
      PlumberGame.pendingShared = null;
      this.sharedLevel = true;
      this.state = createRuntime(this.def);
      this.undoStack = [];
      this.redoStack = [];
      this.refreshChrome();
      return;
    }
    // Daily challenge: identical for everyone (UTC day seed).
    if (PlumberGame.pendingDaily) {
      const day = PlumberGame.pendingDaily;
      PlumberGame.pendingDaily = null;
      this.dailyLevel = { day };
      this.def = generateLevel(dailyPuzzleId(day), dailySeed(day), { mode: 'normal', family: 'path' });
      this.state = createRuntime(this.def);
      this.undoStack = [];
      this.redoStack = [];
      this.refreshChrome();
      return;
    }
    const saved = this.slot.active;
    if (saved && saved.levelNumber === this.level && saved.gridW * saved.gridH === saved.rots.length) {
      const def = this.defFromSave(saved);
      if (def) {
        this.def = def;
        this.state = createRuntime(def);
        restore(this.state, {
          rots: [...saved.rots],
          kinds: (saved.kinds ?? def.cells.map(() => null)) as RuntimeState['kinds'],
          liveConfig: ((saved.liveConfig ?? []) as RuntimeState['liveConfig']),
          water: [...saved.water],
          waterColor: [...saved.waterColor],
          valves: [...(saved.valves ?? def.cells.map(() => true))],
          mixerStock: (saved.mixerStock ?? def.cells.map(() => [])).map((a) => a.map((e) => ({ ...e }))),
          distCount: [...(saved.distCount ?? def.cells.map(() => 0))],
          sourceLeft: [...saved.sourceLeft],
          sourceEnabled: [...(saved.sourceEnabled ?? def.sources.map(() => true))],
          receiverGot: [...saved.receiverGot],
          receivedTotal: [...(saved.receivedTotal ?? saved.receiverGot)],
          fedTotal: saved.fedTotal ?? 0,
          carried: saved.carried ? { kind: saved.carried.kind as PipeKind } : null,
          cameFrom: ((saved.cameFrom ?? []) as Array<string | null>).map((x) => (x === 'top' || x === 'right' || x === 'bottom' || x === 'left' ? x : null)),
          inventoryLeft: [...(saved.inventoryLeft ?? [])] as PipeKind[],
          program: (saved.program ?? []).map((c) => ({ type: c.type, source: c.source, count: c.count, state: c.state, index: c.index }) as RuntimeState['program'][number]),
          programCounter: saved.programCounter ?? 0,
          lost: saved.lost,
          tick: saved.tick,
          idleTicks: saved.idleTicks ?? 0,
          phase: saved.phase === 'RUNNING' ? 'PAUSED' : saved.phase,
          playerRotations: saved.playerRotations ?? 0,
          hintsUsed: saved.hintsUsed ?? 0,
        });
        this.state.log = [];
        this.refreshChrome();
        return;
      }
    }
    this.def = generateLevel(`plumber-lvl-${this.level}`, (this.level * 2654435761) >>> 0, { mode: modeForLevel(this.level), family: familyForLevel(this.level) });
    this.state = createRuntime(this.def);
    this.undoStack = [];
    this.redoStack = [];
    this.refreshChrome();
  }

  private defFromSave(saved: PlumberSessionSave): LevelDefinition | null {
    try {
      const d = saved.def;
      const cells = d.cells.map((c) => ({
        kind: c.kind as LevelDefinition['cells'][number]['kind'],
        rot: c.rot,
        valveOpen: c.valveOpen,
        locked: c.locked,
        outlet: c.outlet as LevelDefinition['cells'][number]['outlet'],
        filterAllow: c.filterAllow ? [...c.filterAllow] : undefined,
        recipeIn: c.recipeIn ? { ...c.recipeIn } : undefined,
        recipeOut: c.recipeOut ? { ...c.recipeOut } : undefined,
        ratio: c.ratio ? ([...c.ratio] as [number, number]) : undefined,
      }));
      const witness: PlumberCommand[] = [];
      for (const c of d.solutionWitness) {
        if (c.type === 'rotate' || c.type === 'toggleValve' || c.type === 'pickup' || c.type === 'place') {
          witness.push({ type: c.type, index: c.index ?? 0 } as PlumberCommand);
        } else if (c.type === 'placeStock') {
          witness.push({ type: 'placeStock', kind: (c.kind ?? 'straight') as PipeKind, index: c.index ?? 0 });
        }
      }
      const def: LevelDefinition = {
        schemaVersion: 1,
        rulesetVersion: RULESET_VERSION,
        generatorVersion: GENERATOR_VERSION,
        puzzleId: d.puzzleId,
        seed: d.seed,
        mode: d.mode,
        family: (d.family ?? 'path') as LevelDefinition['family'],
        gridW: d.gridW,
        gridH: d.gridH,
        cells,
        sources: d.sources.map((s) => ({ cell: s.cell, color: s.color, portions: s.portions, enabled: s.enabled })),
        receivers: d.receivers.map((r) => ({ cell: r.cell, color: r.color, goal: r.goal, kind: (r.kind ?? 'auto') as LevelDefinition['receivers'][number]['kind'], outlet: r.outlet as LevelDefinition['receivers'][number]['outlet'], releaseEvery: r.releaseEvery, bufferCap: r.bufferCap })),
        dynamic: d.dynamic,
        programmed: d.programmed,
        program: (d.program ?? []).map((c) => ({ type: c.type, source: c.source, count: c.count, state: c.state, index: c.index }) as ProgramCmd),
        inventory: (d.inventory ?? []) as PipeKind[],
        solutionWitness: witness,
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
    this.cursor = i;
    const kind = kindAt(this.state, i);
    // Mid-trial valve toggling on dynamic levels.
    if ((this.state.phase === 'RUNNING' || this.state.phase === 'PAUSED') && kind === 'valve' && this.def.dynamic) {
      if (applyCommand(this.state, { type: 'toggleValve', index: i })) {
        this.audio.select();
        this.syncScene(null);
        this.refreshChrome();
        void this.persist();
      } else this.audio.error();
      return;
    }
    if (this.state.phase !== 'PREPARING') return;
    // Move mode: pickup / place instead of rotate.
    if (this.moveMode) {
      this.undoStack.push(snapshot(this.state));
      if (this.undoStack.length > 200) this.undoStack.shift();
      let ok = false;
      if (this.state.carried) ok = applyCommand(this.state, { type: 'place', index: i });
      else {
        ok = applyCommand(this.state, { type: 'pickup', index: i });
        if (!ok && this.state.inventoryLeft.length > 0) {
          ok = applyCommand(this.state, { type: 'placeStock', kind: this.state.inventoryLeft[0], index: i });
        }
      }
      if (ok) {
        this.redoStack = [];
        this.audio.select();
        this.hintCell = -1;
        this.syncScene(null);
        void this.persist();
      } else {
        this.undoStack.pop();
        this.audio.error();
      }
      this.refreshChrome();
      return;
    }
    // Valve mode: taps toggle valves instead of rotating.
    if (this.valveMode && kind === 'valve') {
      this.undoStack.push(snapshot(this.state));
      if (this.undoStack.length > 200) this.undoStack.shift();
      if (applyCommand(this.state, { type: 'toggleValve', index: i })) {
        this.redoStack = [];
        this.audio.select();
        this.syncScene(null);
        void this.persist();
      } else {
        this.undoStack.pop();
        this.audio.error();
      }
      this.refreshChrome();
      return;
    }
    this.undoStack.push(snapshot(this.state));
    if (this.undoStack.length > 200) this.undoStack.shift();
    if (applyCommand(this.state, { type: 'rotate', index: i })) {
      this.redoStack = [];
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

  /** Apply one witness command through the same handlers as player input. */
  private applyWitnessCmd(c: PlumberCommand): void {
    switch (c.type) {
      case 'rotate':
        this.onTapCell(c.index);
        break;
      case 'toggleValve':
      case 'pickup':
      case 'place':
      case 'placeStock':
        this.undoStack.push(snapshot(this.state));
        if (!applyCommand(this.state, c)) this.undoStack.pop();
        else {
          this.redoStack = [];
          this.syncScene(null);
        }
        this.refreshChrome();
        break;
      default:
        break;
    }
  }

  private onUndo(): void {
    if (this.state.phase !== 'PREPARING') return;
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(snapshot(this.state));
    restore(this.state, prev);
    this.hintCell = -1;
    this.audio.ui();
    this.syncScene(null);
    this.refreshChrome();
    void this.persist();
  }

  private onRedo(): void {
    if (this.state.phase !== 'PREPARING') return;
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(snapshot(this.state));
    restore(this.state, next);
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

  private toggleMoveMode(): void {
    this.moveMode = !this.moveMode;
    if (this.moveMode) this.valveMode = false;
    this.audio.ui();
    this.refreshChrome();
  }

  private toggleValveMode(): void {
    this.valveMode = !this.valveMode;
    if (this.valveMode) this.moveMode = false;
    this.audio.ui();
    this.refreshChrome();
  }

  private onHint(): void {
    if (this.state.phase !== 'PREPARING') return;
    applyCommand(this.state, { type: 'markHint' });
    const slot = this.slot;
    slot.stats[this.def.mode].hints += 1;
    const hint = hintFromWitness(this.def, this.state.rots);
    if (hint && hint.type === 'rotate') {
      this.hintCell = hint.index;
      this.audio.reveal();
    } else {
      this.audio.error();
      toast(this.toastRoot!, this.ctx.t('game.noHint'));
    }
    this.syncScene(null);
    void this.persist();
  }

  private onStartPause(): void {
    const ph = this.state.phase;
    if (ph === 'PREPARING' || ph === 'STOPPED' || ph === 'FAILED') {
      this.bannerEl.hidden = true;
      if (this.state.phase === 'PREPARING' && this.state.tick === 0) {
        this.slot.stats[this.def.mode].attempts += 1;
      }
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
    const mode = this.def.mode;
    slot.stats[mode].wins += 1;
    const par = this.def.par ?? this.def.solutionWitness.filter((c) => c.type === 'rotate').length;
    const stars = computeStars(par, this.state.playerRotations, this.state.hintsUsed);
    if (!this.sharedLevel) {
      if (!slot.completed.includes(this.level)) slot.completed.push(this.level);
      slot.completed.sort((a, b) => a - b);
      slot.maxLevel = Math.max(slot.maxLevel, this.level + 1);
      const key = `${mode}:${this.level}`;
      slot.stars[key] = Math.max(slot.stars[key] ?? 0, stars);
      slot.fams[String(this.level)] = { family: this.def.family, mode };
      this.ctx.save.lastPlayed = { gameId: PLUMBER_ID, levelNumber: this.level + 1 };
    }
    if (this.dailyLevel) {
      slot.dailies[this.dailyLevel.day] = Math.max(slot.dailies[this.dailyLevel.day] ?? 0, stars);
    }
    slot.active = null;
    // Collections: check unlocks.
    const summary = this.progressSummary(slot);
    const fresh = unlockedCollectibles(summary, slot.collections);
    if (fresh.length > 0) {
      slot.collections.push(...fresh);
      toast(this.toastRoot!, `${this.ctx.t('plumber.album')} +${fresh.length}`);
    }
    this.ctx.save.lastPlayed = { gameId: PLUMBER_ID, levelNumber: this.level + 1 };
    this.bannerEl.textContent = `${this.ctx.t('plumber.won')} ${'★'.repeat(stars)}`;
    this.bannerEl.hidden = false;
    this.startBtn.textContent = this.ctx.t('plumber.next');
    void this.persist();
    window.dispatchEvent(new CustomEvent('mg:first-win'));
  }

  private progressSummary(slot: PlumberSave): ProgressSummary {
    const wins = slot.completed.length;
    const stars = Object.values(slot.stars).reduce((a, b) => a + b, 0);
    const fams = new Set<string>();
    const modes = new Set<ReturnType<typeof modeForLevel>>();
    for (const e of Object.values(slot.fams)) {
      fams.add(e.family);
      if (e.mode === 'child' || e.mode === 'normal' || e.mode === 'expert') modes.add(e.mode);
    }
    return { wins, stars, familiesWon: [...fams], modesWon: [...modes] };
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

  private dailyLevel: { day: string } | null = null;
  private sharedLevel = false;

  private renderProgram(): void {
    if (!this.progBar || !this.progList) return;
    const show = !!this.def.programmed;
    this.progBar.style.display = show ? '' : 'none';
    if (!show) return;
    const { t } = this.ctx;
    this.progList.innerHTML = '';
    this.progList.append(el('span', 'program-title', t('plumber.program')));
    this.state.program.forEach((cmd, at) => {
      const label = cmd.type === 'feed' ? `💧+${cmd.count}` : cmd.type === 'toggleSource' ? `⛲${cmd.state ? '▶' : '⏸'}` : `🔧${cmd.state ? '○' : '●'}`;
      const chip = button(`${label} ×`, 'chip', () => {
        if (applyCommand(this.state, { type: 'removeProgram', at })) {
          this.audio.ui();
          this.refreshChrome();
          void this.persist();
        }
      }, t('plumber.removeStep'));
      this.progList!.append(chip);
    });
    if (this.state.phase === 'PREPARING') {
      const src = this.def.sources[0] ? 0 : 0;
      const valveIdx = this.def.cells.findIndex((_, i) => kindAt(this.state, i) === 'valve');
      this.progList.append(
        button('+💧', 'chip add', () => this.addProgramStep({ type: 'feed', source: src, count: 3 }), t('plumber.addFeed')),
        button('+⛲', 'chip add', () => this.addProgramStep({ type: 'toggleSource', source: src, state: !this.state.sourceEnabled[src] }), t('plumber.addToggle')),
      );
      if (valveIdx >= 0) {
        this.progList.append(button('+🔧', 'chip add', () => this.addProgramStep({ type: 'switchValve', index: valveIdx, state: !this.state.valves[valveIdx] }), t('plumber.addValve')));
      }
    }
  }

  private addProgramStep(cmd: ProgramCmd): void {
    if (applyCommand(this.state, { type: 'appendProgram', cmd })) {
      this.audio.ui();
      this.refreshChrome();
      void this.persist();
    } else this.audio.error();
  }

  private openLevels(): void {
    const { t } = this.ctx;
    const { box, close } = modal(this.root, 'levels');
    box.append(el('h2', '', t('game.levels')));
    const slot = this.slot;
    const grid = el('div', 'level-grid');
    for (let lv = 1; lv <= slot.maxLevel; lv++) {
      const stars = slot.stars[`${modeForLevel(lv)}:${lv}`] ?? 0;
      const b = button(`${lv}${stars ? ' ' + '★'.repeat(stars) : ''}`, 'level-btn', () => {
        close();
        window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: PLUMBER_ID, level: lv } }));
      }, `${t('game.level', { level: lv })}`);
      if (lv === this.level) b.classList.add('active');
      grid.append(b);
    }
    box.append(grid);
    const row = el('div', 'modal-row');
    const today = utcDayString();
    const dailyDone = slot.dailies[today] ?? 0;
    row.append(
      button(`${t('plumber.daily')}${dailyDone ? ' ★'.repeat(dailyDone) : ''}`, 'btn', () => {
        close();
        PlumberGame.pendingDaily = today;
        const idx = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 86400000);
        window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: PLUMBER_ID, level: 80000 + (idx % 40000) } }));
      }, t('plumber.daily')),
      button(t('plumber.share'), 'btn', () => {
        close();
        this.shareLevel();
      }, t('plumber.share')),
      button(t('plumber.enterCode'), 'btn', () => {
        close();
        this.openShareCode();
      }, t('plumber.enterCode')),
    );
    box.append(row);
  }

  static pendingDaily: string | null = null;
  static pendingShared: LevelDefinition | null = null;

  private openShareCode(): void {
    const { t } = this.ctx;
    const { box, close } = modal(this.root, 'share');
    box.append(el('h2', '', t('plumber.enterCode')));
    const input = document.createElement('input');
    input.placeholder = 'P-N-12';
    input.className = 'share-input';
    box.append(input);
    const row = el('div', 'modal-row');
    row.append(button(t('plumber.open'), 'btn primary', () => {
      const parsed = parseShareCode(input.value);
      close();
      if (!parsed) {
        toast(this.toastRoot!, t('plumber.badCode'));
        return;
      }
      window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: PLUMBER_ID, level: parsed.level } }));
    }, t('plumber.open')));
    box.append(row);
  }

  private shareLevel(): void {
    const { t } = this.ctx;
    const code = shareCode(this.def.mode, this.level);
    const full = {
      schemaVersion: 1, rulesetVersion: RULESET_VERSION, generatorVersion: GENERATOR_VERSION,
      puzzleId: this.def.puzzleId, seed: this.def.seed, mode: this.def.mode, family: this.def.family,
      gridW: this.def.gridW, gridH: this.def.gridH, cells: this.def.cells, sources: this.def.sources,
      receivers: this.def.receivers, dynamic: this.def.dynamic, programmed: this.def.programmed,
      program: this.def.program, inventory: this.def.inventory, solutionWitness: this.def.solutionWitness,
      difficultyEvidence: this.def.difficultyEvidence, par: this.def.par,
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(full)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${location.origin}${location.pathname}#/plumber-share/${b64}`;
    const text = `${t('plumber.shareText')} ${code} ${url}`;
    if (navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => undefined);
    toast(this.toastRoot!, `${code} ✓`);
  }

  private openAlbum(): void {
    const { t } = this.ctx;
    const { box } = modal(this.root, 'album');
    box.append(el('h2', '', t('plumber.album')));
    const slot = this.slot;
    const summary = this.progressSummary(slot);
    const grid = el('div', 'album-grid');
    for (const c of COLLECTIBLES) {
      const owned = slot.collections.includes(c.id);
      const card = el('div', owned ? 'album-card owned' : 'album-card locked');
      const img = document.createElement('img');
      img.src = `assets/plumber/tiles/${c.frame}.png`;
      img.alt = c.id;
      img.loading = 'lazy';
      if (!owned) img.classList.add('silhouette');
      img.onerror = () => {
        img.replaceWith(el('div', 'album-emoji', owned ? '🔧' : '❓'));
      };
      card.append(img, el('div', 'album-name', owned ? c.id : '???'));
      grid.append(card);
    }
    box.append(grid);
    box.append(el('p', 'muted', `${summary.wins} ✓ · ${summary.stars} ★ · ${slot.collections.length}/${COLLECTIBLES.length}`));
    if (slot.collections.length >= COLLECTIBLES.length) {
      box.append(el('div', 'diorama', '🎉🏆🎉'));
    }
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
        out[i] = goal > 0 ? Math.min(1, this.state.receiverGot[ri] / goal) : 0;
      } else if (kindAt(this.state, i) === 'mixer') {
        const stock = this.state.mixerStock[i].reduce((a, e) => a + e.count, 0);
        out[i] = Math.min(1, (this.state.water[i] + stock) / PIPE_CAPACITY);
      } else {
        out[i] = this.state.water[i] / PIPE_CAPACITY;
      }
    }
    return out;
  }

  private syncScene(animate: number | null): void {
    if (!this.scene) return;
    const kinds = this.state.rots.map((_, i) => kindAt(this.state, i));
    this.scene.sync(this.state.rots, this.state.water, this.state.waterColor, this.fractions(), this.state.phase === 'FAILED' ? (this.state.errorCell ?? this.state.leakCell ?? -1) : -1, this.hintCell, animate, kinds, this.state.valves);
  }

  private refreshChrome(): void {
    const { t } = this.ctx;
    if (!this.def || !this.state) {
      this.titleEl.textContent = `${t('plumber.name')} · …`;
      return;
    }
    this.titleEl.textContent = `${t('plumber.name')} · ${t('game.level', { level: this.level })}`;
    const dots: Record<string, string> = { blue: '🔵', red: '🔴', yellow: '🟡', green: '🟢', purple: '🟣' };
    this.goalEl.textContent = this.def.receivers
      .map((r, i) => `${dots[r.color] ?? '⚪'} ${this.state.receiverGot[i] ?? 0}/${r.goal}`)
      .join(' · ');
    const ph = this.state.phase;
    if (ph === 'PREPARING' || ph === 'STOPPED' || ph === 'FAILED') this.startBtn.textContent = t('plumber.start');
    else if (ph === 'RUNNING') this.startBtn.textContent = t('plumber.pause');
    else if (ph === 'PAUSED') this.startBtn.textContent = t('plumber.resume');
    else if (ph === 'WON') this.startBtn.textContent = t('plumber.next');
    this.undoBtn.disabled = ph !== 'PREPARING' || this.undoStack.length === 0;
    if (this.moveBtn) {
      const showMove = this.state.inventoryLeft.length > 0 || this.state.carried !== null || this.hasMovable();
      this.moveBtn.style.display = showMove || this.moveMode ? '' : 'none';
      this.moveBtn.classList.toggle('active', this.moveMode);
    }
    if (this.valveBtn) {
      const hasValve = this.def.cells.some((_, i) => kindAt(this.state, i) === 'valve');
      this.valveBtn.style.display = hasValve || this.valveMode ? '' : 'none';
      this.valveBtn.classList.toggle('active', this.valveMode);
    }
    this.renderProgram();
  }

  private hasMovable(): boolean {
    return this.def.cells.some((c, i) => ['straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor'].includes(kindAt(this.state, i)) && !c.locked);
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
      kinds: s.kinds.map((k) => (k ?? null) as string | null),
      liveConfig: s.liveConfig.map((c) => (c ? JSON.parse(JSON.stringify(c)) : null)),
      water: [...s.water],
      waterColor: [...s.waterColor],
      valves: [...s.valves],
      mixerStock: s.mixerStock.map((a) => a.map((e) => ({ ...e }))),
      distCount: [...s.distCount],
      sourceLeft: [...s.sourceLeft],
      sourceEnabled: [...s.sourceEnabled],
      receiverGot: [...s.receiverGot],
      receivedTotal: [...s.receivedTotal],
      fedTotal: s.fedTotal,
      carried: s.carried ? { kind: s.carried.kind } : null,
      cameFrom: [...s.cameFrom],
      inventoryLeft: [...s.inventoryLeft],
      program: s.program.map((c) => ({ ...c })),
      programCounter: s.programCounter,
      lost: s.lost,
      tick: s.tick,
      idleTicks: s.idleTicks,
      phase: s.phase,
      playerRotations: s.playerRotations,
      hintsUsed: s.hintsUsed,
      def: {
        cells: this.def.cells.map((c) => ({ kind: c.kind, rot: c.rot, valveOpen: c.valveOpen, locked: c.locked, filterAllow: c.filterAllow, recipeIn: c.recipeIn, recipeOut: c.recipeOut, ratio: c.ratio, outlet: c.outlet })),
        sources: this.def.sources.map((x) => ({ ...x })),
        receivers: this.def.receivers.map((x) => ({ ...x })),
        solutionWitness: this.def.solutionWitness.map((c) => JSON.parse(JSON.stringify(c)) as { type: string; index?: number }),
        puzzleId: this.def.puzzleId,
        seed: this.def.seed,
        mode: this.def.mode,
        family: this.def.family,
        gridW: this.def.gridW,
        gridH: this.def.gridH,
        dynamic: this.def.dynamic,
        programmed: this.def.programmed,
        program: (this.def.program ?? []).map((c) => ({ ...c })),
        inventory: this.def.inventory ? [...this.def.inventory] : undefined,
      },
      updatedAt: Date.now(),
    };
    if (!this.ctx.save.lastPlayed || this.ctx.save.lastPlayed.gameId !== PLUMBER_ID) {
      this.ctx.save.lastPlayed = { gameId: PLUMBER_ID, levelNumber: this.level };
    }
    await this.ctx.persist();
  }

  private exposeTestHook(): void {
    if (!TEST_HOOKS) return;
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
        for (const c of this.def.solutionWitness) this.applyWitnessCmd(c);
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
      sceneReady: () => this.scene !== null,
      rotatable: () => this.def.cells.map((c, i) => ({ c, i })).filter(({ c, i }) => ['straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor'].includes(kindAt(this.state, i)) && !c.locked).map(({ i }) => i),
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
    if (TEST_HOOKS) delete (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__;
  }
}
