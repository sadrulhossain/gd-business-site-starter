import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request Worker execution context, set by worker.ts so handlers can defer work past the response. */
export const requestContext = new AsyncLocalStorage<{ waitUntil(p: Promise<unknown>): void }>();

const pending = new Set<Promise<unknown>>();

/** Best-effort background work (ctx.waitUntil on a Worker). Failures are logged, never thrown. */
export function defer(work: Promise<unknown>, what: string): void {
  const p = work.catch((e) => {
    if (process.env.VITEST === undefined) console.error(`deferred task failed: ${what}`, e instanceof Error ? e.message : e);
  });
  pending.add(p);
  void p.finally(() => pending.delete(p));
  requestContext.getStore()?.waitUntil(p);
}

/** Tests: wait for everything deferred so far. */
export const drainDeferred = async (): Promise<void> => {
  while (pending.size) await Promise.all([...pending]);
};
