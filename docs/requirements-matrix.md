# Requirements Matrix — 69 решений (трассировка)

Статус: PENDING по умолчанию. Обновляется после каждого этапа. Легенда: PENDING / IN_PROGRESS / PASS / FAIL / BLOCKED / BLOCKED_ASSET / NOT RUN.

| № | Решение | Кратко | Раздел ТЗ | Реализация | Тест | Статус |
|---:|---|---|---|---|---|---|
| 1 | D | Постепенное развитие игровых механик | 01 §1 | — | — | curriculum+families | PASS |
| 2 | B | Вода запускается игроком после сборки | 01 §1 | src/games/plumber/ | E2E win 26/26 | PASS |
| 3 | D | Вращение → размещение → перемещение/комбинации | 01 §1 | — | — | rotate/pickup/place | PASS |
| 4 | D | От ошибок без штрафов к ресурсным/динамическим испытаниям | 01 §1 | — | — | dynamic+resource trials | PASS |
| 5 | D | Бесконечная генерация уровней | 01 §1 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | IN_PROGRESS |
| 6 | D | Три режима сложности, адаптивность внутри каждого | 01 §1 | — | — | 3 modes adapt stats | PASS |
| 7 | D | Последовательное усложнение условий победы | 01 §1 | — | — | receiver/teardown escalation | PASS |
| 8 | D | Модульная сетка с препятствиями | 01 §- | — | — | blocked obstacles | PASS |
| 9 | C | Источники/получатели: от краёв к внутреннему и множественному размещению | 01 §- | — | — | edge->multi/interior | PASS |
| 10 | C | Классические трубы, клапаны и функциональные элементы | 01 §- | — | — | valve/filter/mixer/distributor | PASS |
| 11 | D | Дискретная логика + качественная независимая визуализация воды | 01 §- | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | IN_PROGRESS |
| 12 | D | Стиль 2.5D с объёмом/прозрачностью | 01 §8 | src/games/plumber/ | 8 базовых approved; миксеры/декор/коллекции в очереди | IN_PROGRESS |
| 13 | D | Гибрид ассетов, масок, частиц и шейдерных эффектов | 01 §8 | — | — | IN_PROGRESS |
| 14 | D | Комбинированное сенсорное/desktop-управление | 01 §- | src/games/plumber/ | E2E desktop+mobile tap | PASS |
| 15 | D | Интерактивное обучение и адаптивные подсказки без чтения | 01 §- | — | — | IN_PROGRESS |
| 16 | D | Уровни, звёзды, статистика, раздельный прогресс | 01 §- | — | — | stars+separate progress | PASS |
| 17 | D | Undo/redo, подсказки, решение и пропуск | 01 §- | src/games/plumber/ | E2E undo+solver/hint unit | PASS |
| 18 | D | Offline-first, автосохранение и облачная синхронизация | 01 §10 | src/games/plumber/ | save/restore ok; полный offline-PWA тест pending | IN_PROGRESS |
| 19 | D | Адаптивная аудиосистема, музыка, звуки, поддерживаемая вибрация | 01 §- | — | — | IN_PROGRESS |
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
| 36 | C | Тематические коллекции и достижения | 01 §- | — | — | IN_PROGRESS |
| 37 | D | 12–16 начальных объектов, расширяемый каталог | 01 §- | — | — | IN_PROGRESS |
| 38 | C | Интерактивный альбом коллекций | 01 §- | — | — | IN_PROGRESS |
| 39 | B | Анимированная диорама за полный альбом | 01 §- | — | — | IN_PROGRESS |
| 40 | C | Единый аккаунт MiniGames | 01 §10 | — | — | OTP server tested | PASS |
| 41 | D | Гость сразу, потом email OTP и привязка | 01 §10 | — | — | guest link server tested | PASS |
| 42 | D | Интеллектуальное слияние прогресса двух устройств | 01 §10 | — | — | IN_PROGRESS |
| 43 | B | Единый модульный backend MiniGames | 01 §10 | — | — | modular server local | PASS |
| 44 | D | Использовать существующий стек; при отсутствии Node/TS/Fastify/Postgres | 01 §10 | — | — | IN_PROGRESS |
| 45 | D | Безопасное изолированное развёртывание на существующем VPS | 01 §- | — | — | BLOCKED |
| 46 | D | Игровые модули с единым plugin-контрактом | 01 §- | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 47 | D | Контролируемые обновления, миграции и откат | 01 §10 | — | — | IN_PROGRESS |
| 48 | D | Гибридный ленивый кэш и полная загрузка игр офлайн | 01 §10 | src/games/plumber/ | атлас в precache; ленивые чанки позже | PASS |
| 49 | D | Автоадаптация графики, цели 60/30 FPS | 01 §- | — | — | IN_PROGRESS |
| 50 | D | Полная многоуровневая приёмка с доказательствами | 01 §- | — | — | IN_PROGRESS |
| 51 | D | Инструменты диагностики, replay, редактор для разработчика | 01 §- | — | — | IN_PROGRESS |
| 52 | D | Аналитика с минимизацией данных/согласием | 01 §- | — | — | IN_PROGRESS |
| 53 | D | Расширяемая локализация, сначала RU/EN | 01 §- | — | — | ru/en | PASS |
| 54 | D | Комплексная доступность, общая и игровая | 01 §- | — | — | IN_PROGRESS |
| 55 | D | Гибридная серверная проверка результатов | 01 §10 | — | — | IN_PROGRESS |
| 56 | C | Обмен уровнями по deep link и короткому коду | 01 §- | — | — | link+code | PASS |
| 57 | A | Нет пользовательского редактора, только генератор | 01 §- | — | — | no user editor | PASS |
| 58 | C | Ежедневные и еженедельные общие испытания | 01 §- | — | — | UTC daily/weekly | PASS |
| 59 | D | Единый UTC-календарь и офлайн-кэш задач | 01 §- | — | — | UTC+cache | PASS |
| 60 | D | Необязательные push и внутриигровые уведомления | 01 §- | — | — | IN_PROGRESS |
| 61 | D | Сейчас бесплатно и без рекламы, монетизация лишь точка расширения | 01 §- | — | — | free no ads | PASS |
| 62 | D | Админ-панель с черновиками, проверкой, версиями и откатом | 01 §- | — | — | IN_PROGRESS |
| 63 | D | Гибридный конвейер графических ассетов; без заглушек при сдаче | 01 §8 | src/games/plumber/ | 8/8 APPROVED, usesFallback=false | PASS |
| 64 | B | Замкнутые контуры без бесконечной циркуляции | 01 §5 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 65 | B | Одинаковые жидкости объединяются, разные конфликтуют вне смесителя | 01 §5 | — | src/games/plumber/domain/ | tests/unit/plumber-domain.test.ts + tests/levels/plumber-mass.test.ts (1200/1200 WON, volume ok) | PASS |
| 66 | D | Постепенное развитие управления источниками | 01 §- | — | — | single->multi->program | PASS |
| 67 | B | Визуальная программа из последовательных команд, без таймлайна | 01 §- | — | — | visual program | PASS |
| 68 | C | Этапность при обязательной реализации всех функций | 01 §- | — | — | IN_PROGRESS |
| 69 | D | Автономная работа OpenCode со строгими стоп-правилами | 01 §- | — | — | autonomous log | PASS |
