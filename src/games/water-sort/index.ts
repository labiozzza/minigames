import { registerGame, type GameContext, type GameHandle } from '../../platform/games/registry';
import { WaterSortGame } from './game';

export const WATER_SORT_ID = 'water-sort';

export function registerWaterSort(): void {
  registerGame({
    id: WATER_SORT_ID,
    titleKey: 'app.name',
    descKey: 'app.tagline',
    version: '1.0.0',
    mount: async (ctx: GameContext): Promise<GameHandle> => {
      const ws = ctx.save.games[WATER_SORT_ID];
      const level = ctx.level ?? ctx.save.lastPlayed?.levelNumber ?? ws?.maxLevel ?? 1;
      return WaterSortGame.create(ctx, Math.max(1, level));
    },
  });
}
