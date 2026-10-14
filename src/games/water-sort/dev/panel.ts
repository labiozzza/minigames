// DEV-only diagnostics. Imported dynamically behind `import.meta.env.DEV`
// so production bundles exclude this module entirely.
import { toPublic } from '../domain/mystery';
import { suggestHint } from '../solver/hint';
import { requestLevel } from '../generation/async';
import { button, el, modal } from '../../../platform/ui/ui';

interface DevApi {
  level: () => number;
  puzzle: () => ReturnType<typeof requestLevel> extends Promise<infer P> ? P : never;
  session: () => { tubes: Array<{ id: string; layers: Array<{ id: string; color: string }> }>; known: Set<string>; history: unknown[] };
  tap: (i: number) => void;
  rerender: () => void;
}

export function attachDevPanel(root: HTMLElement, api: DevApi): void {
  const { box } = modal(root, 'dev');
  box.append(el('h2', '', 'DEV'));
  const info = el('pre', 'dev-info', '');
  const num = el('input', 'dev-input') as HTMLInputElement;
  num.type = 'number';
  num.min = '1';
  num.value = String(api.level());
  const refresh = () => {
    const p = api.puzzle() as unknown as {
      seed: number; attempt: number; solution: unknown[]; generatorVersion: string; balanceVersion: string;
      hiddenLayerIds: string[]; tubes: Array<{ layers: Array<{ id: string; color: string }> }>;
    };
    const s = api.session();
    info.textContent = [
      `level=${api.level()} seed=${p.seed} attempt=${p.attempt}`,
      `gen=${p.generatorVersion} bal=${p.balanceVersion}`,
      `solutionLen=${p.solution.length} hidden=${p.hiddenLayerIds.length} known=${s.known.size} history=${s.history.length}`,
    ].join('\n');
  };
  refresh();
  const row = el('div', 'modal-row');
  row.append(
    button('Open', 'btn', () => {
      const n = Math.max(1, Math.floor(Number(num.value) || 1));
      window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'water-sort', level: n } }));
    }, 'open level'),
    button('Truth', 'btn', () => {
      const s = api.session();
      const truth = s.tubes.map((t, i) => `${i}:${t.layers.map((l) => `${l.color}${s.known.has(l.id) ? '' : '?'}`).join('')}`).join(' | ');
      info.textContent = `TRUTH ${truth}\n` + info.textContent;
    }, 'reveal true colors'),
    button('Hint?', 'btn', () => {
      const s = api.session();
      const pub = toPublic(s.tubes, s.known);
      const t0 = performance.now();
      const h = suggestHint(pub, 120000);
      info.textContent = `hint=${JSON.stringify(h)} dt=${Math.round(performance.now() - t0)}ms\n` + info.textContent;
    }, 'check hint'),
    button('Solve', 'btn', () => {
      const p = api.puzzle() as unknown as { solution: Array<{ from: number; to: number }> };
      let i = 0;
      // Replays the certified solution through real taps with delays.
      const step = () => {
        if (i >= p.solution.length) {
          refresh();
          return;
        }
        const m = p.solution[i++];
        api.tap(m.from);
        setTimeout(() => {
          api.tap(m.to);
          setTimeout(step, 120);
        }, 120);
      };
      step();
    }, 'play solution'),
  );
  box.append(num, row, info);
  const t = setInterval(() => {
    if (!document.contains(box)) clearInterval(t);
    else refresh();
  }, 2000);
}
