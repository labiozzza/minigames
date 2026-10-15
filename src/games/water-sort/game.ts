// Water Sort game controller: domain + storage + HTML UI + Phaser view.
// The Phaser scene only renders; every rule lives in domain/.
import * as Phaser from 'phaser';
import {
  attemptPour,
  createSession,
  defaultKnownIds,
  isWin,
  restartSession,
  undoSession,
  type LayerId,
  type SessionState,
} from './domain/model';
import { toPublic } from './domain/mystery';
import { suggestHint } from './solver/hint';
import { findEmptyTarget, findFirstSource, findMatchingTarget, findScoutPour } from './tutorial/logic';
import { TutorialOverlay } from './tutorial/overlay';
import { requestLevel } from './generation/async';
import type { GeneratedPuzzle } from './generation/generator';
import { speedMs } from '../../platform/settings/store';
import { AudioEngine, vibrate } from '../../audio/engine';
import { button, confirmDialog, el, modal, toast } from '../../platform/ui/ui';
import { SortScene, pourAnimTotal, type ViewLayer } from './presentation/scene';
import type { GameContext, GameHandle } from '../../platform/games/registry';
import type { WaterSortSessionSave } from '../../platform/storage/save';

const PAGE = 100;

export class WaterSortGame implements GameHandle {
  private ctx: GameContext;
  private level: number;
  private puzzle!: GeneratedPuzzle;
  private session!: SessionState;
  private hidden = new Set<LayerId>();
  private root!: HTMLElement;
  private fieldEl!: HTMLElement;
  private toastRoot!: HTMLElement;
  private modalRoot!: HTMLElement;
  private titleEl!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private restartBtn!: HTMLButtonElement;
  private hintBtn!: HTMLButtonElement;
  private tut: {
    mode: 'basic' | 'mystery';
    step: number;
    awaiting: 'select' | 'pour' | 'button' | 'card';
    expectTube: number | null;
    expectButton: 'undo' | 'hint' | null;
    expectPour: { from: number; to: number } | null;
    overlay: TutorialOverlay;
    stash: { f: number; t: number } | null;
  } | null = null;
  private onReplayTut = () => this.startBasicTutorial(true);
  private game: Phaser.Game | null = null;
  private scene: SortScene | null = null;
  private audio = new AudioEngine();
  private selected: number | null = null;
  private animating = false;
  /** Pour tapped while another pour is still animating; chained on completion. */
  private queuedPour: { from: number; to: number } | null = null;
  private disposed = false;
  private webglOk = false;
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onVis = () => this.handleVisibility();

  private constructor(ctx: GameContext, level: number) {
    this.ctx = ctx;
    this.level = level;
  }

  static async create(ctx: GameContext, level: number): Promise<WaterSortGame> {
    const g = new WaterSortGame(ctx, level);
    await g.init();
    return g;
  }

  private get ws() {
    return this.ctx.save.games['water-sort'] ?? { maxLevel: 1, completed: [], active: null, tutorialBasic: false, tutorialMystery: false };
  }

  private async init(): Promise<void> {
    const { ctx } = this;
    this.root = el('div', 'game');
    ctx.root.appendChild(this.root);
    this.buildChrome();
    // Restore active session or generate fresh.
    const active = this.ws.active;
    if (active && active.levelNumber === this.level && active.tubes.length > 0) {
      this.puzzle = {
        levelNumber: active.levelNumber,
        seed: active.seed,
        attempt: active.attempt,
        generatorVersion: active.generatorVersion,
        balanceVersion: active.balanceVersion,
        colors: active.colors,
        tubes: active.tubes.map((t) => ({ id: t.id, layers: t.layers.map((l) => ({ ...l })) })),
        solution: [],
        hiddenLayerIds: active.hidden,
        checksum: active.checksum,
      };
      this.hidden = new Set(active.hidden);
      this.session = createSession(
        this.puzzle.tubes,
        new Set(active.known),
      );
      // Replay history onto restored base? Stored tubes are already current.
      this.session.history = active.history.map((h) => ({ ...h }));
    } else {
      this.showLoading();
      try {
        this.puzzle = await requestLevel(this.level);
      } catch {
        this.showFatal();
        throw new Error('level failed');
      }
      this.hideLoading();
      this.hidden = new Set(this.puzzle.hiddenLayerIds);
      const freshReplay = active !== null && active !== undefined && this.ws.completed.includes(this.level);
      void freshReplay;
      this.session = createSession(
        this.puzzle.tubes,
        defaultKnownIds(this.puzzle.tubes, this.hidden),
      );
    }
    this.initPhaser();
    this.exposeTestHook();
    if (this.webglOk) {
      this.refreshChrome();
      this.attachGlobal();
      // The tutorial starts on scene ready (Phaser creates objects async).
      if (this.sceneReady) this.maybeTutorial();
      this.startAudio();
      // Static DEV check first so bundlers drop this branch (and the module) in production.
      if (import.meta.env.DEV && ctx.dev) {
        void import('./dev/panel').then((m) => {
          if (!this.disposed) m.attachDevPanel(this.root, this.devApi());
        });
      }
    }
    await this.persist();
  }

  // ---------- DOM chrome ----------

  private loadingEl: HTMLElement | null = null;
  private showLoading(): void {
    this.loadingEl = el('div', 'loading', '…');
    this.root.appendChild(this.loadingEl);
  }
  private hideLoading(): void {
    this.loadingEl?.remove();
    this.loadingEl = null;
  }

  private buildChrome(): void {
    const { t } = this.ctx;
    const top = el('header', 'topbar');
    const back = button('‹', 'icon-btn', () => void this.exitToCatalog(), t('game.back'));
    back.classList.add('back-btn');
    const backLabel = el('span', 'back-label', t('game.back'));
    const backWrap = el('div', 'back-wrap');
    backWrap.append(back, backLabel);
    this.titleEl = el('div', 'level-title', '');
    const spacer = el('div', 'top-actions');
    const levels = button('▦', 'icon-btn', () => this.openLevels(), t('game.levels'));
    const settings = button('⚙', 'icon-btn', () => window.dispatchEvent(new CustomEvent('mg:open-settings')), t('game.settings'));
    spacer.append(levels, settings);
    top.append(backWrap, this.titleEl, spacer);

    const fieldWrap = el('div', 'field-wrap');
    this.fieldEl = el('div', 'field');
    this.fieldEl.id = 'ws-field';
    fieldWrap.appendChild(this.fieldEl);

    const bottom = el('nav', 'bottombar');
    this.undoBtn = button('↩', 'action-btn', () => void this.onUndo(), t('game.undo'));
    this.restartBtn = button('⟳', 'action-btn', () => void this.onRestart(), t('game.restart'));
    this.hintBtn = button('💡', 'action-btn', () => void this.onHint(), t('game.hint'));
    bottom.append(this.undoBtn, this.restartBtn, this.hintBtn);

    this.toastRoot = el('div', 'toast-root');
    this.modalRoot = el('div', 'modal-root');
    this.root.append(top, fieldWrap, bottom, this.toastRoot, this.modalRoot);
  }

  private refreshChrome(): void {
    this.titleEl.textContent = this.ctx.t('game.level', { level: this.level });
    this.undoBtn.disabled = this.session.history.length === 0 || this.animating;
  }

  // ---------- Phaser ----------

  private initPhaser(): void {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) {
        this.showFatal();
        return;
      }
    } catch {
      this.showFatal();
      return;
    }
    try {
      this.scene = new SortScene({
        tubes: () => this.viewTubes(),
        theme: () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
        symbols: () => this.ctx.settings.symbols,
        onTap: (i) => void this.onTap(i),
        canvasBox: () => {
          const c = this.fieldEl.querySelector('canvas');
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        },
        onReady: () => this.handleSceneReady(),
        onRelayout: () => this.refreshTutPointer(),
      });
      const w = Math.max(200, this.fieldEl.clientWidth || window.innerWidth);
      const h = Math.max(300, this.fieldEl.clientHeight || window.innerHeight - 220);
      this.game = new Phaser.Game({
        type: Phaser.WEBGL,
        parent: this.fieldEl,
        transparent: true,
        disableContextMenu: true,
        scale: { mode: Phaser.Scale.RESIZE, width: w, height: h },
        scene: [this.scene],
      });
      this.webglOk = true;
    } catch {
      this.showFatal();
    }
  }

  private showFatal(): void {
    this.hideLoading();
    this.fieldEl.innerHTML = '';
    const box = el('div', 'fatal');
    box.append(el('h2', '', this.ctx.t('err.webgl')), el('p', '', this.ctx.t('err.webglHint')));
    const row = el('div', 'modal-row');
    row.append(
      button(this.ctx.t('common.toCatalog'), 'btn primary', () => this.exitToCatalog(), this.ctx.t('common.toCatalog')),
      button(this.ctx.t('err.retry'), 'btn', () => window.location.reload(), this.ctx.t('err.retry')),
    );
    box.appendChild(row);
    this.fieldEl.appendChild(box);
  }

  private viewTubes(): ViewLayer[][] {
    return this.session.tubes.map((t) =>
      t.layers.map((l) => ({ id: l.id, color: l.color, hidden: !this.session.known.has(l.id) })),
    );
  }

  // ---------- Input & rules ----------

  /** Phaser listens for pointer events globally, so clicks on modal dialogs
   * placed above a tube zone must not act as game input. The interactive
   * tutorial (.tutorial) intentionally stays playable. */
  private modalOpen(): boolean {
    return document.querySelector('.modal-overlay') !== null;
  }

  private async onTap(i: number): Promise<void> {
    if (this.disposed || !this.webglOk || this.modalOpen()) return;
    if (this.tut && (this.tut.awaiting === 'select' || this.tut.awaiting === 'pour')) {
      // Scripted tutorial: the animation must finish first so each step
      // stays observable; wrong taps still get feedback as before.
      if (this.tut.expectTube !== i) {
        this.wrongTap(i);
        return;
      }
      if (this.animating) return;
    } else if (this.animating) {
      // Free play: taps during a pour are not swallowed — selection applies
      // immediately against the already-updated session, a second tap queues
      // the next pour and chains automatically when the flight finishes.
      this.tapDuringAnimation(i);
      return;
    }
    this.audio.unlock();
    if (this.selected === null) {
      if (this.session.tubes[i].layers.length === 0) return;
      this.selected = i;
      this.scene?.setSelected(i);
      this.audio.select();
      if (this.tut && this.tut.awaiting === 'select') this.advanceTutorial();
      return;
    }
    if (this.selected === i) {
      this.selected = null;
      this.scene?.setSelected(null);
      this.audio.ui();
      return;
    }
    const from = this.selected;
    await this.tryPour(from, i);
  }

  /**
   * Free-play tap while a pour is animating. The session is already updated
   * synchronously at pour start, so selection can apply immediately; a
   * complete from→to pair is queued and chained when the flight finishes.
   */
  private tapDuringAnimation(i: number): void {
    this.audio.unlock();
    if (this.selected === null) {
      if (this.session.tubes[i].layers.length === 0) return;
      this.selected = i;
      this.scene?.setSelected(i);
      this.audio.select();
      return;
    }
    if (this.selected === i) {
      this.selected = null;
      this.scene?.setSelected(null);
      this.queuedPour = null;
      this.audio.ui();
      return;
    }
    this.queuedPour = { from: this.selected, to: i };
    this.audio.select();
  }

  private snapshotView(): ViewLayer[][] {
    return this.viewTubes();
  }

  private async tryPour(from: number, to: number): Promise<void> {
    const before = this.snapshotView();
    const res = attemptPour(this.session, from, to);
    this.selected = null;
    this.scene?.setSelected(null);
    if (!res.ok) {
      this.scene?.shake(from);
      this.audio.error();
      if (this.ctx.settings.vibration) vibrate(30);
      return;
    }
    this.clearHint();
    this.animating = true;
    this.refreshChrome();
    const dur = speedMs(this.ctx.settings).pour;
    this.audio.pour(pourAnimTotal(res.move.count, dur) / 1000);
    if (this.ctx.settings.vibration) vibrate(12);
    const fromBefore = before[from];
    const toBefore = before[to];
    await new Promise<void>((resolve) => {
      this.scene?.animatePour(from, to, fromBefore, toBefore, res.move.count, dur, () => resolve());
    });
    this.animating = false;
    if (res.revealed.length > 0) {
      this.audio.reveal();
      this.scene?.flashReveal(to, () => undefined);
    }
    this.updateCompleted();
    await this.persist();
    this.refreshChrome();
    if (this.tut && this.tut.awaiting === 'pour' && this.tut.expectPour &&
      this.tut.expectPour.from === from && this.tut.expectPour.to === to) {
      this.advanceTutorial();
    }
    this.checkWin();
    // Chain a pour tapped mid-flight (dropped when the win modal is up).
    const qp = this.queuedPour;
    this.queuedPour = null;
    if (qp && !this.disposed && !this.modalOpen()) await this.tryPour(qp.from, qp.to);
  }

  private updateCompleted(): void {
    const flags = this.session.tubes.map(
      (t) => t.layers.length === 4 && t.layers.every((l) => l.color === t.layers[0].color),
    );
    const hadNew = flags.some((f, i) => f && !this.wasComplete[i]);
    this.wasComplete = flags;
    this.scene?.setCompleted(flags);
    if (hadNew) this.audio.complete();
  }
  private wasComplete: boolean[] = [];

  private async onUndo(): Promise<void> {
    if (this.animating || this.disposed) return;
    if (this.tut && this.tut.awaiting === 'button') {
      if (this.tut.expectButton !== 'undo') {
        this.tut.overlay.pulse();
        return;
      }
    }
    if (!undoSession(this.session)) return;
    this.queuedPour = null;
    this.clearHint();
    this.audio.ui();
    this.scene?.render();
    this.updateCompletedQuiet();
    await this.persist();
    this.refreshChrome();
    if (this.tut && this.tut.awaiting === 'button' && this.tut.expectButton === 'undo') {
      this.advanceTutorial();
    }
  }

  private updateCompletedQuiet(): void {
    this.wasComplete = this.session.tubes.map(
      (t) => t.layers.length === 4 && t.layers.every((l) => l.color === t.layers[0].color),
    );
    this.scene?.setCompleted(this.wasComplete);
  }

  private async onRestart(): Promise<void> {
    if (this.animating || this.disposed) return;
    if (this.session.history.length > 0) {
      const ok = await confirmDialog(
        this.modalRoot,
        this.ctx.t('game.confirmRestart'),
        this.ctx.t('game.confirm'),
        this.ctx.t('game.cancel'),
      );
      if (!ok) return;
    }
    restartSession(this.session);
    this.queuedPour = null;
    this.clearHint();
    this.audio.ui();
    this.scene?.render();
    this.updateCompletedQuiet();
    await this.persist();
    this.refreshChrome();
  }

  private async onHint(): Promise<void> {
    if (this.animating || this.disposed) return;
    if (this.tut && this.tut.awaiting === 'button') {
      if (this.tut.expectButton !== 'hint') {
        this.tut.overlay.pulse();
        return;
      }
    }
    this.audio.unlock();
    const pub = toPublic(this.session.tubes, this.session.known);
    let hint = null;
    try {
      hint = suggestHint(pub, 120000);
    } catch {
      hint = null;
    }
    if (!hint) {
      toast(this.toastRoot, this.ctx.t('game.noHint'));
      this.audio.error();
      return;
    }
    this.scene?.setHint(hint.from, hint.to);
    this.audio.select();
    toast(
      this.toastRoot,
      `${this.ctx.t(hint.kind === 'hint' ? 'game.hintLabel' : 'game.scoutLabel')}: ${hint.from + 1} → ${hint.to + 1}`,
    );
    if (this.tut && this.tut.awaiting === 'button' && this.tut.expectButton === 'hint') {
      this.advanceTutorial();
    }
  }

  private clearHint(): void {
    this.scene?.setHint(null, null);
  }

  private checkWin(): void {
    if (!isWin(this.session.tubes)) return;
    this.audio.win();
    if (this.ctx.settings.vibration) vibrate([40, 60, 40]);
    const done = () => this.showWin();
    if (speedMs(this.ctx.settings).pour > 40) this.scene?.celebrate(done);
    else done();
  }

  private showWin(): void {
    if (this.disposed) return;
    const ws = this.ws;
    const firstWinEver = ws.completed.length === 0;
    if (!ws.completed.includes(this.level)) ws.completed.push(this.level);
    ws.completed.sort((a, b) => a - b);
    ws.maxLevel = Math.max(ws.maxLevel, this.level + 1);
    ws.active = null;
    this.ctx.save.lastPlayed = { gameId: 'water-sort', levelNumber: this.level };
    void this.persist();
    this.ctx.onProgress();
    if (firstWinEver) window.dispatchEvent(new CustomEvent('mg:first-win'));

    const { box, close } = modal(this.modalRoot, 'win');
    box.append(el('h2', '', this.ctx.t('win.title')));
    box.append(el('p', 'modal-text', this.ctx.t('win.level', { level: this.level })));
    const row = el('div', 'modal-row');
    row.append(
      button(this.ctx.t('win.next'), 'btn primary', () => {
        close();
        this.playLevel(this.level + 1);
      }, this.ctx.t('win.next')),
      button(this.ctx.t('win.replay'), 'btn', () => {
        close();
        this.playLevel(this.level, true);
      }, this.ctx.t('win.replay')),
      button(this.ctx.t('win.catalog'), 'btn', () => {
        close();
        this.exitToCatalog();
      }, this.ctx.t('win.catalog')),
    );
    box.appendChild(row);
  }

  // ---------- Levels ----------

  private openLevels(): void {
    const ws = this.ws;
    let page = Math.floor((this.level - 1) / PAGE);
    const { box, close } = modal(this.modalRoot, 'levels');
    const render = () => {
      box.innerHTML = '';
      box.append(el('h2', '', this.ctx.t('levels.title')));
      const grid = el('div', 'level-grid');
      const start = page * PAGE + 1;
      const end = start + PAGE - 1;
      for (let n = start; n <= end; n++) {
        const done = ws.completed.includes(n);
        const locked = n > ws.maxLevel;
        const b = el('button', `level-cell${done ? ' done' : ''}${n === this.level ? ' current' : ''}${locked ? ' locked' : ''}`, String(n));
        b.type = 'button';
        b.disabled = locked;
        b.setAttribute('aria-label', `${n} ${this.ctx.t(done ? 'levels.done' : locked ? 'levels.locked' : 'levels.current')}`);
        if (!locked) {
          b.addEventListener('click', () => {
            close();
            this.playLevel(n, done);
          });
        }
        grid.appendChild(b);
      }
      box.appendChild(grid);
      const nav = el('div', 'modal-row');
      const prev = button('‹', 'btn', () => {
        if (page > 0) {
          page--;
          render();
        }
      }, 'prev');
      prev.disabled = page === 0;
      nav.append(
        prev,
        el('span', 'page-label', this.ctx.t('levels.page', { a: start, b: end })),
        button('›', 'btn', () => {
          page++;
          render();
        }, 'next'),
      );
      box.appendChild(nav);
    };
    render();
  }

  private async playLevel(n: number, replay = false): Promise<void> {
    void replay;
    if (n === this.level) return;
    // A finished (won) level needs no loss confirmation.
    if (this.session.history.length > 0 && !isWin(this.session.tubes)) {
      const ok = await confirmDialog(
        this.modalRoot,
        this.ctx.t('game.confirmLeave'),
        this.ctx.t('game.confirm'),
        this.ctx.t('game.cancel'),
      );
      if (!ok) return;
    }
    window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'water-sort', level: n } }));
  }

  private exitToCatalog(): void {
    window.dispatchEvent(new CustomEvent('mg:exit-catalog'));
  }

  // ---------- Interactive tutorials ----------
  // Action-first: the player performs real moves on highlighted tubes.
  // Input outside the expected target is gently blocked (no state change).

  private sceneReady = false;

  private handleSceneReady(): void {
    this.sceneReady = true;
    if (!this.tut) this.maybeTutorial();
    else this.refreshTutPointer();
  }

  /** Re-point the tutorial ring after relayouts (positions changed). */
  private refreshTutPointer(): void {
    const tut = this.tut;
    if (!tut) return;
    if (tut.expectTube !== null && (tut.awaiting === 'select' || tut.awaiting === 'pour')) {
      this.pointTube(tut.expectTube, tut.awaiting === 'select' ? 'up' : 'down');
    } else if (tut.awaiting === 'button') {
      if (tut.expectButton === 'undo') this.pointEl(this.undoBtn);
      else if (tut.expectButton === 'hint') this.pointEl(this.hintBtn);
    }
  }

  private maybeTutorial(): void {
    const ws = this.ws;
    if (this.level === 1 && !ws.tutorialBasic) {
      this.startBasicTutorial(false);
    } else if (this.level >= 101 && this.hidden.size > 0 && !ws.tutorialMystery) {
      this.startMysteryTutorial();
    }
  }

  private wrongTap(i: number): void {
    this.scene?.shake(i);
    this.audio.error();
    this.tut?.overlay.pulse();
  }

  private tubePoint(i: number): { x: number; y: number } | null {
    const c = this.scene?.tubeClientPos(i);
    if (!c) return null;
    const r = this.root.getBoundingClientRect();
    return { x: c.x - r.left, y: c.y - r.top };
  }

  private elPoint(elm: HTMLElement): { x: number; y: number } {
    const b = elm.getBoundingClientRect();
    const r = this.root.getBoundingClientRect();
    return { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 };
  }

  private pubNow() {
    return toPublic(this.session.tubes, this.session.known);
  }

  private tutCardSkip(): void {
    if (!this.tut) return;
    this.tut.overlay.setActions([
      {
        label: this.ctx.t('tutorial.skip'),
        primary: false,
        onClick: () => this.finishTutorial(),
        aria: this.ctx.t('tutorial.skip'),
      },
    ]);
  }

  private startBasicTutorial(manual: boolean): void {
    if (this.tut || !this.webglOk) return;
    if (!manual && this.session.history.length > 0) return;
    const overlay = new TutorialOverlay(this.root);
    this.tut = {
      mode: 'basic', step: 0, awaiting: 'select', expectTube: null,
      expectButton: null, expectPour: null, overlay, stash: null,
    };
    this.tutCardSkip();
    this.basicStep();
  }

  private basicStep(): void {
    const tut = this.tut;
    if (!tut) return;
    const t = this.ctx.t.bind(this.ctx);
    const pub = this.pubNow();
    switch (tut.step) {
      case 0: {
        const src = findFirstSource(pub);
        if (src === null) {
          this.finishTutorial();
          return;
        }
        tut.awaiting = 'select';
        tut.expectTube = src;
        tut.stash = null;
        this.pointTube(src, 'up');
        tut.overlay.setText(t('tut.tapSrc'));
        break;
      }
      case 1: {
        const from = tut.expectTube ?? 0;
        const dst = findMatchingTarget(pub, from) ?? findEmptyTarget(pub, from);
        if (dst === null) {
          this.finishTutorial();
          return;
        }
        tut.awaiting = 'pour';
        tut.expectTube = dst;
        tut.expectPour = { from, to: dst };
        this.pointTube(dst, 'down');
        tut.overlay.setText(t('tut.tapDst'));
        break;
      }
      case 2: {
        const src = findFirstSource(pub);
        if (src === null) {
          this.finishTutorial();
          return;
        }
        tut.awaiting = 'select';
        tut.expectTube = src;
        tut.expectPour = null;
        tut.stash = null;
        this.pointTube(src, 'up');
        tut.overlay.setText(t('tut.tapSrc'));
        break;
      }
      case 3: {
        const from = tut.expectTube ?? 0;
        const dst = findEmptyTarget(pub, from) ?? findMatchingTarget(pub, from);
        if (dst === null) {
          tut.step = 4;
          this.basicStep();
          return;
        }
        tut.awaiting = 'pour';
        tut.expectTube = dst;
        tut.expectPour = { from, to: dst };
        this.pointTube(dst, 'down');
        tut.overlay.setText(t('tut.tapDst'));
        break;
      }
      case 4: {
        tut.awaiting = 'button';
        tut.expectTube = null;
        tut.expectPour = null;
        tut.expectButton = 'undo';
        this.pointEl(this.undoBtn);
        tut.overlay.setText(t('tut.undo'));
        break;
      }
      case 5: {
        tut.awaiting = 'button';
        tut.expectButton = 'hint';
        this.pointEl(this.hintBtn);
        tut.overlay.setText(t('tut.hint'));
        break;
      }
      case 6: {
        tut.awaiting = 'card';
        tut.expectButton = null;
        this.pointEl(this.restartBtn);
        tut.overlay.setText(t('tut.restart'));
        tut.overlay.setActions([
          {
            label: t('tut.ok'), primary: true,
            onClick: () => this.advanceTutorial(),
            aria: t('tut.ok'),
          },
        ]);
        break;
      }
      default: {
        tut.awaiting = 'card';
        tut.overlay.hidePointer();
        tut.overlay.setText(t('tut.done'));
        tut.overlay.setActions([
          {
            label: t('tut.ok'), primary: true,
            onClick: () => this.finishTutorial(),
            aria: t('tut.ok'),
          },
        ]);
        break;
      }
    }
  }

  private startMysteryTutorial(): void {
    if (this.tut || !this.webglOk) return;
    const scout = findScoutPour(this.pubNow());
    const overlay = new TutorialOverlay(this.root);
    this.tut = {
      mode: 'mystery', step: 0, awaiting: 'select', expectTube: null,
      expectButton: null, expectPour: null, overlay, stash: scout,
    };
    this.tutCardSkip();
    if (!scout) {
      // No revealing move available right now: short info cards instead.
      this.mysteryInfoFallback();
      return;
    }
    this.mysteryStep();
  }

  private mysteryInfoFallback(): void {
    const tut = this.tut;
    if (!tut) return;
    const t = this.ctx.t.bind(this.ctx);
    tut.awaiting = 'card';
    tut.overlay.hidePointer();
    tut.overlay.setText(t('tut.mysteryScout'));
    tut.overlay.setActions([
      { label: t('tut.ok'), primary: true, onClick: () => this.finishTutorial(), aria: t('tut.ok') },
    ]);
  }

  private mysteryStep(): void {
    const tut = this.tut;
    if (!tut) return;
    const t = this.ctx.t.bind(this.ctx);
    switch (tut.step) {
      case 0: {
        const scout = tut.stash ?? findScoutPour(this.pubNow());
        if (!scout) {
          this.mysteryInfoFallback();
          return;
        }
        tut.stash = scout;
        tut.awaiting = 'select';
        tut.expectTube = scout.f;
        this.pointTube(scout.f, 'up');
        tut.overlay.setText(t('tut.mysteryScout'));
        break;
      }
      case 1: {
        const scout = tut.stash;
        if (!scout) {
          this.finishTutorial();
          return;
        }
        tut.awaiting = 'pour';
        tut.expectTube = scout.t;
        tut.expectPour = { from: scout.f, to: scout.t };
        this.pointTube(scout.t, 'down');
        tut.overlay.setText(t('tut.mysteryScout'));
        break;
      }
      case 2: {
        tut.awaiting = 'card';
        tut.expectTube = null;
        tut.expectPour = null;
        const dst = tut.stash?.t;
        if (dst !== undefined && dst !== null) {
          this.pointTube(dst, 'none');
          this.scene?.flashReveal(dst, () => undefined);
        } else {
          tut.overlay.hidePointer();
        }
        tut.overlay.setText(t('tut.mysteryKept'));
        tut.overlay.setActions([
          { label: t('tut.ok'), primary: true, onClick: () => this.advanceTutorial(), aria: t('tut.ok') },
        ]);
        break;
      }
      case 3: {
        tut.awaiting = 'button';
        tut.expectButton = 'undo';
        this.pointEl(this.undoBtn);
        tut.overlay.setText(t('tut.mysteryUndo'));
        break;
      }
      default: {
        tut.awaiting = 'card';
        tut.overlay.hidePointer();
        tut.overlay.setText(t('tut.done'));
        tut.overlay.setActions([
          { label: t('tut.ok'), primary: true, onClick: () => this.finishTutorial(), aria: t('tut.ok') },
        ]);
        break;
      }
    }
  }

  private pointTube(i: number, hand: 'up' | 'down' | 'none'): void {
    const tut = this.tut;
    if (!tut) return;
    tut.overlay.setCardTop(false);
    const p = this.tubePoint(i);
    if (!p) {
      tut.overlay.hidePointer();
      return;
    }
    tut.overlay.pointAt(p.x, p.y, hand);
  }

  private pointEl(elm: HTMLElement): void {
    if (!this.tut) return;
    this.tut.overlay.setCardTop(true);
    const p = this.elPoint(elm);
    this.tut.overlay.pointAt(p.x, p.y, 'none');
  }

  private advanceTutorial(): void {
    const tut = this.tut;
    if (!tut) return;
    tut.step++;
    tut.expectButton = null;
    if (tut.mode === 'basic') this.basicStep();
    else this.mysteryStep();
    // Action steps offer Skip; info steps override actions themselves.
    if (tut.awaiting !== 'card') this.tutCardSkip();
  }

  private finishTutorial(): void {
    const tut = this.tut;
    if (!tut) return;
    const ws = this.ws;
    if (tut.mode === 'basic') ws.tutorialBasic = true;
    else ws.tutorialMystery = true;
    this.tut = null;
    tut.overlay.destroy();
    this.scene?.render();
    void this.persist();
  }

  // ---------- Persistence ----------

  private async persist(): Promise<void> {
    if (this.disposed || !this.puzzle) return;
    const active: WaterSortSessionSave = {
      levelNumber: this.level,
      tubes: this.session.tubes.map((t) => ({ id: t.id, layers: t.layers.map((l) => ({ ...l })) })),
      known: [...this.session.known],
      history: this.session.history.map((h) => ({ ...h })),
      seed: this.puzzle.seed,
      attempt: this.puzzle.attempt,
      generatorVersion: this.puzzle.generatorVersion,
      balanceVersion: this.puzzle.balanceVersion,
      colors: this.puzzle.colors.slice(),
      hidden: [...this.hidden],
      checksum: this.puzzle.checksum,
      updatedAt: Date.now(),
    };
    this.ws.active = active;
    this.ctx.save.lastPlayed = { gameId: 'water-sort', levelNumber: this.level };
    try {
      await this.ctx.persist();
    } catch {
      toast(this.toastRoot, 'storage-quota');
    }
  }

  // ---------- Lifecycle ----------

  private attachGlobal(): void {
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('mg:replay-tutorial', this.onReplayTut);
  }

  private handleKey(e: KeyboardEvent): void {
    // Taps are routed to onTap even mid-animation: free-play taps queue the
    // next pour instead of being swallowed (see tapDuringAnimation).
    if (this.disposed || this.modalOpen()) return;
    if (e.key === 'Escape') {
      this.selected = null;
      this.scene?.setSelected(null);
      return;
    }
    const map: Record<string, number> = {
      '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8, '0': 9,
      q: 10, w: 11, e: 12, r: 13,
    };
    const idx = map[e.key.toLowerCase()];
    if (idx !== undefined && idx < this.session.tubes.length) void this.onTap(idx);
  }

  private handleVisibility(): void {
    if (document.hidden) {
      this.pause();
      void this.persist();
    } else {
      this.resume();
    }
  }

  private startAudio(): void {
    this.audio.setVolumes(this.ctx.settings.musicVolume, this.ctx.settings.sfxVolume);
    const begin = () => {
      this.audio.unlock();
      if (this.ctx.settings.music) this.audio.startMusic();
    };
    if (this.ctx.settings.music) {
      begin();
      this.fieldEl.addEventListener('pointerdown', begin, { once: true });
    }
  }

  pause(): void {
    this.scene?.scene.pause();
    this.audio.suspend();
    if (this.ctx.settings.music) this.audio.stopMusic();
  }

  resume(): void {
    if (this.disposed) return;
    this.audio.resume();
    try {
      this.scene?.scene.resume();
    } catch { /* already resumed */ }
    if (this.ctx.settings.music && !this.audio.playing) this.audio.startMusic();
  }

  async unmount(): Promise<void> {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('mg:replay-tutorial', this.onReplayTut);
    this.tut?.overlay.destroy();
    this.tut = null;
    try {
      await this.persist();
    } catch { /* best effort */ }
    this.audio.stopMusic();
    this.audio.dispose();
    try {
      this.game?.destroy(true);
    } catch { /* ignore */ }
    this.game = null;
    this.scene = null;
    this.root.remove();
  }

  /**
   * Minimal read-only test hook: exposes only what the screen already shows
   * (public colors, '?' for hidden) plus interaction state. No answers,
   * no level jumping, no hidden truth.
   */
  private exposeTestHook(): void {
    (window as unknown as { __MG?: unknown }).__MG = {
      level: this.level,
      tubes: () =>
        this.session.tubes.map((t) =>
          t.layers.map((l) => (this.session.known.has(l.id) ? l.color : '?')),
        ),
      knownCount: () => this.session.known.size,
      historyLen: () => this.session.history.length,
      selected: () => this.selected,
      animating: () => this.animating,
      win: () => isWin(this.session.tubes),
      tubeCount: () => this.session.tubes.length,
      webgl: () => this.webglOk,
      dbg: () => ({
        disposed: this.disposed,
        animating: this.animating,
        webglOk: this.webglOk,
        selected: this.selected,
        tubes: this.session.tubes.length,
        t0len: this.session.tubes[0]?.layers.length ?? -1,
        tut: this.tut
          ? {
              mode: this.tut.mode,
              step: this.tut.step,
              awaiting: this.tut.awaiting,
              expectTube: this.tut.expectTube,
              expectButton: this.tut.expectButton,
            }
          : null,
        stage: this.scene?.stage ?? 'idle',
        audit: this.scene?.lastAudit ?? null,
        queued: this.queuedPour,
      }),
    };
  }

  /** Read-only API for the DEV panel. */
  devApi(): {
    level: () => number;
    puzzle: () => GeneratedPuzzle;
    session: () => SessionState;
    tap: (i: number) => void;
    rerender: () => void;
  } {
    return {
      level: () => this.level,
      puzzle: () => this.puzzle,
      session: () => this.session,
      tap: (i: number) => void this.onTap(i),
      rerender: () => this.scene?.render(),
    };
  }
}
