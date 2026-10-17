# AssetGen Status — MiniGames «Водопроводчик»

Дата: 2026-10-16. Skill: `.opencode/skills/minigames-assetgen/SKILL.md`. Агент: `.opencode/agents/assetgen.md`. CLI: `.opencode/skills/minigames-assetgen/scripts/assetgen.py`.

## 1. Провайдер GPT Image

- `OPENAI_API_KEY`: **отсутствует** (проверено через env, значение не извлекалось).
- Python-пакет `openai`: **не установлен** (только `Pillow 12.3.0`).
- Платных запросов: **0** (флаг `--allow-paid` не использовался; запрет ТЗ соблюдён).
- Вывод: генерация финальной графики **недоступна**. Статус провайдера — `WAITING_FOR_PROVIDER`. Повторная проверка — при каждом запуске, без фоновых обещаний (scheduler не настроен).

## 2. Очередь заявок (`assetgen-work/jobs/`)

| asset_id | kind | статус | attempts | placeholder | tech QA |
|---|---|---|---|---|---|
| pipe_straight | pipe-straight | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/pipe_straight.png` | VALID_TECH |
| pipe_elbow | pipe-elbow | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/pipe_elbow.png` | VALID_TECH |
| pipe_t | pipe-t | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/pipe_t.png` | VALID_TECH |
| pipe_cross | pipe-cross | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/pipe_cross.png` | VALID_TECH |
| pipe_cap | pipe-cap | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/pipe_cap.png` | VALID_TECH |
| valve_basic | valve-basic | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/valve_basic.png` | VALID_TECH |
| source_basic | source-basic | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/source_basic.png` | VALID_TECH |
| receiver_basic | receiver-basic | WAITING_FOR_PROVIDER | 0 | `assetgen-work/placeholders/receiver_basic.png` | VALID_TECH |

Исходные request JSON: `/tmp/plumber_requests/*.request.json` (8 шт., `style_id=plumber_2_5d_v1`, `safe_padding_px=12`). При получении ключа перенести в репозиторий `assetgen-work/requests/` и повторить `process --allow-paid` только с явного разрешения.

## 3. PLACEHOLDER-заглушки

- Комплект из ТЗ: `assets/_placeholder/plumber/` — 8 PNG + 8 `.meta.json` (`is_placeholder=true`, статус `PLACEHOLDER`, dev-бейдж `TMP`). **Не финальная графика.**
- Сгенерированные CLI: `assetgen-work/placeholders/*.png` — 8/8, все `VALID_TECH` при проверке `transparent_check` с корректными `port_mask` (углы прозрачные, padding 12, порты достигают края).
- Разделение: финальные ассеты (`APPROVED`, отсутствуют) и заглушки (`PLACEHOLDER`) хранятся раздельно. Loader Phaser (Этап 2) обязан выбирать fallback без смены логических ID.

## 4. Проверки (реальные команды, PASS)

- `python3 -m unittest discover -s .opencode/skills/minigames-assetgen/tests -v` — 4/4 PASS.
- `validate --file assets/_placeholder/plumber/pipe_straight.png --ports-json .../pipe_straight.request.json` — `VALID_TECH`, флагов нет.
- `submit` × 8 → `REQUESTED`; `process` × 8 (без `--allow-paid`, без ключа) → `WAITING_FOR_PROVIDER` + placeholder. Поведение соответствует `03_ASSETGEN_AGENT_SPEC.md` §10 п.6.
- Сводка: `approved=0, placeholder=8, waiting=8, rejected=0, blocked=0`.

## 5. Визуальный гейт

`BLOCKED_ASSET`: финальных 2.5D-ассетов нет, style/Phaser-интеграция не пройдена. По регламенту §7.1 п.5 разрешено идти к независимым этапам 3–5 на примитивах; этап 6 и `READY` запрещены до замены всех примитивов и визуальной приёмки. Финальный релиз с `PLACEHOLDER` запрещён.

## 6. Следующие действия (без платных вызовов)

1. Этап 2: подключить `assets/_placeholder/plumber/` к Phaser-сцене через fallback-loader с dev-бейджем.
2. При появлении `OPENAI_API_KEY` + бюджет + разрешение: `pip install openai`, `process --allow-paid` по очереди, затем tech→vision→Phaser-integration gate (только после этого `APPROVED`).
3. Смесители, разделённые каналы, декор, 12–16 коллекционных предметов — заявки после утверждения StyleBible человеком (не из случайных генераций).

## 7. Field art — Round 2 P3 (2026-10-18)

Визуальный гейт пройден через vision-ревьюер (превью-листы при реальных размерах 64/96 px) и снимки реальной Phaser-сцены. Все ассеты `APPROVED`, подключены к атласу и сцене.

| asset_id | kind | статус | файл (tile) | превью |
|---|---|---|---|---|
| `obstacle_rock` | obstacle-block | APPROVED | `assets/plumber/tiles/obstacle_rock.png` | p3-preview-sheet.png |
| `env_garden_bush` | environment-decor (угол пустой ячейки, декор) | APPROVED | `assets/plumber/tiles/env_garden_bush.png` | p3-preview-sheet.png |
| `obstacle_rocks` | obstacle-block (группа камней) | APPROVED | `assets/plumber/tiles/obstacle_rocks.png` | p3-preview-sheet2.png |
| `obstacle_mound` | obstacle-block (земляной холм) | APPROVED | `assets/plumber/tiles/obstacle_mound.png` | p3-preview-sheet2.png |
| `env_ground` | environment-ground (почва) | APPROVED | `assets/plumber/tiles/env_ground.png` | p3-preview-sheet2.png |

- Бюджет: `medium_used` 13 → 16 из 16 (`budget.json`); low без изменений (0 новых).
- Кандидаты `obstacle_rock`, `env_garden_bush` (ранее `MANUAL_REVIEW_REQUIRED`) подтверждены визуально и переведены в `APPROVED`.
- Атлас пересобран детерминированно: `python3 tools/build_atlas.py` (16 кадров, `public/assets/plumber/atlas.{png,json}`). Превью-листы и экраны сцены — `evidence/screenshots/p3-*.png`.
- Интеграция Phaser: земля — `TileSprite(env_ground)` под полем; `blocked` → вариант камня (детерминированно по индексу ячейки); `empty` → земля без маркеров + угол-декор; `locked` → бейдж-замок; серые круги/красные полосы убраны.
