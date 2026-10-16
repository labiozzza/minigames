// Local preview entrypoint only. Production deployment needs explicit approval
// plus Postgres, TLS termination and secrets management (see docs/DEPLOY plan).
import { FileStore } from './store';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8099);
const { server } = createApp({ store: new FileStore(process.env.DATA_DIR ?? './server-data') });
server.listen(port, '127.0.0.1', () => {
  console.log(`minigames-server preview on 127.0.0.1:${port} (local only, not production)`);
});
