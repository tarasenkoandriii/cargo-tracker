import 'reflect-metadata';
import { config } from './config';
import { createServer } from './serverless';

/**
 * Local development entry point. On Vercel the app runs via api/index.ts
 * instead (serverless). Here we just listen on a port; the Vite dev server
 * proxies /api to it (see web/vite.config.ts).
 */
async function main() {
  const app = await createServer();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[cargo-tracker] API listening on http://localhost:${config.port}/api`);
  });
}

main();
