import { httpServerHandler } from 'cloudflare:node';
import { env as bindings } from 'cloudflare:workers';
import { createApp } from './app.js';
import type { Env } from './env.js';

// Express listens on a virtual port; httpServerHandler routes Worker fetches to it (nodejs_compat).
const app = createApp(bindings as unknown as Env);
app.listen(8080);

const handler = httpServerHandler({ port: 8080 });

export default {
  fetch: handler.fetch,
  // Cron triggers arrive in M5 (publish pipeline) and M9 (backup); intentionally empty now.
  async scheduled(): Promise<void> {},
};
