// Shared Playwright globals exposed by the test build (VITE_TEST_HOOKS=1).
export {};

declare global {
  interface Window {
    __PLUMBER__: {
      phase(): string;
      level(): number;
      mode(): string;
      puzzleId(): string;
      checksum(): string;
      sceneReady(): boolean;
      solve(): void;
      rotatable(): number[];
      rotate(i: number): void;
      camera(): { zoom: number; scrollX: number; scrollY: number };
      grid(): { w: number; h: number; cell: number; ox: number; oy: number };
      focus(): number;
      rotations(): number;
      kindAt(i: number): string;
      carried(): string | null;
      cellCenter(i: number): { x: number; y: number } | null;
      volumeOk(): boolean;
      start(): void;
      restart(): void;
      undo(): void;
      runToEnd(): string;
      usesFallback(): boolean | null;
      receiverGot(): number[];
      water(): number[];
      tick(): number;
      fractions(): number[];
      guide(): { action: string; cell: number | null; icon: string; mechanic: string } | null;
      mechanic(): string | null;
      tutorial(): string[];
      skipTutorial(): void;
      theme(): string;
      projects(): { id: string; theme: string; projectKey: string; version: number }[];
      collections(): string[];
      renderer(): 'webgl' | 'canvas' | null;
      perf(): { min: number; median: number; p95: number; samples: number; quality: number } | null;
    };
    __PLUMBER_DEV__: {
      state(): { puzzleId: string; seed: number; phase: string; tick: number };
      dump(): unknown;
      exportJson(): string;
      importJson(text: string): { ok: boolean; steps: number; phase: string; checksum: string; reason?: string };
      step(): number;
      batch(n: number): { schema: string; total: number; approved: number; rejected: { puzzleId: string; seed: number; reason: string }[] };
      rejectToFixture(spec: { puzzleId: string; seed: number; reason: string }): { puzzleId: string; seed: number; expectPhase: string; note: string };
      certify(): { ok: boolean; phase: string; volumeOk: boolean; trivialWin: boolean; solvable: boolean; reasons: string[] };
      panelVisible(): boolean;
      destroy(): void;
    };
    __MG_TEST__: {
      save(): {
        games: Record<string, {
          completed: number[];
          maxLevel: number;
          stars: Record<string, number>;
          collections: string[];
          active: { levelNumber: number } | null;
          modes?: Record<string, { maxLevel: number; completed: number[]; active: { levelNumber: number } | null }>;
          selected?: string;
        }>;
        conflicts?: Record<string, unknown>;
      };
      status(): { state: string; pending: number };
      guestId(): string;
      conflicts(): string[];
      syncNow(): Promise<void>;
      logout(): void;
      login(email: string): Promise<boolean>;
      schema(): number;
      restoreBackup(): Promise<boolean>;
      offlineStatus(gameId: string): Promise<{ ready: boolean; cached: number; total: number; missing: string[] } | null>;
      precacheGame(gameId: string): Promise<{ ready: boolean; cached: number; total: number; missing: string[] } | null>;
      deleteGameCache(gameId: string): Promise<string[]>;
    };
  }
}
