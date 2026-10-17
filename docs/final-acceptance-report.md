# Final Acceptance Report — MiniGames («Переливашки» + «Водопроводчик»)

Дата: 2026-10-17. Ветка: `feat/plumber-tz-v1.1-assetgen` (HEAD на момент отчёта).
Вердикт: **READY_FOR_LOCAL_ACCEPTANCE** (обоснование в §9).

## 1. Что реально реализовано
- **Ядро Plumber** `src/games/plumber/domain/`: детерминированная дискретная
  симуляция (rules/2), цвета/конфликты, миксер/фильтр/распределитель, клапаны,
  4 типа получателей, программы, перенос/инвентарь, no-backflow, сохранение
  объёма; генератор 9 семейств (gen/0.2) с сертификацией witness-реплеем;
  решатель; звёзды/адаптация/коллекции/daily/weekly/share (progression).
- **Игра Plumber**: Phaser-сцена на атласе 11 тайлов, tap/клавиатура/кнопки,
  undo/redo, подсказки, программы, выбор уровней со звёздами, альбом 12
  предметов + диорамы, daily/weekly, share link+code, сохранение снапшота,
  dev-панель диагностики/replay/редактора (test-only).
- **Ассеты**: 11/11 APPROVED (VALID_TECH + review + Phaser-интеграция), атлас в
  precache. Единый канонический реестр (§17 reconcile): provenance по каждому
  PNG, jobs/queue синхронизированы, атомарная валидация, idempotent. Бюджет:
  low 13/24, medium 11/16.
- **Сервер** `server/` (local tier, node:http + pg): OTP-auth с ролями,
  sync с идемпотентностью и двумя клиентами, challenges, share, remote-config
  с admin draft→preview→publish→rollback и audit, consent-gated telemetry
  (diag/analytics отдельными каналами) + data-rights export/erase,
  push-подписки (хранение/permissions; доставка pending VAPID).
- **Платформа**: доступность (contrast/large-UI/reduced-motion/flash-free/
  no-drag), качество рендера + WebGL→Canvas fallback, версионирование ассетов и
  миграции сейвов v1→v2→v3 с бэкапом, per-game офлайн-кеш, admin-панель.

## 2. Что было до начала
«Переливашки» (Water Sort): PWA, Phaser 4.2.1, IndexedDB-сейвы, unit/levels/E2E.
Не изменялись по механике (скоуп селекторов E2E под 2 карточки, обобщение
`mergeSaves`, событийный лог стадий анимации для устранения флейка — поведение
сохранено, тесты зелёные). Чужая работа себе не приписывается.

## 3. 69 решений
`docs/requirements-matrix.md`: большинство пунктов **PASS** с доказательствами;
**PARTIAL** — где есть внешняя блокировка или незакрытая часть (49 FPS на
реальном устройстве, 60 push-доставка, 55 серверная проверка результата,
68 этапность); **BLOCKED** — №45 (VPS-deploy: нужно отдельное разрешение).
Дополнительная матрица пунктов TZ v1.2 — в конце того же файла. Массового
переключения в PASS нет: каждая строка имеет реализацию/тест/артефакт.

## 4. Тесты (все запускались, всё реальное; команды воспроизводимы)
| Набор | Команда | Результат |
|---|---|---|
| AssetGen | `python3 -m unittest discover -s .opencode/skills/minigames-assetgen/tests` | 6/6 PASS (в т.ч. reconcile: канонический+idempotent, opaque→rejected, missing→placeholder) |
| Types | `npm run typecheck` | PASS |
| Unit | `npm run test` | 172/172 PASS |
| Levels | `npm run test:levels` | 27/27 PASS (10000 water-sort, fails=0; plumber corpus ≥10000 без fallback/наложений) |
| Server | `npm run test:server` | 30 PASS + 6 skipped (pg-тесты гейтятся `PG_URL`) |
| E2E | `npx playwright test` | **92/92 PASS** desktop+mobile (~3.0 мин), без флейков |
| Release | `npm run build && npm run check:release` | PASS (нет test-hooks/секретов в dist) |
| AssetGen reconcile | `assetgen.py reconcile` дважды | 11 APPROVED сохранены; повторный прогон `changed: 0` |
| Генерации | подписка, `assetgen-work/budget.json` | low 13/24, medium 11/16, платных API-трат 0 |

Историю флейка «Переливашек» (`pour-stages`, animation-timing) — root-cause
найден и устранён: стадия выводится из прогресса анимации, на «голодном» кадре
короткое окно `tilt` могло быть пропущено; теперь сцена логирует **все**
пройденные фазы (`SortScene.advanceStage`), тест не гоняется с rAF. Полный
прогон 92/92, ретраи не использовались. Детали — `docs/performance-protocol.md`.

## 5. Визуальная приёмка и производительность
- PNG: `evidence/screenshots/plumber-{catalog,preparing,running,win}-*`
  (desktop+mobile), `plumber-tiles-11.png`, `plumber-joints-3x3.png`,
  `evidence/stages/stage-{tilt,pour,after}.png`; видео:
  `evidence/video/plumber-{win,valve}-mobile.webm`.
- Протокол и сырые данные: `docs/performance-protocol.md`,
  `evidence/perf-report-{desktop,mobile}.json`. Честно: headless Chromium
  throttl-ит `requestAnimationFrame`, поэтому измеренные median/p5 — «пол», а не
  результат устройства; цели 60/30 FPS **не подтверждены измерением**, реальные
  устройства/браузеры — **NOT_RUN**.
- Офлайн: E2E «полностью офлайн из precache» PASS.
- Пробелы: только эмуляция вьюпортов; EN-прогон E2E не добавлен (RU).

## 6. Совместимость
Регрессия «Переливашек»: unit + levels (10000 уровней) + их E2E PASS; PWA/SW
единый; старые сохранения мигрируют без потерь (backfill + бэкап + тесты).

## 7. Инфраструктура
На VPS не менялось ничего (запрещено без разрешения). Локально: `server/` +
FileStore preview (`server-data/`, 127.0.0.1:8099) либо Postgres через `PG_URL`.
CI-пайплайн подготовлен (`docs/ci/github-workflows-ci.yml`, включая Postgres
service) — включение требует `workflow`-scope токена. Миграций на боевой БД нет
(Postgres не развёрнут). Откат: коммиты по этапам; конфиг — `/admin`
draft→publish→rollback с audit. Healthcheck/план деплоя — `docs/DEPLOY.md`.
Требуют разрешения: production-deploy, Postgres, домен/HTTPS, подключение
клиента к серверу, VAPID-ключи.

## 8. Незакрытое / внешне заблокированное (честно)
1. **BLOCKED_EXTERNAL**: production-deploy VPS/Postgres/домен/HTTPS, OTP-доставка
   и live push (нет VAPID-ключей) — нужен доступ/разрешение.
2. **BLOCKED_ASSET**: env-арт под задачи (сад/фонтан/дом) — процедурные
   прототипы (`data-prototype="1"`), финального арта нет.
3. **NOT_RUN**: реальные Android/iOS/Safari/Firefox; FPS и 10–30 мин soak на
   устройстве; 60/30 FPS не подтверждены измерением.
4. **Частично**: клиент↔сервер sync не сшит (протокол готов с обеих сторон,
   офлайн-first); серверная проверка результата (№55) не реализована; EN-прогон
   E2E не добавлен; video-пакет анимаций неполный (2 webm).

## 9. Вердикт: READY_FOR_LOCAL_ACCEPTANCE
Локально: ядро, графика базы, сохранения/миграции, офлайн, доступность,
telemetry/data-rights, admin, devtools, AssetGen reconcile, CI и регрессия —
реализованы, протестированы и зелёные (unit 172, levels 27, server 30, E2E 92,
assetgen 6). Заглушек в сборке нет, фиктивных PASS нет, механики ТЗ не менялись.
`READY_FOR_PRODUCTION` **не присваивается**: без разрешённого stage/prod-деплоя
и реальных устройств часть проверок объективно `NOT_RUN`/`BLOCKED_EXTERNAL`.
Ранее имевшееся противоречие `stage-06-report` ↔ этот отчёт устранено.
