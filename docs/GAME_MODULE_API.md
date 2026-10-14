# GAME_MODULE_API — как добавить игру №2

## 1. Создать модуль

```
src/games/my-game/
  index.ts        — регистрация: registerGame({ id, titleKey, descKey, version, mount })
  game.ts         — класс с mount/pause/resume/unmount
  domain/         — чистые правила без Phaser/DOM (обязательно)
  presentation/   — Phaser-сцена (только отрисовка)
```

## 2. Контракт `GameModule`

```ts
import { registerGame, type GameContext, type GameHandle } from '../../platform/games/registry';

registerGame({
  id: 'my-game',
  titleKey: 'app.name',   // ключ i18n (добавить в ru/en)
  descKey: 'app.tagline',
  version: '1.0.0',
  mount: async (ctx: GameContext): Promise<GameHandle> => MyGame.create(ctx),
});
```

`GameContext` даёт: `root` (DOM-контейнер), `save`/`persist()`, `settings`,
`lang`, `t()`, `level?`, `dev`, `onExit()`, `onProgress()`.

## 3. Правила жизненного цикла

- Одновременно — не более одного `Phaser.Game` (менеджер в `shell.ts` следит).
- `pause()`: остановить сцену и звук. `resume()`: проверить контекст и продолжить.
- `unmount()`: сохранить состояние → остановить звуки → снять слушатели/таймеры →
  `game.destroy(true)` → удалить DOM → освободить ресурсы.
- Состояние хранить в `ctx.save.games['my-game']` через `sanitizeSave`-совместимую
  структуру; добавить ключ в `SaveData.games` и обработку в `mergeSaves`.
- Звук — только через Web Audio, без файлов. Темы/язык — через платформу.

## 4. Каталог и офлайн

- Зарегистрировать модуль в `src/main.ts` рядом с `registerWaterSort()`.
- Карточка каталога подхватится из `listGames()`. Для игр с тяжёлыми ассетами
  добавить на карточку кнопку «Скачать для офлайн» и список чанков для
  предкеширования (пример расширения — `workbox.runtimeCaching` в `vite.config.ts`).
- Прогресс автоматически попадёт в экспорт/импорт JSON.

## 5. Тесты и доказательства

- Unit-тесты правил в `tests/unit/`, E2E-сценарий в `tests/e2e/`,
  скриншоты в `evidence/screenshots/`.
- Пример-диагностика: `src/games/water-sort/dev/panel.ts` (только DEV).
