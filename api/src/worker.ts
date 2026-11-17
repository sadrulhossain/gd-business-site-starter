import { httpServerHandler } from 'cloudflare:node';
import { env as bindings } from 'cloudflare:workers';
import { createApp } from './app.ts';
import type { Env } from './env.ts';
import { requestContext } from './runtime.ts';

// Express listens on a virtual port; httpServerHandler routes Worker fetches to it (nodejs_compat).
const app = createApp(bindings as unknown as Env);
app.listen(8080);

const handler = httpServerHandler({ port: 8080 }) as Required<Pick<ExportedHandler<Env>, 'fetch'>>;

export default {
  // ctx is kept per request so deferred work (old media removal) can use ctx.waitUntil.
  fetch: (request: Request<unknown, IncomingRequestCfProperties>, env: Env, ctx: ExecutionContext) =>
    requestContext.run(ctx, () => handler.fetch(request, env, ctx)),
  // Cron triggers arrive in M5 (publish pipeline) and M9 (backup); intentionally empty now.
  async scheduled(): Promise<void> {},
} satisfies ExportedHandler<Env>;
