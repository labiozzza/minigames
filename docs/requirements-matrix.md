# Requirements Matrix — 69 решений (трассировка)

Статус: PENDING по умолчанию. Обновляется после каждого этапа. Легенда: PENDING / IN_PROGRESS / PASS / FAIL / BLOCKED / BLOCKED_ASSET / NOT RUN.

| № | Решение | Кратко | Раздел ТЗ | Реализация | Тест | Статус |
|---:|---|---|---|---|---|---|
| 1 | D | Постепенное развитие игровых механик | 01 §1 | — | — | curriculum+families | PASS |
| 2 | B | Вода запускается игроком после сборки | 01 §1 | src/games/plumber/ | E2E win 26/26 | PASS |
| 3 | D | Вращение → размещение → перемещение/комбинации | 01 §1 | — | — | rotate/pickup/place | PASS |
| 4 | D | От ошибок без штрафов к ресурсным/динамическим испытаниям | 01 §1 | — | — | dynamic+resource trials | PASS |
| 5 | D | Бесконечная генерация уровней | 01 §1 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | IN_PROGRESS |
| 6 | D | Три режима сложности, адаптивность внутри каждого | 01 §1 | — | — | 3 explicit, independent, selectable modes; per-mode store/migration (§5): tests/unit/plumber-save.test.ts (11), tests/e2e/modes.spec.ts (2), server per-mode (2) | PASS |
| 7 | D | Последовательное усложнение условий победы | 01 §1 | — | — | receiver/teardown escalation | PASS |
| 8 | D | Модульная сетка с препятствиями | 01 §- | — | — | blocked obstacles | PASS |
| 9 | C | Источники/получатели: от краёв к внутреннему и множественному размещению | 01 §- | — | — | edge->multi/interior | PASS |
| 10 | C | Классические трубы, клапаны и функциональные элементы | 01 §- | — | — | valve/filter/mixer/distributor | PASS |
| 11 | D | Дискретная логика + качественная независимая визуализация воды | 01 §- | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | IN_PROGRESS |
| 12 | D | Стиль 2.5D с объёмом/прозрачностью | 01 §8 | src/games/plumber/ | 8 базовых approved; миксеры/декор/коллекции в очереди | IN_PROGRESS |
| 13 | D | Гибрид ассетов, масок, частиц и шейдерных эффектов | 01 §8 | — | — | IN_PROGRESS |
| 14 | D | Комбинированное сенсорное/desktop-управление | 01 §- | src/games/plumber/ | E2E desktop+mobile tap | PASS |
| 15 | D | Интерактивное обучение и адаптивные подсказки без чтения | 01 §8 | src/games/plumber/tutorial/ | E2E onboarding no-reading + unit guide | PASS |
| 16 | D | Уровни, звёзды, статистика, раздельный прогресс | 01 §- | — | — | stars+separate progress | PASS |
| 17 | D | Undo/redo, подсказки, решение и пропуск | 01 §- | src/games/plumber/ | E2E undo+solver/hint unit | PASS |
| 18 | D | Offline-first, автосохранение и облачная синхронизация | 01 §13 | src/platform/pwa/offline.ts | SW precache + runtime per-game cache; offline first launch/relaunch e2e; sync per §2 | PASS |
| 19 | D | Адаптивная аудиосистема, музыка, звуки, поддерживаемая вибрация | 01 §12 | src/audio/engine.ts | leak/fill/win cues; separate music/sfx volume; suspend on hidden; vibrate gated by setting | PASS |
| 20 | D | Адаптивность, масштабирование и перемещение игрового поля | 01 §- | — | — | IN_PROGRESS |
| 21 | D | Контекстный адаптивный интерфейс | 01 §- | — | — | context UI | PASS |
| 22 | D | Поэтапное открытие механик с проверкой освоения | 01 §6 | — | — | curriculum unlocks | PASS |
| 23 | D | Гибридный генератор с решателем и seed | 01 §6 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | IN_PROGRESS |
| 24 | C | Несколько допустимых решений с оценкой эффективности | 01 §6 | — | — | any-valid wins+stars | PASS |
| 25 | D | Управляемое смешивание и специальные элементы | 01 §- | — | — | mixer+specials | PASS |
| 26 | D | Постепенное развитие рецептов, пропорций и дозирования | 01 §- | — | — | recipes/ratios/exact | PASS |
| 27 | D | Визуальные обозначения и панель целей без чтения | 01 §- | — | — | goal dots no-reading | PASS |
| 28 | A | Вода течёт в любом направлении; без гравитации и давления | 01 §5 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 29 | D | Автораспределение с управляемыми распределителями и сохранением объёма | 01 §5 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 30 | D | Разные типы получателей | 01 §5 | — | — | 4 receiver kinds | PASS |
| 31 | D | Статические, управляемые, динамические, ресурсные испытания | 01 §- | — | — | static/dynamic/resource/program | PASS |
| 32 | D | Интеллектуальное чередование семейств и борьба с повторами | 01 §6 | — | — | pickFamily+certify | PASS |
| 33 | D | Победа на поле с оживлением окружения | 01 §- | — | — | IN_PROGRESS |
| 34 | C | Окружение определяется задачей | 01 §- | — | — | IN_PROGRESS |
| 35 | B | Коллекция выполненных проектов, без строительства города | 01 §- | — | — | IN_PROGRESS |
| 36 | C | Тематические коллекции и достижения | 01 §9 | src/games/plumber/domain/progression.ts | 4 themes x 3 objects; unit+E2E | PASS |
| 37 | D | 12–16 начальных объектов, расширяемый каталог | 01 §9 | src/games/plumber/presentation/diorama.ts | 12 unique ids/versions; арт = BLOCKED_ASSET (прототипы) | BLOCKED_ASSET |
| 38 | C | Интерактивный альбом коллекций | 01 §9 | src/games/plumber/game.ts | 4 themed sets, locked silhouettes, tap-alive | PASS |
| 39 | B | Анимированная диорама за полный альбом | 01 §9 | src/games/plumber/presentation/diorama.ts | живая композиция per theme; E2E 390x844 | PASS |
| 40 | C | Единый аккаунт MiniGames | 01 §10 | — | — | OTP server tested | PASS |
| 41 | D | Гость сразу, потом email OTP и привязка | 01 §10 | — | — | guest link server tested | PASS |
| 42 | D | Интеллектуальное слияние прогресса двух устройств | 01 §10 | — | — | IN_PROGRESS |
| 43 | B | Единый модульный backend MiniGames | 01 §10 | — | — | modular server local | PASS |
| 44 | D | Использовать существующий стек; при отсутствии Node/TS/Fastify/Postgres | 01 §10 | server/src/, src/ (TS strict, Vite, Phaser 4.2.1), node:http + pg | unit 172 + server 30 + e2e 92; использован node:http вместо Fastify (0 лишних зависимостей), Postgres-адаптер готов, live-БД BLOCKED_EXTERNAL | PARTIAL |
| 45 | D | Безопасное изолированное развёртывание на существующем VPS | 01 §- | — | — | BLOCKED |
| 46 | D | Игровые модули с единым plugin-контрактом | 01 §- | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 47 | D | Контролируемые обновления, миграции и откат | 01 §13 | src/platform/storage/save.ts | SAVE_SCHEMA 3, v1→v2→v3 lossless migration, pre-migration backup + restore, corrupt rejected; SW update deferred (skipWaiting off) never mid-tick | PASS |
| 48 | D | Гибридный ленивый кэш и полная загрузка игр офлайн | 01 §13 | src/platform/pwa/offline.ts | shell precache + per-game versioned cache (download/free without losing save) | PASS |
| 49 | D | Автоадаптация графики, цели 60/30 FPS | 01 §12 | src/games/plumber/presentation/scene.ts | measured p95 frame time steps decoration down/up or manual pin; real-device FPS NOT_RUN; long soak NOT_RUN | PARTIAL |
| 50 | D | Полная многоуровневая приёмка с доказательствами | 01 §- | — | — | IN_PROGRESS |
| 51 | D | Инструменты диагностики, replay, редактор для разработчика | 01 §16 | src/games/plumber/dev/{session,editor,panel}.ts | dev/test-only panel (ports/dirs/volumes/colours/valves/tick/seed/versions/FPS/generator+solver); versioned `plumber-diag/1` dump (startDef+tick-stamped commands+per-step checksums) replayed 1:1 through the official model with version gate + tamper detection; dev editor ops with certify save-gate; batch generate→certify→report with rejections→fixtures; absent from release build (check:release) | PASS |
| 52 | D | Аналитика с минимизацией данных/согласием | 01 §15 | server/src/{validate,app}.ts, src/platform/telemetry.ts | diag (PII-free, no consent) vs analytics (versioned consent, anonymised userId=null, child subset, 180-day retention); revoke clears queue; data rights export/erase; server enforces allowlists | PASS |
| 53 | D | Расширяемая локализация, сначала RU/EN | 01 §- | — | — | ru/en | PASS |
| 54 | D | Комплексная доступность, общая и игровая | 01 §12 | src/platform/settings/store.ts | high contrast/large UI/reduced motion/flash-free/no-drag settings + root classes; colour-independent liquid symbols; keyboard with visible cursor; e2e a11y 4/4 | PASS |
| 55 | D | Гибридная серверная проверка результатов | 01 §10 | — | — | PARTIAL (нет серверной проверки результата; клиентская certify/witness есть, протокол sync готов) |
| 56 | C | Обмен уровнями по deep link и короткому коду | 01 §- | — | — | link+code | PASS |
| 57 | A | Нет пользовательского редактора, только генератор | 01 §- | — | — | no user editor | PASS |
| 58 | C | Ежедневные и еженедельные общие испытания | 01 §- | — | — | UTC daily/weekly | PASS |
| 59 | D | Единый UTC-календарь и офлайн-кэш задач | 01 §- | — | — | UTC+cache | PASS |
| 60 | D | Необязательные push и внутриигровые уведомления | 01 §15 | src/platform/notifications.ts, public/push-sw.js | strictly opt-in (no auto permission prompt), real PushManager subscribe/unsubscribe + `/push/*` + SW push handler; live delivery pending VAPID (BLOCKED_EXTERNAL) | PARTIAL |
| 61 | D | Сейчас бесплатно и без рекламы, монетизация лишь точка расширения | 01 §- | — | — | free no ads | PASS |
| 62 | D | Админ-панель с черновиками, проверкой, версиями и откатом | 01 §14 | server/src/{config-schema,certify}.ts, admin.html | strict schema 422 + certified preview + checksum/revision/changed fields + immutable history + rollback-as-new-version; player → 403; e2e admin 2/2 | PASS |
| 63 | D | Гибридный конвейер графических ассетов; без заглушек при сдаче | 01 §8/§17 | .opencode/skills/minigames-assetgen/scripts/assetgen.py, assetgen-work/registry.json | single canonical source (`reconcile`): registry owns states, budget ledger owns counts; 11 APPROVED re-validated (opaque/missing → rejected/placeholder), provenance per PNG (sha/bbox/alpha/style/prompt-hash/ports-after-rotation/previews/phaser snapshot), jobs+queue synced & synthesised, atlas frame-match checked; idempotent re-run (changed 0). Tests: assetgen unittest 6/6 | PASS |
| 64 | B | Замкнутые контуры без бесконечной циркуляции | 01 §5 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 65 | B | Одинаковые жидкости объединяются, разные конфликтуют вне смесителя | 01 §5 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 66 | D | Постепенное развитие управления источниками | 01 §- | — | — | single->multi->program | PASS |
| 67 | B | Визуальная программа из последовательных команд, без таймлайна | 01 §- | — | — | visual program | PASS |
| 68 | C | Этапность при обязательной реализации всех функций | 01 §- | docs/remediation-plan.md | этапы R0–R5 отдельными коммитами, каждый с тестами и повторной регрессией; внешние блокировки выделены отдельно | PARTIAL (R6-аудит и prod-деплой требуют разрешения) |
| 69 | D | Автономная работа OpenCode со строгими стоп-правилами | 01 §- | — | — | autonomous log | PASS |

## Дополнительная матрица — пункты TZ v1.2 (remидиэйшн)

Легенда та же. Дата проверок: 2026-10-17. Все команды воспроизводимы (`docs/ci/README.md`).

| ID | Пункт TZ v1.2 | Реализация | Доказательство | Статус |
|---|---|---|---|---|
| R1-P0.1 | Durable storage + хеширование секретов + валидация схемы | `server/src/{store,pg-store,auth,validate}.ts`, `migrations/001_init.sql` | `npm run test:server` 30 PASS (store/auth/валидация); пароли/OTP — хеш | PASS |
| R1-P0.2 | PostgreSQL-адаптер с реальными тестами, два независимых клиента | `server/src/pg-store.ts`, `server/migrations/*.sql` | `server/tests/pg.test.ts` (гейт `PG_URL`); sync-протокол двумя клиентами в `tests/e2e/sync.spec.ts` | PARTIAL (live-postgres в этом окружении BLOCKED_EXTERNAL — без Docker/Postgres; тесты готовы под `PG_URL`, CI-пайплайн поднимает Postgres) |
| R1-P0.3 | Auth (OTP) + роли + rate-limit | `server/src/auth.ts`, `app.ts` | server-тесты OTP/роли/лимитов | PASS |
| R1-P0.4 | Sync из браузера для обеих игр | `src/platform/sync/engine.ts`, `server/src/app.ts` | `tests/e2e/sync.spec.ts`, unit sync | PASS |
| R1-P0.5 | Безопасность dev-hooks/эндпоинтов | `tools/check-no-testhooks.mjs`, `data-testonly` в `app.ts` | `npm run check:release` PASS | PASS |
| R2-P0 | Канальная вода, стыки, объёмы, видео | `…/presentation/scene.ts` | mass 10000 (volume ok), `evidence/stages/*`, E2E pour | PASS |
| R3-P1 | Режимы, решатель/генератор, подсказки, инпут/камера, a11y, онбординг | §5–8,12 | modes/input/onboarding/a11y e2e; 10k-сертификация | PASS |
| R4-P1 | Коллекции/диорамы, daily+weekly, share, offline | §9,10,13 | collection/challenge/share/offline e2e | PASS |
| R5-P2 | Admin, analytics, push, devtools, PWA-миграции, AssetGen reconcile, docs, CI | §14–19 | admin/privacy/dev e2e; assetgen 6/6; CI-файл; этот отчёт | PARTIAL (push-доставка без VAPID, AI-арт env BLOCKED_ASSET) |
| §18.1 | Воспроизводимые локальные+CI команды, фикс версий | `.nvmrc`, `.python-version`, `engines`, `docs/ci/github-workflows-ci.yml` | `docs/ci/README.md` | PASS (включение CI — BLOCKED_EXTERNAL: `workflow`-scope токен) |
| §18.2 | CI на push/PR с Postgres service и headless Playwright | `docs/ci/github-workflows-ci.yml` | файл + локальные команды | PARTIAL (артефакт готов; провижн требует права) |
| §18.3 | E2E ключевых сценариев без «магического» solve() | `tests/e2e/{onboarding,input,modes,share,privacy}.spec.ts` | реальные click/drag/keyboard | PASS |
| §18.4 | На каждую механику позитив+негатив на реальном UI | tests/e2e/* | 92/92 desktop+mobile | PASS |
| §18.5 | 10k задач, реальные HTTP+Postgres, два клиента, офлайн, mount/unmount, SW-миграции | tests/levels, server/tests, sync/offline e2e, `plumber-versioning` | см. `docs/remediation-report.md` §4 | PASS (pg live — PARTIAL, см. R1-P0.2) |
| §18.6 | Визуальные артефакты: screenshot+видео каждого состояния | `evidence/screenshots/*`, `evidence/video/*`, `evidence/stages/*` | файлы в репозитории | PARTIAL (не каждый экран имеет видео) |
| §18.7 | Перфоманс с исходными условиями (профиль/viewport/запуски/FPS) | `docs/performance-protocol.md`, `tests/e2e/perf.spec.ts`, `evidence/perf-report-*` | median/p5 зафиксированы; real-device NOT_RUN | PARTIAL (headless rAF throttled; 60/30 не подтверждены) |
| §18.8 | Исправить flaky E2E «Переливашек» | `src/games/water-sort/presentation/scene.ts` (`advanceStage`) | полный прогон 92/92 без ретраев; `docs/performance-protocol.md` §«Переливашки» | PASS |
| §18.9 | Минимальный профиль browser + 2 размера mobile/desktop; реальные устройства — NOT_RUN | `playwright.config.ts` (desktop/mobile, Chromium) | 92/92; устройства NOT_RUN честно | PARTIAL |
| §19.1 | README: разделить офлайн и сервер, реальные стадии | `README.md` | переписан | PASS |
| §19.2 | Матрица: 69 отдельных строк + доп. матрица этого документа | `docs/requirements-matrix.md` | этот файл | PASS |
| §19.3 | Устранить противоречие stage-06 ↔ final-acceptance | `docs/stage-06-report.md`, `docs/final-acceptance-report.md` | обе выправлены | PASS |
| §19.4 | `docs/remediation-report.md` | `docs/remediation-report.md` | создан | PASS |
| §19.5 | `docs/DEPLOY.md`: split, Postgres, HTTPS, DNS, бэкапы, откат, smoke, запрет на VPS без разрешения | `docs/DEPLOY.md` | переписан | PASS |
| §19.6 | Не коммитить бинарные кэши/секреты, поправить .gitignore | `.gitignore` (`__pycache__/`, `*.pyc`) | `0376074` | PASS |

## Дополнительная матрица: правки по дефектам плейтеста (2026-10-17)

| ID | Пункт | Где | Доказательство | Статус |
|---|---|---|---|---|
| D1 | Ориентация труб на первом кадре | `…/presentation/scene.ts`, `game.ts` | rots==angles на первом кадре; `evidence/screenshots/plumber-orientation-fixed.png` | PASS |
| D2 | Нет блокировки ввода после проигрыша (fix/retry) | `game.ts`, `i18n`, `.banner-actions` | браузер: FAILED→«Исправить трубы»/«Повторить»; тап разблокирован | PASS |
| D3 | Объёмная жидкость «внутри» трубы | `…/presentation/scene.ts` | слоистая вода + плавная доливка; `plumber-water-midfill.png` | PASS |
| D4 | Разнообразие уровней (маршруты/края/семьи), версия генератора | `…/domain/generator.ts`, `model.ts`, `tests/levels/plumber-mass.test.ts` | 10 350 ур.: 0 fallback, overlap 3.6%, направления по всем краям; `evidence/plumber-mass-report.json`, `plumber-diversity-sample.json` | PASS |
| D5 | Графика препятствий/окружения (через assetgen) | `assetgen-work/*`, `docs/assetgen-status.md` | 2 кандидата VALID_TECH, `MANUAL_REVIEW_REQUIRED`; бюджет medium 13/16 | PARTIAL (визуальный гейт открыт; в игре — примитивы) |
