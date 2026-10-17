// Platform shell: catalog, settings, import/export, install/update, game lifecycle.
import {
  backupCurrent,
  buildExport,
  loadSave,
  mergeSaves,
  parseExport,
  storeSave,
  type SaveData,
} from '../platform/storage/save';
import { resolveTheme, sanitizeSettings, type Settings } from '../platform/settings/store';
import { isLang, translate, type Lang } from '../platform/i18n';
import { getGame, type GameContext, type GameHandle } from '../platform/games/registry';
import { button, el, modal, toast } from '../platform/ui/ui';
import { applyUpdate, canInstall, isInstalled, promptInstall } from '../platform/pwa/pwa';
import { SyncEngine } from '../platform/sync/engine';
import { getStatus, subscribeStatus, type SyncStatus } from '../platform/sync/status';
import { isSignedIn, getGuestId } from '../platform/auth/session';

export class Shell {
  private app: HTMLElement;
  private save!: SaveData;
  private settings!: Settings;
  private lang!: Lang;
  private game: GameHandle | null = null;
  private gameId: string | null = null;
  private gameRoot: HTMLElement | null = null;
  private toastRoot!: HTMLElement;
  private bannerRoot!: HTMLElement;
  private updateAvailable = false;
  private engine!: SyncEngine;
  private statusEl: HTMLElement | null = null;

  constructor(app: HTMLElement) {
    this.app = app;
  }

  t(key: string, vars?: Record<string, string | number>): string {
    return translate(this.lang, key, vars);
  }

  async init(): Promise<void> {
    this.save = await loadSave();
    this.settings = sanitizeSettings(this.save.settings);
    this.save.settings = this.settings;
    const storedLang = this.save.settings.lang;
    this.lang = isLang(storedLang) ? storedLang : 'ru';
    this.applyTheme();
    document.documentElement.lang = this.lang;
    this.toastRoot = el('div', 'toast-root');
    this.bannerRoot = el('div', 'banner-root');
    document.body.append(this.toastRoot, this.bannerRoot);
    this.engine = new SyncEngine({ save: this.save, persist: () => this.persist(), games: ['water-sort', 'plumber'] });
    subscribeStatus((s) => this.renderStatus(s));
    void this.engine.init();
    this.exposeTestApi();
    this.bindEvents();
    this.renderCatalog();
    this.checkUpdateBanner();
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = resolveTheme(this.settings);
  }

  /** Test/dev-only introspection. Absent in release builds. */
  private exposeTestApi(): void {
    if (!(import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === '1')) return;
    (window as unknown as { __MG_TEST__?: unknown }).__MG_TEST__ = {
      save: () => JSON.parse(JSON.stringify(this.save)) as SaveData,
      status: () => getStatus(),
      guestId: () => getGuestId(),
      conflicts: () => Object.keys(this.save.conflicts ?? {}),
      syncNow: () => this.engine.fullSync(),
      logout: () => { this.engine.logout(); },
      login: async (email: string) => {
        const r = await this.engine.requestOtp(email);
        if (!r.code) return false;
        return this.engine.login(email, r.code);
      },
    };
  }

  private async persist(): Promise<void> {
    this.save.settings = this.settings;
    await storeSave(this.save);
  }

  private bindEvents(): void {
    window.addEventListener('mg:exit-catalog', () => void this.exitToCatalog());
    window.addEventListener('mg:play-level', (e) => {
      const d = (e as CustomEvent).detail as { gameId: string; level: number; mode?: string };
      void this.playGame(d.gameId, d.level, d.mode);
    });
    window.addEventListener('mg:open-settings', () => this.openSettings());
    window.addEventListener('mg:first-win', () => this.maybeOfferInstall());
    window.addEventListener('mg:sw-update', () => {
      this.updateAvailable = true;
      this.checkUpdateBanner();
    });
    window.addEventListener('mg:install-available', () => this.checkUpdateBanner());
  }

  // ---------- Catalog ----------

  private clearGame(): void {
    this.gameRoot?.remove();
    this.gameRoot = null;
  }

  renderCatalog(): void {
    this.clearGame();
    this.app.innerHTML = '';
    const wrap = el('div', 'catalog');
    const head = el('header', 'catalog-head');
    head.append(el('h1', 'app-title', this.t('app.name')), el('p', 'app-tagline', this.t('app.tagline')));
    const headActions = el('div', 'head-actions');
    const status = el('button', 'sync-pill', '') as HTMLButtonElement;
    status.setAttribute('type', 'button');
    status.addEventListener('click', () => this.openAccount());
    this.statusEl = status;
    headActions.append(status, button('👤', 'icon-btn', () => this.openAccount(), this.t('account.title')));
    headActions.appendChild(button('⚙', 'icon-btn', () => this.openSettings(), this.t('settings.title')));
    head.appendChild(headActions);
    wrap.appendChild(head);
    this.renderStatus(getStatus());

    const lp = this.save.lastPlayed;
    if (lp && getGame(lp.gameId)) {
      const cont = el('section', 'continue-card');
      cont.append(el('h2', '', this.t('catalog.continue')));
      cont.append(el('p', '', this.t('catalog.continueLevel', { level: lp.levelNumber })));
      cont.append(
        button(this.t('catalog.play'), 'btn primary big', () => void this.playGame(lp.gameId, lp.levelNumber), this.t('catalog.play')),
      );
      wrap.appendChild(cont);
    }

    const grid = el('div', 'game-grid');
    const card = el('article', 'game-card');
    const art = el('div', 'game-art game-art-ws');
    art.setAttribute('aria-hidden', 'true');
    card.appendChild(art);
    card.append(el('h3', '', 'Water Sort'));
    card.append(el('p', '', 'Переливашки'));
    const ws = this.save.games['water-sort'];
    const wsSave = ws && 'maxLevel' in ws ? ws : undefined;
    const level = lp?.gameId === 'water-sort' ? lp.levelNumber : (wsSave?.maxLevel ?? 1);
    const row = el('div', 'card-row');
    row.append(
      button(this.t('catalog.play'), 'btn primary', () => void this.playGame('water-sort', level), this.t('catalog.play')),
      el('span', 'offline-badge', `✓ ${this.t('catalog.offlineReady')}`),
    );
    card.appendChild(row);
    grid.appendChild(card);

    const pcard = el('article', 'game-card');
    const part = el('div', 'game-art game-art-plumber');
    part.setAttribute('aria-hidden', 'true');
    pcard.appendChild(part);
    pcard.append(el('h3', '', this.t('plumber.name')));
    pcard.append(el('p', '', this.t('plumber.tag')));
    const ps = this.save.games['plumber'];
    const psLevel = lp?.gameId === 'plumber' ? lp.levelNumber : (ps && 'maxLevel' in ps ? (ps.maxLevel as number) : 1);
    const prow = el('div', 'card-row');
    prow.append(
      button(this.t('catalog.play'), 'btn primary', () => void this.playGame('plumber', psLevel), this.t('catalog.play')),
      el('span', 'offline-badge', `✓ ${this.t('catalog.offlineReady')}`),
    );
    pcard.appendChild(prow);
    grid.appendChild(pcard);
    wrap.appendChild(grid);
    this.app.appendChild(wrap);
  }

  private async exitToCatalog(): Promise<void> {
    try {
      await this.game?.unmount();
    } catch { /* ignore */ }
    this.game = null;
    this.gameId = null;
    this.save = await loadSave();
    this.settings = sanitizeSettings(this.save.settings);
    this.renderCatalog();
  }

  async playGame(gameId: string, level: number, mode?: string): Promise<void> {
    const mod = getGame(gameId);
    if (!mod) return;
    this.gameId = gameId;
    try {
      await this.game?.unmount();
    } catch { /* ignore */ }
    this.game = null;
    this.app.innerHTML = '';
    this.clearGame();
    this.gameRoot = el('div', 'game-root');
    this.app.appendChild(this.gameRoot);
    const ctx: GameContext = {
      root: this.gameRoot,
      save: this.save,
      settings: this.settings,
      lang: this.lang,
      audio: undefined as never,
      level,
      mode,
      dev: import.meta.env.DEV,
      progress: this.engine,
      persist: () => this.persist(),
      t: (k, v) => this.t(k, v),
      onExit: () => void this.exitToCatalog(),
      onProgress: () => {
        this.renderCatalogBadges();
      },
    };
    try {
      this.game = await mod.mount(ctx);
    } catch (err) {
      console.error(`[shell] mount failed for ${gameId}:`, err);
      this.game = null;
      this.gameId = null;
      this.renderCatalog();
    }
  }

  private renderCatalogBadges(): void {
    // Cheap refresh hook after progress events; full re-render happens on exit.
  }

  // ---------- Account & sync ----------

  private syncLabel(s: SyncStatus): { text: string; cls: string } {
    const ru = this.lang === 'ru';
    switch (s.state) {
      case 'local': return { text: ru ? 'Локально' : 'Local', cls: 'local' };
      case 'guest': return { text: ru ? 'Гость' : 'Guest', cls: 'guest' };
      case 'pending': return { text: ru ? `Ждёт синхр. (${s.pending})` : `Pending (${s.pending})`, cls: 'pending' };
      case 'syncing': return { text: ru ? 'Синхронизация…' : 'Syncing…', cls: 'syncing' };
      case 'synced': return { text: ru ? 'Синхронизировано' : 'Synced', cls: 'synced' };
      case 'conflict': return { text: ru ? 'Конфликт' : 'Conflict', cls: 'conflict' };
      case 'offline': return { text: ru ? `Офлайн (${s.pending})` : `Offline (${s.pending})`, cls: 'offline' };
      default: return { text: ru ? 'Ошибка синхр.' : 'Sync error', cls: 'error' };
    }
  }

  private renderStatus(s: SyncStatus): void {
    if (!this.statusEl) return;
    if (!this.engine?.enabled) {
      this.statusEl.style.display = 'none';
      return;
    }
    const { text, cls } = this.syncLabel(s);
    this.statusEl.textContent = text;
    this.statusEl.className = `sync-pill ${cls}`;
    this.statusEl.style.display = '';
  }

  openAccount(): void {
    const { box, close } = modal(this.app, 'account');
    box.append(el('h2', '', this.t('account.title')));
    if (!this.engine.enabled) {
      box.append(el('p', 'muted', this.lang === 'ru'
        ? 'Облачный аккаунт не настроен: игра работает локально и офлайн. Прогресс хранится на устройстве.'
        : 'Cloud account is not configured: the game runs locally and offline. Progress is stored on this device.'));
      const row0 = el('div', 'modal-row');
      row0.append(button(this.t('settings.close'), 'btn primary', () => close(), 'close'));
      box.appendChild(row0);
      return;
    }
    const signed = isSignedIn();
    const status = getStatus();
    box.append(el('p', 'muted', `${this.syncLabel(status).text}${signed && status.user?.email ? ` · ${status.user.email}` : ''}`));

    const conflicts = Object.keys(this.save.conflicts ?? {});
    if (conflicts.length) {
      const cbox = el('div', 'conflict-box');
      cbox.append(el('h3', '', this.lang === 'ru' ? 'Незавершённые головоломки конфликтуют' : 'Unfinished puzzles conflict'));
      for (const gid of conflicts) {
        const line = el('div', 'conflict-row');
        line.append(el('span', '', `${gid}: ${this.lang === 'ru' ? 'сохранены обе версии' : 'both versions kept'}`));
        line.append(button(this.lang === 'ru' ? 'Моя' : 'Mine', 'btn', () => { void this.resolveConflict(gid, 'local'); close(); }, 'keep local'));
        line.append(button(this.lang === 'ru' ? 'Серверная' : 'Server', 'btn', () => { void this.resolveConflict(gid, 'remote'); close(); }, 'keep remote'));
        cbox.appendChild(line);
      }
      box.appendChild(cbox);
    }

    if (!signed) {
      const email = document.createElement('input');
      email.type = 'email';
      email.placeholder = 'you@example.com';
      email.className = 'account-input';
      const code = document.createElement('input');
      code.type = 'text';
      code.inputMode = 'numeric';
      code.placeholder = this.lang === 'ru' ? 'Код из письма' : 'Emailed code';
      code.className = 'account-input';
      box.append(email, code);
      const row = el('div', 'modal-row');
      let codeSent = false;
      row.append(
        button(this.lang === 'ru' ? 'Получить код' : 'Get code', 'btn', () => {
          const v = email.value.trim();
          if (!v) return;
          void this.engine.requestOtp(v).then((r) => {
            codeSent = true;
            if (r.code) {
              // Test builds only: the backend reveals the code so E2E can log in.
              code.value = r.code;
              toast(this.toastRoot, `code ${r.code}`);
            } else {
              toast(this.toastRoot, this.lang === 'ru' ? 'Код отправлен' : 'Code sent');
            }
          }).catch(() => toast(this.toastRoot, this.lang === 'ru' ? 'Не удалось' : 'Failed'));
        }, 'request code'),
        button(this.lang === 'ru' ? 'Войти' : 'Sign in', 'btn primary', () => {
          if (!codeSent) return;
          void this.engine.login(email.value.trim(), code.value.trim()).then((ok) => {
            if (ok) { close(); this.renderCatalog(); toast(this.toastRoot, this.lang === 'ru' ? 'Вход выполнен' : 'Signed in'); }
            else toast(this.toastRoot, this.lang === 'ru' ? 'Неверный код' : 'Invalid code');
          });
        }, 'verify'),
      );
      box.appendChild(row);
      box.append(el('p', 'muted', this.lang === 'ru'
        ? 'Гостевой прогресс привяжется к аккаунту при входе.'
        : 'Guest progress is linked to the account on sign-in.'));
    } else {
      const row = el('div', 'modal-row');
      row.append(
        button(this.lang === 'ru' ? 'Синхронизировать' : 'Sync now', 'btn', () => { void this.engine.fullSync().then(() => this.renderStatus(getStatus())); }, 'sync now'),
        button(this.lang === 'ru' ? 'Выйти' : 'Sign out', 'btn', () => { this.engine.logout(); close(); this.renderCatalog(); }, 'sign out'),
        button(this.t('settings.close'), 'btn primary', () => close(), 'close'),
      );
      box.appendChild(row);
    }
  }

  private async resolveConflict(gameId: string, choice: 'local' | 'remote'): Promise<void> {
    const c = this.save.conflicts?.[gameId];
    if (!c) return;
    if (choice === 'remote') {
      const g = this.save.games[gameId] as { active?: unknown } | undefined;
      if (g) g.active = c.remote;
    }
    delete this.save.conflicts![gameId];
    if (Object.keys(this.save.conflicts!).length === 0) delete this.save.conflicts;
    await this.persist();
    this.renderCatalog();
  }

  // ---------- Settings ----------

  openSettings(): void {
    const { box, close } = modal(this.app, 'settings');
    box.append(el('h2', '', this.t('settings.title')));
    const form = el('div', 'settings-form');
    const s = this.settings;

    const row = (label: string, control: HTMLElement): HTMLElement => {
      const r = el('label', 'setting-row');
      r.append(el('span', '', label), control);
      return r;
    };
    const sel = (opts: Array<[string, string]>, val: string, on: (v: string) => void): HTMLSelectElement => {
      const e = document.createElement('select');
      for (const [v, l] of opts) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        e.appendChild(o);
      }
      e.value = val;
      e.addEventListener('change', () => on(e.value));
      return e;
    };
    const toggle = (val: boolean, on: (v: boolean) => void): HTMLInputElement => {
      const e = document.createElement('input');
      e.type = 'checkbox';
      e.checked = val;
      e.addEventListener('change', () => on(e.checked));
      return e;
    };
    const range = (val: number, on: (v: number) => void): HTMLInputElement => {
      const e = document.createElement('input');
      e.type = 'range';
      e.min = '0';
      e.max = '1';
      e.step = '0.05';
      e.value = String(val);
      e.addEventListener('change', () => on(Number(e.value)));
      return e;
    };

    form.append(
      row(this.t('settings.theme'), sel(
        [['system', this.t('settings.themeSystem')], ['light', this.t('settings.themeLight')], ['dark', this.t('settings.themeDark')]],
        s.theme,
        (v) => { s.theme = v as Settings['theme']; this.applyTheme(); void this.persist(); },
      )),
      row(this.t('settings.language'), sel([['ru', 'Русский'], ['en', 'English']], s.lang, (v) => {
        s.lang = v as Lang;
        this.lang = s.lang;
        document.documentElement.lang = s.lang;
        void this.persist().then(() => {
          close();
          const gid = this.gameId ?? 'water-sort';
          if (this.game) void this.playGame(gid, this.save.lastPlayed?.levelNumber ?? 1);
          else this.renderCatalog();
        });
      })),
      row(this.t('settings.music'), toggle(s.music, (v) => { s.music = v; void this.persist(); })),
      row(this.t('settings.musicVolume'), range(s.musicVolume, (v) => { s.musicVolume = v; void this.persist(); })),
      row(this.t('settings.sfx'), toggle(s.sfx, (v) => { s.sfx = v; void this.persist(); })),
      row(this.t('settings.sfxVolume'), range(s.sfxVolume, (v) => { s.sfxVolume = v; void this.persist(); })),
      row(this.t('settings.vibration'), toggle(s.vibration, (v) => { s.vibration = v; void this.persist(); })),
      row(this.t('settings.speed'), sel(
        [['normal', this.t('settings.speedNormal')], ['fast', this.t('settings.speedFast')], ['instant', this.t('settings.speedInstant')]],
        s.speed,
        (v) => { s.speed = v as Settings['speed']; void this.persist(); },
      )),
      row(this.t('settings.symbols'), toggle(s.symbols, (v) => { s.symbols = v; void this.persist(); })),
    );
    box.appendChild(form);

    const actions = el('div', 'modal-row');
    if (!isInstalled()) {
      actions.append(
        button(canInstall() ? this.t('settings.install') : this.t('settings.installHint'), 'btn', () => {
          if (canInstall()) void promptInstall();
          else toast(this.toastRoot, this.installInstructions());
        }, this.t('settings.install')),
      );
    }
    actions.append(
      button(this.t('settings.export'), 'btn', () => this.exportProgress(), this.t('settings.export')),
      button(this.t('settings.import'), 'btn', () => this.importProgress(), this.t('settings.import')),
      button(this.t('settings.rules'), 'btn', () => this.openRules(), this.t('settings.rules')),
      button(this.t('settings.close'), 'btn primary', () => close(), this.t('settings.close')),
    );
    box.appendChild(actions);
  }

  private installInstructions(): string {
    return this.lang === 'ru'
      ? 'Откройте меню браузера → «Добавить на главный экран» / «Установить».'
      : 'Open the browser menu → "Add to Home Screen" / "Install".';
  }

  private openRules(): void {
    const { box } = modal(this.app, 'rules');
    box.append(el('h2', '', this.t('settings.rules')));
    const p = el('div', 'modal-text');
    p.textContent = this.lang === 'ru'
      ? 'Соберите каждый цвет в отдельной пробирке: два нажатия — выбрать и перелить. Переливать можно на тот же цвет или в пустую пробирку. Скрытые слои «?» открываются, когда оказываются сверху, и остаются известными.'
      : 'Collect each color in its own tube: two taps — select and pour. You may pour onto the same color or into an empty tube. Hidden "?" layers reveal when on top and stay known.';
    box.appendChild(p);
    const row = el('div', 'modal-row');
    row.append(
      button(this.lang === 'ru' ? '🎓 Повторить обучение' : '🎓 Replay tutorial', 'btn', () => {
        window.dispatchEvent(new CustomEvent('mg:replay-tutorial'));
      }, 'replay tutorial'),
    );
    box.appendChild(row);
  }

  // ---------- Export / import ----------

  private exportProgress(): void {
    try {
      const text = buildExport(this.save);
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'minigames-progress.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      toast(this.toastRoot, this.t('import.bad'));
    }
  }

  private importProgress(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) {
        toast(this.toastRoot, this.t('import.bad'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        void this.applyImport(String(reader.result ?? ''));
      };
      reader.readAsText(f);
    });
    input.click();
  }

  private async applyImport(text: string): Promise<void> {
    const incoming = parseExport(text);
    if (!incoming) {
      toast(this.toastRoot, this.t('import.bad'));
      return;
    }
    const hasCurrent = this.save.games['water-sort'] && (
      this.save.games['water-sort'].completed.length > 0 || this.save.games['water-sort'].active !== null
    );
    if (!hasCurrent) {
      await backupCurrent();
      this.save = incoming;
      this.settings = sanitizeSettings(this.save.settings);
      this.lang = this.settings.lang;
      document.documentElement.lang = this.lang;
      await this.persist();
      toast(this.toastRoot, this.t('import.done'));
      this.renderCatalog();
      return;
    }
    const { box, close } = modal(this.app, 'import');
    box.append(el('h2', '', this.t('import.title')));
    const cur = this.save.games['water-sort'];
    const inc = incoming.games['water-sort'];
    box.append(el(
      'p',
      'modal-text',
      `current: max ${cur?.maxLevel ?? 1}, done ${cur?.completed.length ?? 0} | file: max ${inc?.maxLevel ?? 1}, done ${inc?.completed.length ?? 0}`,
    ));
    const row = el('div', 'modal-row');
    const finish = async (mode: 'replace' | 'merge' | 'cancel') => {
      close();
      if (mode === 'cancel') return;
      const backup = JSON.stringify(this.save);
      try {
        await backupCurrent();
        this.save = mode === 'replace' ? incoming : mergeSaves(this.save, incoming);
        this.settings = sanitizeSettings(this.save.settings);
        this.lang = this.settings.lang;
        document.documentElement.lang = this.lang;
        await this.persist();
        toast(this.toastRoot, `${this.t('import.done')} ${this.t('import.backup')}`);
        this.renderCatalog();
      } catch {
        try {
          const parsed: unknown = JSON.parse(backup);
          const restored = parsed as SaveData;
          this.save = restored;
          await this.persist();
        } catch { /* last resort: keep going */ }
        toast(this.toastRoot, this.t('import.bad'));
      }
    };
    row.append(
      button(this.t('import.replace'), 'btn primary', () => void finish('replace'), this.t('import.replace')),
      button(this.t('import.merge'), 'btn', () => void finish('merge'), this.t('import.merge')),
      button(this.t('import.cancel'), 'btn', () => void finish('cancel'), this.t('import.cancel')),
    );
    box.appendChild(row);
  }

  // ---------- Install / update banners ----------

  private maybeOfferInstall(): void {
    if (this.settings.installDismissed || isInstalled() || !canInstall()) return;
    const bar = el('div', 'banner');
    bar.append(el('span', '', this.t('pwa.installTitle')));
    bar.append(
      button(this.t('pwa.installBtn'), 'btn primary', () => {
        void promptInstall().then(() => bar.remove());
      }, this.t('pwa.installBtn')),
      button(this.t('pwa.later'), 'btn', () => {
        this.settings.installDismissed = true;
        void this.persist();
        bar.remove();
      }, this.t('pwa.later')),
    );
    this.bannerRoot.appendChild(bar);
  }

  private checkUpdateBanner(): void {
    if (!this.updateAvailable) return;
    if (this.bannerRoot.querySelector('.banner.update')) return;
    const bar = el('div', 'banner update');
    bar.append(el('span', '', this.t('pwa.update')));
    bar.append(
      button(this.t('pwa.updateBtn'), 'btn primary', () => {
        void (async () => {
          // Active game autosaves continuously; unmount persists the latest state.
          try {
            if (this.game) await this.game.unmount();
          } catch { /* ignore */ }
          await applyUpdate();
        })();
      }, this.t('pwa.updateBtn')),
    );
    this.bannerRoot.appendChild(bar);
  }
}
