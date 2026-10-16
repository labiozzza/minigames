# Final Acceptance Report — MiniGames «Водопроводчик»

Дата: 2026-10-17. Ветка: `feat/plumber-tz-v1.1-assetgen`. Вердикт: **PARTIALLY READY** (обоснование в §9).

## 1. Что реально реализовано
- **Ядро** `src/games/plumber/domain/`: дискретная детерминированная симуляция (rules/2), цвета/конфликты, миксер/фильтр/распределитель, динамические клапаны, 4 типа получателей, программы, перенос/инвентарь, no-backflow, сохранение объёма; генератор 9 семейств (gen/0.2) с сертификацией witness-реплеем; решатель; звёзды/адаптация/коллекции/daily/share (progression).
- **Игра**: Phaser-сцена на атласе 11 тайлов, tap/клавиатура/кнопки, undo/redo, подсказки, программы-чипы, выбор уровней со звёздами, альбом 12 предметов, daily, share link+code, сохранения полного снапшота.
- **Ассеты**: 11/11 APPROVED (VALID_TECH + review + Phaser-интеграция), атлас в precache. Бюджет: low 13/24, medium 11/16.
- **Сервер** `server/` (local tier, node:http, 0 deps): OTP-auth, sync с идемпотентностью, challenges, share, config, admin draft/publish/rollback/audit, consent-telemetry. Клиент не подключён (офлайн-first).

## 2. Что было до начала
«Переливашки» (Water Sort): PWA, Phaser 4.2.1, IndexedDB-сейвы, unit/levels/E2E. Не изменялись (кроме скоупа селекторов E2E под 2 карточки и обобщения mergeSaves — поведение сохранено, тесты зелёные). Чужая работа себе не приписывается.

## 3. 69 решений
См. `docs/requirements-matrix.md`: ~41 PASS с доказательствами, ~27 IN_PROGRESS (частично), 1 BLOCKED (№45 VPS-deploy — нужно разрешение). Ключевые PASS: 2,3,4,5,8,9,10,11,14,16,17,24–32,46,53,56–59,61,63–67,69.

## 4. Тесты (все запускались, всё реальное)
| Набор | Команда | Результат |
|---|---|---|
| AssetGen | `python3 -m unittest discover -s .opencode/skills/minigames-assetgen/tests` | 4/4 PASS |
| Types | `npm run typecheck` | PASS |
| Unit | `npm run test` | 67/67 PASS |
| Levels | `npm run test:levels` | 26/26 PASS (10k+ water-sort + ~1800 plumber; дважды; один раз был инфра-ворнинг vitest RPC — не продуктовый) |
| Server | `npm run test:server` | 7/7 PASS |
| E2E | `npx playwright test` (обе игры, все спеки, desktop+mobile) | 30/30 PASS (один флейк animation-timing в pour-stages под нагрузкой: падает 1/3 полных прогонов, изолированно PASS — зафиксировано) |
| Генерации | подписка, `assetgen-work/budget.json` | low 13/24, medium 11/16, платных API-трат 0 |

## 5. Визуальная приёмка
- PNG: `evidence/screenshots/plumber-{catalog,preparing,running,win}-*` (desktop+mobile), `plumber-tiles-11.png`, `plumber-joints-3x3.png`; видео: `evidence/video/plumber-{win,valve}-mobile.webm`.
- FPS: 60.3 (Pixel 7 viewport, running trial). Тик симуляции ~20 мкс. Атлас 11 фреймов/470 КБ; precache 16 entries/2.4 МБ.
- Офлайн: E2E `works fully offline from precache` PASS (найдено и исправлено: atlas.json не было в precache-маске).
- Пробелы: только эмулированные вьюпорты (реальных устройств не было — соответствующие проверки NOT RUN); видео победы/анимаций — 2 webm.

## 6. Совместимость
Регрессия «Переливашек»: unit + levels + 24/24 их E2E PASS; PWA/SW единый; старые сохранения мигрируются без потерь (backfill + тесты).

## 7. Инфраструктура
Изменено: ничего на VPS (запрещено без разрешения). Локально: `server/` + FileStore preview (`server-data/`, 127.0.0.1:8099). Миграций БД нет (Postgres не развёрнут). Rollback: git-коммиты по этапам (`8e3f6d2`, `143edb2`, + этот). Healthcheck/деплой-план — в `docs/DEPLOY.md` (обновить под server/ при разрешении). Требуют разрешения: production-deploy, Postgres, домен/HTTPS, подключение клиента к серверу.

## 8. Незакрытое (честно)
1. Env-арт под задачи (сад/фонтан/дом) — нет (нужен арт-бюджет/решение). 2. Long-press/drag, pinch-камера. 3. Клиент↔сервер интеграция (протокол готов с обеих сторон, не сшит). 4. Production inline-конфиг/мониторинг. 5. Реальные устройства/браузеры (только эмуляция). 6. EN-прохождение E2E (только RU). 7. Полный video-пакет анимаций (2 webm есть). 8. Редактор уровней для разработчика (есть certifyReport + hook; UI-редактора нет).

## 9. Вердикт: PARTIALLY READY
Функциональное ядро, графика базы, сохранения, офлайн, регрессия и серверный протокол — проверены и зелёные. `READY` невозможен: нет production-интеграции (§7), нет env-арта (§8.1), часть UX-механик отложена (§8.2–8). Заглушек в сборке нет, фиктивных PASS нет, механики ТЗ не менялись.
