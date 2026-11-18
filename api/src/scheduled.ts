import { openConnection } from './db.ts';
import type { Env } from './env.ts';
import { ensureIndexes, getModels } from './models.ts';
import { dailyTick, publishTick } from './publish/pipeline.ts';

/** Cron expressions in wrangler.jsonc: every 15 minutes, and once a day (also runs the 15-minute work). */
export const CRON_DAILY = '17 3 * * *';

export async function runScheduled(cron: string, env: Env): Promise<void> {
  const conn = openConnection(env);
  try {
    await conn.asPromise();
    const m = getModels(conn);
    await publishTick(env, m, conn);
    if (cron === CRON_DAILY) {
      await dailyTick(m, conn);
      // Once a day, never per request: creates indexes added by a new release (a no-op when they exist). A failure
      // (for example a unique index over duplicate data) fails this run visibly in the Workers logs.
      await ensureIndexes(m);
    }
  } finally {
    await conn.close();
  }
}
