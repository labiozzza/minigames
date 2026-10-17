# DEPLOY — PWA + опциональный backend

Правило безопасности: **не менять существующие VPS-сервисы без предварительного
аудита и отдельного разрешения.** Всё ниже — план; в этой ветке ничего на
production не разворачивалось. Обязателен HTTPS (localhost — исключение для
разработки).

## 1. Сборка

```sh
node --version   # 20.19.0 (см. .nvmrc)
npm ci
npm run build            # -> dist/ (release, без test-hooks)
npm run check:release    # гарантия отсутствия hooks/секретов в dist
npm run preview          # http://127.0.0.1:4173/
```

`dist/` можно отдать отдельно, даже если backend живёт на другом домене
(клиент работает офлайн-first и не требует сервера).

## 2. Разделение static PWA / backend

| Слой | Что | Где |
|---|---|---|
| Static PWA | `dist/` (html/js/atlas/sw/manifest) | CDN/nginx/статика, HTTPS |
| Backend (опц.) | `server/` (node:http + pg), auth/sync/challenges/share/config/admin/telemetry | отдельный процесс, HTTPS, `/api` или свой домен |
| DB | PostgreSQL (адаптер `PgStore`; локально — `FileStore`) | управляемый Postgres либо отдельная БД |

`base: './'` — статика работает и из корня, и из подпути. Между PWA и backend
нужен CORS (`MG_CORS_ORIGIN`) и HTTPS с обеих сторон. Клиент к серверу
подключается переменной `VITE_API_BASE` (пусто = чистый офлайн).

### Nginx (static)

```nginx
server {
  listen 443 ssl;
  server_name example.com;
  root /var/www/minigames/dist;

  add_header Service-Worker-Allowed /;
  location / { try_files $uri $uri/ /index.html; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location = /sw.js { add_header Cache-Control "no-cache"; }
}
```

## 3. Backend: Postgres, секреты, миграции

```sh
# локальный тестовый stand
PORT=8787 DATA_DIR=./server-data ADMIN_EMAILS=admin@example.com \
MG_CORS_ORIGIN=https://example.com npx vite-node server/src/main.ts
curl -sS 127.0.0.1:8787/health   # {"ok":true,...}
```

- Postgres: `server/migrations/*.sql` (001 базовый, 002 admin config meta,
  003 analytics/push). Применять по порядку; приложение стартует только после
  успешных миграций.
- Секреты через окружение, **не в репозитории**: OTP/session-ключ, строка
  подключения Postgres, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `ADMIN_EMAILS`.
  Для push внести `VITE_VAPID_PUBLIC_KEY` в клиентскую сборку.
- Клиент-серверные ограничения: строгий CORS, per-IP rate-limit на OTP,
  admin-эндпоинты под ролью `admin`, telemetry только с валидным согласием.

## 4. DNS / HTTPS / тестовый stand

- `example.com` → static PWA; `api.example.com` → backend. TLS (Let's Encrypt),
  HSTS. SW scope `/`.
- Перед prod — **изолированный** stand с той же схемой миграций; на нём
  проверяется health/readiness и протокол sync двумя клиентами.

## 5. Здоровье, smoke, готовность

- `GET /health` — liveness (без авторизации).
- `GET /ready` — readiness (БД доступна). Оба — 200 при готовности.
- Smoke после деплоя (реальный браузер): каталог → обе игры → уровень проходит
  → перезагрузка → прогресс на месте → офлайн-повтор.
- Rollback приложения: предыдущий `dist/` + предыдущий backend-релиз; конфиг —
  `/admin` draft→publish→rollback (immutable history, откат как новая версия).

## 6. Резервные копии

- Postgres: регулярный `pg_dump` + retention; проверка восстановления на
  тестовом stand минимум раз в релиз.
- Проверять, что health/readiness и smoke проходят **после** восстановления.

## 7. Откат релиза

1. Static: вернуть предыдущий `dist/` (версии в CDN/nginx).
2. Backend: предыдущий образ/коммит; аддитивные миграции — без разрушения
   данных (никаких «down»-drop в проде).
3. Конфиг: `/admin` rollback (новая версия на основе прежней).
4. Сейвы клиента: миграции обратимы (бэкап перед миграцией, `readBackupSave`).

## 8. Что в этой ветке НЕ сделано

Production-развёртывание, Postgres, домен/HTTPS, OTP-доставка и live push —
**BLOCKED_EXTERNAL** (нужны доступ/разрешение и ключи). Локально доступны
FileStore-preview и полный серверный тестовый набор (в т.ч. против Postgres
через `PG_URL`).
