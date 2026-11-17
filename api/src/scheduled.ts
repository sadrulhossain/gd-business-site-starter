import { openConnection } from './db.ts';
import type { Env } from './env.ts';
import { getModels } from './models.ts';
import { dailyTick, publishTick } from './publish/pipeline.ts';

/** Cron expressions in wrangler.jsonc: every 15 minutes, and once a day (also runs the 15-minute work). */
export const CRON_DAILY = '17 3 * * *';

export async function runScheduled(cron: string, env: Env): Promise<void> {
  const conn = openConnection(env);
  try {
    await conn.asPromise();
    const m = getModels(conn);
    await publishTick(env, m, conn);
    if (cron === CRON_DAILY) await dailyTick(m, conn);
  } finally {
    await conn.close();
  }
}
