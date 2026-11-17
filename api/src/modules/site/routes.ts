import type { Env } from '../../env.ts';
import { iso } from '../../http/helpers.ts';
import { hit } from '../../http/rateLimit.ts';
import type { Api } from '../../http/route.ts';
import { publishNow } from '../../publish/pipeline.ts';

export function siteRoutes(api: Api, env: Env): void {
  api.get('/site/status', { permission: 'site.view' }, async (_req, res) => {
    const s = await res.locals.models().SiteState.findById('site').lean();
    res.json({ data: { dirty: Boolean(s?.dirty_at), last_dispatched_at: iso(s?.last_dispatched_at) } });
  });

  // One publish per minute for the whole site (a shared bucket, not per user).
  api.post('/site/publish', { permission: 'site.publish' }, async (req, res) => {
    await hit(req, res, 'publish', 'site', 1, 60);
    const m = res.locals.models();
    await publishNow(env, m);
    const s = await m.SiteState.findById('site').lean();
    res.status(202).json({ data: { dispatched: true, last_dispatched_at: iso(s?.last_dispatched_at) } });
  });
}
