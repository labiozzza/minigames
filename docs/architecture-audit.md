# Architecture Audit — MiniGames (факт до «Водопроводчика»)

Дата: 2026-10-16. Ветка: `feat/plumber-tz-v1.1-assetgen`. ТЗ: `01_TECHNICAL_SPEC_PLUMBER.md` v1.1, `02_OPENCODE_EXECUTION_RULES.md`, `03_ASSETGEN_AGENT_SPEC.md`.

## 1. Корень и стек (факт)

- `package.json`: `minigames@1.0.0`, `type: module`, `node >=20.19`. Зависимость runtime: `phaser@4.2.1`. Dev: `typescript ~5.6.3`, `vite ^6.3.5`, `vite-plugin-pwa ^1.0.0`, `@playwright/test ^1.52.0`, `vitest ^3.2.4`.
- Сборка: `tsc --noEmit && vite build` → `dist/`. PWA: `VitePWA generateSW`, `registerType: prompt`, precache `**/*.{js,css,html,ico,png,svg,woff2}`, `navigateFallback: index.html`. Манифест описывает только игру №1 («Переливашки»).
- TS strict (`noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`), `target ES2022`, `moduleResolution bundler`.
- Скрипты: `dev/build/preview/typecheck/lint/test/test:levels/test:e2e/icons/prebuild`.

## 2. Структура (факт)

- `src/main.ts` — bootstrap: `registerWaterSort()`, `registerSW` (prompt, `mg:sw-update`), `new Shell(app)`.
- `src/app/shell.ts` — каталог, настройки, импорт/экспорт, install/update, жизненный цикл игры. Карточка каталога захардкожена под `water-sort` (строки 104–123). `ctx.audio` передаётся как `undefined as never` — техдолг для второй игры.
- `src/platform/games/registry.ts` — контракт `GameModule { id, titleKey, descKey, version, mount }`, `GameContext { root, save, settings, lang, audio, level?, dev, persist, t, onExit, onProgress }`, `GameHandle { pause, resume, unmount }`. Минимальный, без `load/dispose/captureState` из примера ТЗ §3.3 — расхождение задокументировано, менять только аддитивно.
- `src/games/water-sort/`: `index.ts` (регистрация `water-sort@1.0.0`), `game.ts` (1071 строка: DOM-хром + Phaser-сцена), `domain/model.ts` (176), `generation/{generator.ts 239, prng.ts 38, async.ts}`, `solver/solver.ts` (147) + `hint.ts`, `presentation/{scene.ts, layout.ts}`, `tutorial/{logic.ts, overlay.ts}`, `config/{balance.ts, palette.ts}`, `workers/gen.worker.ts`, `dev/panel.ts`.
- `src/platform/`: `storage/{save.ts 185, idb.ts 108}` (IndexedDB `minigames/kv` + localStorage fallback, `schemaVersion=1`, `SAVE_KEY=save-v1`), `settings/store.ts`, `i18n/{ru,en,index}`, `pwa/pwa.ts`, `ui/ui.ts`.
- `src/audio/engine.ts` — Web Audio синтезатор, без файлов.
- Тесты: `tests/unit/` (4 файла), `tests/levels/` (массовая сертификация), `tests/e2e/` (9 spec-файлов, Playwright). `evidence/` содержит логи/скриншоты. `docs/`: ARCHITECTURE, GAME_MODULE_API, GENERATION, DEPLOY, ACCEPTANCE_REPORT.

## 3. PWA / офлайн / сохранения (факт)

- Один SW (`generateSW`), precache всего `dist` при первой загрузке. Обновление только баннером по кнопке, с выгрузкой игры и сохранением. Принудительного рестарта посреди уровня нет.
- Сохранения: `SaveData { schemaVersion, settings, games: Record<string, WaterSortSave>, lastPlayed, updatedAt }`. `sanitizeSave` отбрасывает неизвестные игры молча, но сохраняет `water-sort`. Для `plumber` потребуется расширить `SaveData` аддитивно + миграция (не ломая `water-sort`).
- Импорт/экспорт: JSON с checksum (не аутентичность), `mergeSaves`, лимит файла 20 МБ, бэкап перед заменой.
- Backend отсутствует: нет `server/`, нет Fastify/Postgres, нет OTP/auth API. ТЗ §11 допускает резервный стек только если backend отсутствует — подтверждено, что отсутствует. Этап 5 готовит его изолированно, без VPS-действий сейчас.

## 4. Графика (факт)

- Water-sort не использует внешние PNG-спрайты: отрисовка кодом (Phaser Graphics) + CSS. Общих атласов/пайплайна спрайтов нет. Конфликта имён с `plumber` нет.
- AssetGen — новый инструмент сборки (`assetgen.py`, Pillow), не runtime-зависимость PWA. Соответствует ТЗ §8.2.1 и `03_ASSETGEN_AGENT_SPEC.md` §9.

## 5. Точки интеграции «Водопроводчика» (план повторного использования)

- Регистрация: `registerPlumber()` рядом с `registerWaterSort()` в `src/main.ts`; карточка каталога — обобщить рендер через `listGames()` вместо хардкода water-sort.
- Контракт: расширить `GameContext/SaveData` аддитивно (`games['plumber']`), не ломая `sanitizeSave`/`mergeSaves`.
- Переиспользовать: `Shell` жизненный цикл (один `Phaser.Game`), `storage/idb`, `settings`, `i18n` (ru/en), `pwa` (единый SW/scope), `audio/engine` (расширить SFX журчания, не плодить движки), `workers` паттерн для генератора, `dev/panel` паттерн для replay-редактора.
- Изоляция: `src/games/plumber/{domain, simulator, generation, solver, progression, presentation, ui, assets, adapters}` — физически как подпапка `src/games/plumber/` (логическая схема ТЗ §3.1, не приказ о папках). Domain без Phaser/DOM.

## 6. Риски и ограничения

- R1: `shell.ts` захардкожен под water-sort (каталог, `playGame('water-sort')` в настройках, импорт-диалог). Митигация: обобщить каталог, регрессия E2E water-sort.
- R2: `ctx.audio = undefined as never` — скрытый техдолг. Митигация: создать AudioEngine в `playGame` как в water-sort `mount`, проверить unmount.
- R3: `sanitizeSave` знает только `water-sort`. Митигация: аддитивная схема + тесты миграции, rollback.
- R4: Единый SW precache — добавление тяжёлых атласов plumber требует lazy-чанков + «Скачать для офлайн» (уже предусмотрено в GAME_MODULE_API §4).
- R5: GPT Image API недоступен (нет `OPENAI_API_KEY`, пакет `openai` не установлен, платных вызовов не было). Митигация: PLACEHOLDER-примитивы (8/8 VALID_TECH), очередь `assetgen-work/jobs/*.json` в статусе `WAITING_FOR_PROVIDER`, визуальный гейт этапа 2 = `BLOCKED_ASSET`, функциональная разработка не блокируется (регламент §7).
- R6: Backend отсутствует — Этап 5 нельзя «доработать», только создать изолированно. До этого — локальные сохранения + IndexedDB.

## 7. Исходные проверки (до изменений plumber)

- `npm run typecheck` — PASS.
- `npm run test` (vitest unit) — 26/26 PASS (4 файла).
- AssetGen: `python3 -m unittest discover -s .opencode/skills/minigames-assetgen/tests -v` — 4/4 PASS; `validate pipe_straight` — VALID_TECH; `submit+process` — `WAITING_FOR_PROVIDER` без ключа (корректно, платных вызовов нет).
- `test:levels` / `test:e2e` — NOT RUN на этом шаге (зафиксировано, запускается в отчёте этапа 1/6).
