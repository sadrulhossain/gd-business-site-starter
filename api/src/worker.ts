import { httpServerHandler } from 'cloudflare:node';
import { env as bindings } from 'cloudflare:workers';
import { createApp } from './app.ts';
import { isAdminPath, serveAssets } from './assets.ts';
import type { Env } from './env.ts';
import { requestContext } from './runtime.ts';
import { runScheduled } from './scheduled.ts';

// Express listens on a virtual port; httpServerHandler routes Worker fetches to it (nodejs_compat).
const app = createApp(bindings as unknown as Env);
app.listen(8080);

const handler = httpServerHandler({ port: 8080 }) as Required<Pick<ExportedHandler<Env>, 'fetch'>>;

export default {
  // ctx is kept per request so deferred work (old media removal) can use ctx.waitUntil.
  fetch: (request: Request<unknown, IncomingRequestCfProperties>, env: Env, ctx: ExecutionContext) =>
    // /admin/* is static (single origin, ADR 012); only when the assets binding exists (production), never in `wrangler dev`.
    env.ASSETS && isAdminPath(new URL(request.url).pathname)
      ? serveAssets(request, env.ASSETS)
      : requestContext.run(ctx, () => handler.fetch(request, env, ctx)),
  // Cron: publish pipeline every 15 minutes, keep-alive and cleanup daily (M5). Backup is added in M9.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;
