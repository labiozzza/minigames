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
    };
  }
}
