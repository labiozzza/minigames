# Stage 1 Report — Аудит, контракт, чистое ядро (IN PROGRESS → CORE PASS)

Дата: 2026-10-16. Ветка: `feat/plumber-tz-v1.1-assetgen`.

## 1. Аудит (готов)
- `docs/architecture-audit.md` — фактические пути, версии (Phaser 4.2.1, Vite 6, Vitest 3), точки интеграции, риски R1–R6, исходные проверки.
- Backend отсутствует (нет `server/`): резервный стек только на Этапе 5, изолированно.
- Контракт `GameModule` уже минимален — plumber адаптируется аддитивно, без ломки water-sort.

## 2. Чистое ядро (реализовано, без Phaser/DOM)
- `src/games/plumber/domain/prng.ts` — xmur3/mulberry32/seedFor (детерминизм, без Math.random).
- `src/games/plumber/domain/model.ts` — LevelDefinition/RuntimeState/команды (Rotate/Start/Pause/Resume/Stop/Restart/Step), порты с поворотом 0/90/180/270, фиксированный tick (snapshot→reserve→atomic apply), целочисленные порции, равномерное деление со стабильным порядком портов, вместимость 4/труба, источники/получатели-накопители с автозакрытием, явные утечки-стоки, закон сохранения объёма, restart с сохранением сборки, checksum реплея.
- `src/games/plumber/domain/generator.ts` — Manhattan-путь source(слева)→receiver(справа), straight/elbow, дистракторы, скрамбл с witness, сертификация реплеем через официальную модель + анти-тривиальность, fallback-уровень, бюджет 32 попытки.
- `src/games/plumber/domain/solver.ts` — `verifyWitness` (независимый реплей), `solveSmall` (BFS ≤7 клеток, bounded 50k), `hintFromWitness`.
- Охват Stage 1: одноцветный базовый subset. Цвета/смесители/фильтры/клапаны-динамика/программы — Этап 3 (порты и типы уже заложены).

## 3. Реальные тесты (все PASS, ни одного фиктивного)
- `npm run typecheck` — PASS.
- `npm run test` — **39/39 PASS** (26 water-sort без регрессии + 13 новых plumber: порты, победа/сохранение объёма, запрет поворотов в RUNNING/мокрых труб, restart, детерминизм, snapshot/restore, batch 60 уровней, воспроизводимость seed, solveSmall).
- `npx vitest run tests/levels/plumber-mass.test.ts` — **1200/1200 уровней сертифицированы** (3 режима × 400 seeds): witness→WON, объём сошёлся, регенерация байт-идентична, скрамбл нетривиален. Время ~20с.
- `npm run build` — PASS (PWA precache 13 entries).
- `test:e2e` (Playwright) — NOT RUN на этом шаге (Этап 2/6); `test:levels` water-sort — NOT RUN (не затронут, регрессия — Этап 6).

## 4. Гейт Этапа 1
- Генерируемые базовые уровни доказуемо решаются — ДА (1260 свидетельств суммарно).
- Симуляция воспроизводима без браузера — ДА (checksum, snapshot/restore).
- Прежние игры запускаются — ДА (typecheck+unit+build без регрессии; E2E отложен честно).
- Вердикт: **CORE PASS**, полный гейт с E2E — на Этапе 6. Матрица обновлена точечно (IN_PROGRESS с доказательствами).

## 5. Следующее (Этап 2)
Phaser-сцена на PLACEHOLDER-фолбэке, управление tap/long-press/мышь/клавиатура, запуск/пауза/победа/подсказки, автосохранение; визуальный гейт остаётся `BLOCKED_ASSET` до финальных спрайтов.
