import { registerGame, type GameContext, type GameHandle } from '../../platform/games/registry';
import { PlumberGame } from './game';

export const PLUMBER_ID = 'plumber';

export function registerPlumber(): void {
  registerGame({
    id: PLUMBER_ID,
    titleKey: 'plumber.name',
    descKey: 'plumber.tag',
    version: '0.1.0',
    assetsVersion: '1',
    assetPaths: ['assets/plumber/atlas.png', 'assets/plumber/atlas.json'],
    mount: async (ctx: GameContext): Promise<GameHandle> => {
      const level = ctx.level ?? 1;
      return PlumberGame.create(ctx, Math.max(1, level));
    },
  });
}
