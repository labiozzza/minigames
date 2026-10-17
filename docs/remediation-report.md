# Remediation Report (TZ v1.2, §R0–R6)

Ветка: `feat/plumber-tz-v1.1-assetgen`. Дата: 2026-10-17.
Назначение: что изменено относительно исходной приёмки, новая архитектура,
схема хранилища и миграции, тестовые доказательства, оставшиеся ограничения.

## 1. Изменения по коммитам (после baseline)

| Коммит | Раздел | Что сделано |
|---|---|---|
| `8e3f6d2` | §0–1 | AssetGen-конвейер + чистый аудит ядра Plumber |
| `143edb2` | §2 | Игра на финальных ассетах, E2E зелёные |
| `342ae73`,`278801b` | §3–6 | Progression/challenges/share, финализация |
| `08c7771` | R1 P0 | Durable storage, хеш секретов, валидация схемы |
| `6086299` | R2 P0 | Вода внутри канала трубы (геометрия маски) |
| `eef6817` | R1 | Клиент-серверный sync для обеих игр |
| `364a59e` | §- | Короткие share-коды → точный (mode,level) |
| `cbcd733` | §6 | Доказательство генератора/решателя на 10k+ |
| `a1c5ec3` | §5 | Три независимых режима сложности |
| `0c113ad` | §7 | Полное touch/desktop-управление, камера, контекстный UI |
| `f4ba6bd` | §8 | Обучение без чтения (spotlight) |
| `caa2983` | §9 | Тематические коллекции, альбом, живые диорамы |
| `9873194` | §10 | Daily/weekly испытания + серверный манифест |
| `e5d5e8c` | §12 | Доступность, аудио-подсказки, авто-качество, Canvas fallback |
| `33e5294` | §13 | Сейв v3 + миграции с бэкапом, per-game офлайн-кеш, отложенный SW |
| `64f881a` | §14 | Admin: строгая схема, сертифицированный preview, atomic publish, audit, rollback |
| `0e781e8` | §15 | Consent-gated analytics, opt-in push, export/erase data-rights |
| `70947d2` | §16 | Dev-панель, версионированный replay-dump, dev-редактор |
| `8908aea` | §17 | Канонический reconcile AssetGen (реестр/jobs/бюджет/provenance) |
| `0376074` | §19 | .gitignore: python bytecode не коммитится |
| `696d9d0` | §18 | CI-пайплайн, протокол производительности, root-cause фикс флейка |

## 2. Новая архитектура

- **Domain (pure)** `src/games/plumber/domain/` — модель, генератор (9
  семейств), решатель, сертификация witness-реплеем, прогрессия/челленджи.
- **Presentation** `.../presentation/` — Phaser-сцена на атласе, канальная
  вода, маски, частицы, качество/fallback.
- **Platform** `src/platform/` — storage (save v3 + миграции), pwa/offline
  (per-game кеш), settings (a11y/язык/качество/push), telemetry (diag/analytics
  каналы), notifications, sync/engine, api/client, games/registry.
- **Server** `server/src/` — `app.ts` (HTTP), `store.ts`/`pg-store.ts`
  (интерфейс `Store`), `auth.ts`, `validate.ts`, `config-schema.ts`,
  `certify.ts`. Runtime-зависимость — только `pg`; локально — FileStore.
- **Admin** `admin.html` + `src/admin/` — отдельная точка, реальные
  API-вызовы, audit.
- **Dev tools** `src/games/plumber/dev/` — динамически импортируемые модули,
  вырезаются из release (проверяется `check:release`).
- **AssetGen** `.opencode/skills/minigames-assetgen/` — генерация, проверка
  прозрачности, плейсхолдеры, reconcile.

## 3. Схема хранилища (Postgres) и миграции

`server/migrations/`:

- `001_init.sql`: `users`, `sessions`, `otps`, `otp_requests`, `saves`,
  `seen_events`, `shares`, `configs`, `config_drafts`, `config_history`.
- `002_admin_config_meta.sql`: метаданные публикаций конфига (revision/
  checksum/changed, immutable history).
- `003_analytics_push.sql`: `telemetry` (user_id nullable для анонимной
  аналитики), `push_subscriptions`.

Локально те же данные хранит FileStore (`server-data/`). Клиентские сейвы —
`schemaVersion` 3 в `src/platform/storage/save.ts`; миграции v1→v2→v3 пишут
бэкап до изменения (`BACKUP_KEY`, `readBackupSave`/`restoreBackupSave`).

## 4. Тестовые доказательства

- Unit **172/172**, Levels **27/27** (10000 water-sort fails=0 + plumber corpus
  ≥10000), Server **30 + 6 skipped** (pg-тесты под `PG_URL`), E2E **92/92**
  desktop+mobile, AssetGen **6/6**, release-check PASS.
- AssetGen reconcile: повторный прогон `changed: 0`, 11 APPROVED сохранены.
- Офлайн: E2E «полностью офлайн из precache».
- Флейк «Переливашек» устранён по root-cause (см. §6).
- Команда полного прогона и «жёсткие» условия — в `docs/ci/README.md`.

## 5. Производительность и видео

- Сырые данные: `evidence/perf-report-{desktop,mobile}.json`; протокол —
  `docs/performance-protocol.md`. Честно: headless rAF throttled → измеренные
  median/p5 — «пол», реальные устройства **NOT_RUN**.
- Видео: `evidence/video/plumber-{win,valve}-mobile.webm`; скриншоты —
  `evidence/screenshots/`, стадии перелива — `evidence/stages/`.
- Ранняя цифра этапа 6 (60.3 fps, браузерный trial) — `evidence/perf.log`;
  условие отличное от текущих измерений, поэтому не выдаётся за текущее FPS.

## 6. Устранённый флейк (R5/§18)

`pour-stages` (Water Sort). Причина: стадия выводилась из прогресса анимации;
на «голодном» кадре короткое окно `tilt` пропускалось. Фикс: сцена логирует все
пройденные фазы (`SortScene.advanceStage`), тест читает полный лог. Скорость
игры не менялась, ретраи не использовались. Полный прогон 92/92.

## 7. Не зафиксировано / ограничения

- **BLOCKED_EXTERNAL**: production-deploy, Postgres, домен/HTTPS, OTP-доставка,
  live push (VAPID), включение CI-workflow (нужен `workflow`-scope токен).
- **BLOCKED_ASSET**: env-арт (сад/фонтан/дом) — процедурные прототипы.
- **NOT_RUN**: реальные устройства/браузеры, FPS/soak на устройстве.
- **Частично**: клиент↔сервер sync не сшит в проде; серверная проверка
  результата (§55) не реализована; EN-прогон E2E отсутствует.
- Никаких изменений существующих VPS-сервисов, секретов в репозитории или
  бинарных Python-кэшей не допущено.

## 8. Дефекты после ручного плейтеста (правка по факту игры)

Источник: ручной прогон «Водопроводчика» в браузере. Механики не менялись.

- **D1 (P0) Ориентация труб на первом кадре.** Причина: спрайты создавались без
  угла, поворот применялся отложенным `setTimeout(60)`. Фикс: угол и глубина
  задаются при создании (`buildCells`/`rebuildCell`), сцена сигналит о готовности
  через `SceneRefs.onReady` вместо таймера. Проверено: `__PLUMBER__.rots()` ==
  углы спрайтов на первом кадре; `evidence/screenshots/plumber-orientation-fixed.png`.
- **D2 (P0) Игра «зависала» после проигрыша.** Причина: обработчик тапа блокировал
  ввод при `phase !== 'PREPARING'`, а UI предлагал «Запустить воду» из `FAILED`
  (переход `start` из `FAILED` запрещён моделью). Фикс: `fixPipes()` (автоисправление
  при первом тапе) и `retry()` (кнопка «Повторить»), баннер с явными действиями
  «Исправить трубы»/«Повторить»; ввод разблокирован. Проверено в браузере.
- **D3 (P1) Жидкость выглядела плоско.** Фикс: слоистая «объёмная» вода
  (тёмный рефракционный край → тело → ядро → блик → мениск), глубина `bg=0 <
  вода=1 < стекло=2`, плавная доливка (`shownFractions`/`stepWater`, снап при
  reduced-motion). Снапшоты: `plumber-water-midfill.png`, стадии в `evidence/`.
- **D4 (P1) Однообразные уровни.** Причина: путь всегда строился слева-направо
  от левого края к правому. Фикс: `routePath()` выбирает разные пары краёв
  источник/приёмник (лево/право/верх/низ) и рандомные ступенчатые маршруты;
  `buildMixer()` варьирует сетку/ряд/длину звена. Версия генератора поднята до
  `plumber-gen/0.3-diverse` (новое пространство имён; ранее выданные уровни хранят
  собственную дефиницию и по-прежнему воспроизводятся). Добавлен логический
  фингерпринт (`logicalFingerprint`). 10 350 уровней: 0 fallback/unsolvable,
  overlap 3.6%, направления маршрутов распределены по всем краям;
  `evidence/plumber-mass-report.json`, `evidence/plumber-diversity-sample.json`.
- **D5 (P1) Графика препятствий/окружения.** Через канал `chatgpt-subscription`
  сгенерированы 2 кандидата (medium) и зарегистрированы как
  `MANUAL_REVIEW_REQUIRED`: `obstacle_rock`, `env_garden_bush` (VALID_TECH 256²).
  Подключение к сцене и `APPROVED` — после независимого визуального ревью;
  пока в игре остаются процедурные примитивы (гейт §5 открыт). Бюджет
  medium 11→13/16. См. `docs/assetgen-status.md` §7.

Регрессия после правок: typecheck PASS; unit 172/172; levels 28/28
(Water Sort 10 000 fails=0; plumber corpus 10 350); server 30+6s; E2E 92/92
(desktop+mobile); `build`+`check:release` OK; assetgen 6/6.
