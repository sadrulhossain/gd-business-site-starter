import type { Connection } from 'mongoose';
import { before, between } from '../db.ts';
import { mediaBranch, publishDebounceMinutes, publishQuietMinutes, type Env } from '../env.ts';
import { HttpError } from '../errors.ts';
import type { Models } from '../models.ts';
import { markDirty } from '../support/markDirty.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** GitHub REST workflow_dispatch. Never logs the token or the response body. */
export async function dispatchBuild(env: Env): Promise<void> {
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_REPO_TOKEN;
  if (!repo || !token) throw new HttpError(503, 'publish_unavailable', 'Publishing is not configured.');
  const workflow = env.GITHUB_WORKFLOW_FILE || 'deploy.yml';
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gd-business-site', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: env.GITHUB_REF || mediaBranch(env) }),
  });
  if (!r.ok) throw new HttpError(502, 'publish_failed', `GitHub workflow dispatch failed (${r.status}).`);
}

/**
 * Records a dispatch: last_dispatched_at always, dirty_at cleared only if it still equals the value the dispatch was
 * based on (compare-and-set), so a change made while the build was being started keeps the site marked dirty.
 */
export async function recordDispatch(m: Models, seenDirty: Date | null, now: Date): Promise<boolean> {
  if (seenDirty) {
    const cleared = await m.SiteState.updateOne({ _id: 'site', dirty_at: seenDirty }, { $set: { last_dispatched_at: now, dirty_at: null, tags: [] } });
    if (cleared.modifiedCount === 1) return true;
  }
  await m.SiteState.updateOne({ _id: 'site' }, { $set: { last_dispatched_at: now } }, { upsert: true });
  return false;
}

export interface TickResult { flipped: boolean; dispatched: boolean; skipped?: 'clean' | 'quiet' | 'debounce' | 'unconfigured' }

/**
 * The 15-minute run (clock injected for tests):
 *  1. posts whose published_at passed since the last run become public: markDirty('posts');
 *  2. if the site is dirty, quiet for PUBLISH_QUIET_MINUTES and no build was dispatched within
 *     PUBLISH_DEBOUNCE_MINUTES, dispatch the build workflow.
 */
export async function publishTick(env: Env, m: Models, db: Pick<Connection, 'collection'>, now = new Date()): Promise<TickResult> {
  const state = await m.SiteState.findById('site').lean();
  let flipped = false;
  if (state?.last_run_at) {
    const due = await m.Post.exists({ is_published: true, published_at: between(state.last_run_at, now) });
    if (due) {
      await markDirty(db, ['posts']);
      flipped = true;
    }
  }
  await m.SiteState.updateOne({ _id: 'site' }, { $set: { last_run_at: now } }, { upsert: true });

  const fresh = await m.SiteState.findById('site').lean();
  const dirty = fresh?.dirty_at ?? null;
  if (!dirty) return { flipped, dispatched: false, skipped: 'clean' };
  if (dirty.getTime() > now.getTime() - publishQuietMinutes(env) * MIN) return { flipped, dispatched: false, skipped: 'quiet' };
  const last = fresh?.last_dispatched_at ?? null;
  if (last && last.getTime() > now.getTime() - publishDebounceMinutes(env) * MIN) return { flipped, dispatched: false, skipped: 'debounce' };
  if (!env.GITHUB_REPO || !env.GITHUB_REPO_TOKEN) return { flipped, dispatched: false, skipped: 'unconfigured' };

  await dispatchBuild(env);
  await recordDispatch(m, dirty, now);
  return { flipped, dispatched: true };
}

/** Admin "publish now": dispatch immediately, ignoring the debounce. */
export async function publishNow(env: Env, m: Models, now = new Date()): Promise<void> {
  const seen = (await m.SiteState.findById('site').lean())?.dirty_at ?? null;
  await dispatchBuild(env);
  await recordDispatch(m, seen, now);
}

/** Daily run: keep Atlas awake and delete what the TTL monitor has not removed yet. */
export async function dailyTick(m: Models, conn: Connection, now = new Date()): Promise<void> {
  await conn.db!.admin().ping();
  await m.SiteState.updateOne({ _id: 'site' }, { $set: { last_ping_at: now } }, { upsert: true });
  await m.Captcha.deleteMany({ expires_at: before(now) });
  await m.RefreshToken.deleteMany({ used_at: before(new Date(now.getTime() - 30 * DAY)) });
}
