import { buildApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createPool } from './db/client.js';

const env = parseEnv(process.env);
const pool = createPool(env.DATABASE_URL, {
  // Only called after a connection exists, so `app` is initialized by then.
  onIdleClientError: (error) => app.log.warn({ err: error }, 'idle database client error'),
});
const app = buildApp({ env, pool });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  // Stop accepting requests first, then release DB connections.
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
