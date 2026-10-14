// Heavy generation/validation off the main thread. Never receives renderer or DOM state.
import { generatePuzzle } from '../generation/generator';

export interface GenRequest {
  id: number;
  level: number;
}

export interface GenResponse {
  id: number;
  ok: boolean;
  puzzle?: ReturnType<typeof generatePuzzle>;
  error?: string;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GenRequest>) => void) | null;
  postMessage: (m: GenResponse) => void;
};

scope.onmessage = (e: MessageEvent<GenRequest>) => {
  const { id, level } = e.data;
  try {
    const puzzle = generatePuzzle(level);
    scope.postMessage({ id, ok: true, puzzle });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

export {};
