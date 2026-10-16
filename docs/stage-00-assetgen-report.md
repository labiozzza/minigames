# Stage 0 Report — AssetGen установка и проверка

Дата: 2026-10-16. Ветка: `feat/plumber-tz-v1.1-assetgen`.

## Выполнено
1. Архив `MiniGames_Plumber_OpenCode_TZ_v1.1_AssetGen.zip` распакован в `/tmp/plumber_tz` (не поверх репозитория).
2. В корень перенесены `01_TECHNICAL_SPEC_PLUMBER.md`, `02_OPENCODE_EXECUTION_RULES.md`, `03_ASSETGEN_AGENT_SPEC.md` (прочитаны полностью).
3. Установлены `.opencode/skills/minigames-assetgen/` (SKILL.md, scripts/assetgen.py, tests, examples, requirements) и `.opencode/agents/assetgen.md` — чужих настроек не было, глобальные не затронуты.
4. `assets/_placeholder/plumber/` — 8 PNG + 8 meta (`is_placeholder=true`).
5. Очередь `assetgen-work/`: 8 заявок (pipe_straight/elbow/t/cross/cap, valve_basic, source_basic, receiver_basic), все `WAITING_FOR_PROVIDER`.

## GPT Image API
- `OPENAI_API_KEY` отсутствует, пакета `openai` нет, платных вызовов **0**. Флаг `--allow-paid` не использовался.
- Статус: генерация недоступна → работа на PLACEHOLDER, заявки в очереди (регламент §7). Повторная проверка при каждом запуске; фонового scheduler нет.

## Реальные тесты (PASS)
- `python3 -m unittest discover -s .opencode/skills/minigames-assetgen/tests -v` — **4/4 PASS**.
- `validate pipe_straight.png --ports-json` — **VALID_TECH**, флагов нет.
- `submit ×8` → REQUESTED; `process ×8` (без ключа, без `--allow-paid`) → **WAITING_FOR_PROVIDER** + placeholder. Поведение по `03_ASSETGEN_AGENT_SPEC.md` §10 п.6.
- Все 16 PNG (8 из комплекта + 8 CLI) — **VALID_TECH** с корректными port_mask.
- Сводка: `approved=0, placeholder=8, waiting=8, rejected=0, blocked=0`. Визуальный гейт этапа 2 — `BLOCKED_ASSET`.

## Файлы
- `docs/assetgen-status.md` — полный реестр и статусы.
- `docs/decision-log.md` D1–D7.
