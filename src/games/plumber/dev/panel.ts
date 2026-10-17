// §16 dev/test-only visual debugger panel. Mounted only when the game runs in a
// dev/test build; it is tree-shaken/never imported by the production path.
import { button, el } from '../../../platform/ui/ui';
import type { BatchReport, DiagDump, ReplayResult } from './session';
import type { DraftCheck } from './editor';

export interface DevPanelState {
  puzzleId: string;
  seed: number;
  rulesetVersion: string;
  generatorVersion: string;
  configRevision?: number;
  configChecksum?: string;
  tick: number;
  phase: string;
  fps: number | null;
  valves: boolean[];
  water: number[];
  waterColor: Array<string | null>;
  rots: number[];
  generator: string;
  solver: string;
}

export interface DevPanelDeps {
  getState: () => DevPanelState;
  getDump: () => DiagDump;
  importDump: (text: string) => ReplayResult;
  step: () => void;
  batch: (count: number) => BatchReport;
  rotate: () => void;
  remove: () => void;
  certify: () => DraftCheck;
}

export function mountDevPanel(root: HTMLElement, deps: DevPanelDeps): { destroy: () => void; refresh: () => void } {
  // Styles are inline on purpose: the dev panel's CSS must not leak into the
  // production stylesheet (release guard checks for dev-only tokens).
  const panel = el('div');
  const head = el('div', '', 'plumber dev');
  const body = el('div');
  const actions = el('div');
  // Collapsed by default and click-through, so the overlay never blocks real
  // gameplay taps (mobile) — it only becomes interactive when opened.
  panel.dataset.devPanel = '1';
  panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;width:280px;max-height:60vh;overflow:auto;background:rgba(8,12,20,.92);color:#b8e6ff;border:1px solid #2b4a63;border-radius:8px;font:11px/1.4 ui-monospace,monospace;pointer-events:none;';
  head.style.cssText = 'padding:6px 8px;color:#7fd7ff;border-bottom:1px solid #2b4a63;pointer-events:auto;cursor:pointer;';
  body.style.cssText = 'padding:4px 8px;display:none;';
  actions.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;padding:6px 8px;pointer-events:auto;';
  panel.append(head, body, actions);
  let open = false;
  head.addEventListener('click', () => {
    open = !open;
    body.style.display = open ? 'block' : 'none';
    actions.style.display = open ? 'flex' : 'none';
    panel.style.pointerEvents = open ? 'auto' : 'none';
  });
  root.appendChild(panel);

  const refresh = (): void => {
    const s = deps.getState();
    body.textContent = '';
    const row = (k: string, v: string): HTMLElement => {
      const r = el('div');
      r.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
      const ks = el('span', '', k);
      ks.style.opacity = '.6';
      const vs = el('span', '', v);
      vs.style.cssText = 'max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      r.append(ks, vs);
      return r;
    };
    body.append(
      row('puzzleId', s.puzzleId),
      row('seed', String(s.seed)),
      row('rules/gen', `${s.rulesetVersion} / ${s.generatorVersion}`),
      row('config', `${s.configRevision ?? '-'} ${s.configChecksum ?? ''}`),
      row('phase', `${s.phase} tick=${s.tick}`),
      row('fps', s.fps === null ? '-' : String(Math.round(s.fps))),
      row('rots', s.rots.join(',')),
      row('valves', s.valves.map((v) => (v ? '1' : '0')).join('')),
      row('water', s.water.join(',')),
      row('colors', s.waterColor.map((c) => c ?? '-').join(',')),
      row('generator', s.generator),
      row('solver', s.solver),
    );
  };

  const download = (): void => {
    const dump = deps.getDump();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${dump.puzzleId.replace(/[^\w.-]+/g, '_')}.diag.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importBtn = button('import', 'btn', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      // import via file is only reachable when the panel is open
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const res = deps.importDump(String(reader.result ?? ''));
        head.textContent = `plumber dev — replay ${res.ok ? 'OK' : `FAIL:${res.reason ?? ''}`} ${res.steps} steps ${res.phase}`;
        refresh();
      });
      reader.readAsText(file);
    });
    input.click();
  }, 'import diagnostics json');

  actions.append(
    button('export', 'btn', download, 'export diagnostics json'),
    importBtn,
    button('step', 'btn', () => { deps.step(); refresh(); }, 'advance one tick'),
    button('batch', 'btn', () => {
      const rep = deps.batch(20);
      head.textContent = `plumber dev — batch ${rep.approved}/${rep.total} rejected ${rep.rejected.length}`;
      refresh();
    }, 'run batch diagnostics'),
    button('certify', 'btn', () => {
      const c = deps.certify();
      head.textContent = `plumber dev — certify ${c.ok ? 'OK' : c.reasons.join(',')}`;
      refresh();
    }, 'certify current draft'),
    button('rotate', 'btn', () => { deps.rotate(); refresh(); }, 'rotate selected'),
    button('remove', 'btn', () => { deps.remove(); refresh(); }, 'remove selected'),
  );

  const timer = window.setInterval(refresh, 500);
  refresh();
  return {
    destroy: () => { window.clearInterval(timer); panel.remove(); },
    refresh,
  };
}
