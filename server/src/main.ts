// Local preview / staging entrypoint. Production deployment needs explicit
// approval plus Postgres, TLS termination and secrets management.
import { FileStore, type Store } from './store';
import { PgStore } from './pg-store';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8099);
const dbUrl = process.env.DATABASE_URL ?? process.env.PG_URL ?? '';

async function main(): Promise<void> {
  let store: Store;
  if (dbUrl) {
    store = await PgStore.create({ connectionString: dbUrl });
    console.log('[server] storage: PostgreSQL');
  } else {
    store = new FileStore(process.env.DATA_DIR ?? './server-data');
    console.log('[server] storage: FileStore (local preview)');
  }
  // OTP codes are exposed ONLY in explicitly tagged test runs.
  const exposeCodes = process.env.MG_TEST_HOOKS === '1';
  const { server } = createApp({ store, exposeCodes });
  server.listen(port, '127.0.0.1', () => {
    console.log(`minigames-server on 127.0.0.1:${port} (local only, not production)`);
  });
}

main().catch((e) => {
  console.error('fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
