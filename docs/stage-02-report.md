# Stage 2 Report — Играбельность, финальная графика, онбординг-база

Дата: 2026-10-16 (продолжение). Ветка: `feat/plumber-tz-v1.1-assetgen`.

## 1. Ассеты: 8/8 APPROVED, интегрированы
- Канал: подписка ChatGPT через `tools/gpt_imagegen_chatgpt.mjs` (починен `store:false`, токен обновлён пользователем).
- Бюджет итого: **low 13/24, medium 8/16** (всего 21 генерация). Детали: `assetgen-work/budget.json`, реестр: `assetgen-work/registry.json`.
- Отбор: 6 medium + `pipe_cap_low_1` (medium-крышка была вазой) приняты; свечения valve/t отклонены 3 раза как системные, затем приняты после проверки незаметности на тайлах 256px на тёмном и светлом фоне (`plumber-tiles-dark/light.png`). Все 8 — VALID_TECH, без текста, стиль един.
- Подготовка: `tools/normalize_tiles.py` — uniform-scale + порты ровно на midlines (resid 0, distort 1.000), метаданные `openings_px` в `assets/plumber/tiles/*.meta.json`, атлас `public/assets/plumber/atlas.{png,json}` (8 фреймов, 464 КБ, в precache сборки).
- Реестр: 8/8 `APPROVED` (Phaser-интеграция со скриншотами есть). Очередь: mixer/splitter/switch/decor/коллекции.

## 2. Игра (файлы)
- `src/games/plumber/{index,game}.ts`, `presentation/scene.ts`: регистрация в каталоге, DOM-хром (цель, старт/пауза/стоп, undo/restart/hint), тики 200 мс с паузой при скрытии вкладки, вода-оверлей строго по модели, утечка красным маркером + № клетки, победа (звёзды — Этап 4), автопрогресс уровней, сохранения полного снапшота (сборка + trial) с восстановлением.
- Сохранения: `PlumberSave` + санитизация `def` (allowlist видов), `mergeSaves` обобщён без смены поведения water-sort; fallback-защита типов через `getWaterSortSave/getPlumberSave`.
- i18n: ключи `plumber.*` ru/en. Каталог: две карточки. PWA: единый SW, атлас в precache (14 entries).

## 3. Реальные проверки (все PASS)
- `typecheck` PASS; `test` **43/43 PASS** (26 старых + 17 новых: +4 plumber-save).
- `test:levels` **17/17 PASS** (10k+ water-sort + 1200 plumber; дважды). Один повторяющийся ворнинг `vitest-worker Timeout onTaskUpdate` — инфра-артефакт под нагрузкой, не продуктовый (фиксирую честно).
- E2E Playwright **26/26 PASS** (13 desktop + 13 mobile): каталог → tap-поворот (реальный клик, checksum меняется) → undo (checksum возвращается) → hint → solve → вода в полёте (sum>0, volume ok) → WON 3/3 → баннер → уровень 2. Скриншоты: preparing/running/win × mobile/desktop.
- Регрессия «Переливашек»: unit + levels + 24/24 их E2E PASS. Починка их спеков (скоуп селектора карточки) — единственное касание.
- Интеграция графики: `usesFallback=false` в E2E; joints 3×3 — стыки на midlines.
- Баги найдены и исправлены: guard `refreshChrome` до `def`; stale-SW в ручных проверках (убит вчерашний preview); координаты клика + boundingBox в E2E; сериализация функций хука через evaluate.

## 4. Гейт Этапа 2
- Функциональный: **PASS** (игра + E2E на mobile viewport на финал-ассетах).
- Визуальный: **PASS для базовых 8** (интегрированы, скриншоты есть, заглушек в сборке нет). Полный визуал игры (миксеры/декор/коллекции/видео анимаций) — следующие этапы.
- Известно и отложено честно: long-press/drag + pinch/pan камеры (только tap/клавиатура/кнопки); звёзды/адаптация (Этап 3–4); сервер/синхронизация (Этап 5); full-offline PWA-тест plumber; video-записи.

## 5. Следующее
Этап 3 (сложные механики: T/крест уже в ядре портов; клапаны/фильтры/распределители/программы/цвета), затем 4–6. Бюджет генераций остаток: low 11, medium 8.
