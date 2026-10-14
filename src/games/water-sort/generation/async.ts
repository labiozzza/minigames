// Worker client with stale-request cancellation and main-thread fallback.
import { generatePuzzle, type GeneratedPuzzle } from './generator';
import GenWorker from '../workers/gen.worker?worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (p: GeneratedPuzzle) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new GenWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; puzzle?: GeneratedPuzzle; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok && e.data.puzzle) p.resolve(e.data.puzzle);
      else p.reject(new Error(e.data.error ?? 'worker failed'));
    };
    worker.onerror = () => {
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

/** Latest request wins: older pending requests are rejected as stale. */
export function requestLevel(level: number): Promise<GeneratedPuzzle> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => generatePuzzle(level));
  for (const [id, p] of pending) {
    pending.delete(id);
    p.reject(new Error('stale'));
  }
  const id = nextId++;
  return new Promise<GeneratedPuzzle>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ id, level });
    } catch {
      pending.delete(id);
      resolve(generatePuzzle(level));
    }
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        // Resource guard: fall back synchronously rather than hang the UI.
        try {
          resolve(generatePuzzle(level));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
    }, 15000);
  });
}

export function terminateWorker(): void {
  try {
    worker?.terminate();
  } catch { /* ignore */ }
  worker = null;
  pending.clear();
}
