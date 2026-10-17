# DEPLOY — публикация статики

Сборка — набор статических файлов, backend не нужен. Обязателен HTTPS
(localhost допустим для разработки).

## Сборка

```sh
node --version   # >= 20.19
npm ci
npm run build    # -> dist/
npm run preview  # проверка http://127.0.0.1:4173/
```

## Статический хостинг (корень или подпуть)

`base: './'` — работают и корень домена, и подпуть. SPA-fallback на `index.html`.

### Nginx

```nginx
server {
  listen 443 ssl;
  server_name example.com;
  root /var/www/minigames/dist;

  add_header Service-Worker-Allowed /;
  location / {
    try_files $uri $uri/ /index.html;
  }
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
  location = /sw.js {
    add_header Cache-Control "no-cache";
  }
}
```

### Простой static (npx serve / VPS)

```sh
npx -y serve dist -l 4173
# или: python3 -m http.server 4173 -d dist
```

## Проверка обновления

1. Открыть приложение, сыграть уровень (создаётся сейв).
2. Выложить новую сборку с тем же scope.
3. В открытом приложении появится «Доступна новая версия» → «Обновить».
4. После reload прогресс и активный уровень восстанавливаются (миграция
   `schemaVersion` — в `src/platform/storage/save.ts`).

## Заголовки кеширования

- `/assets/*` (хешированные чанки): `immutable, max-age=1y`.
- `/sw.js`, `index.html`, `manifest.webmanifest`: `no-cache`.

## Опциональный серверный слой (sync/challenges/share)

Клиент работает офлайн-first без сервера; `server/` — необязательный
локальный tier (node:http, 0 runtime-зависимостей) для синхронизации,
испытаний, шаринга и админки. **Не развёрнут** (production-deploy/Postgres/
домен требуют отдельного разрешения по регламенту).

Локальный preview:

```sh
npm run dev:server                # vite-node, 127.0.0.1:8099, FileStore -> server-data/
curl -sS 127.0.0.1:8099/health    # {"ok":true,"version":1}
npm run test:server               # протокольные тесты
```

Перед production: включить HTTPS, заменить `FileStore` на Postgres-адаптер
(интерфейс `Store` готов), подключить клиент к `/games/:id/challenges` и
`/sync`, вынести секреты OTP/сессий в окружение. Rollback — по версиям
`/admin` (draft → publish → rollback + audit).

