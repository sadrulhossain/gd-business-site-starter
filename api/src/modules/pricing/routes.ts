import { inList } from '../../db.ts';
import type { Env } from '../../env.ts';
import type { Api } from '../../http/route.ts';
import { validationError } from '../../http/validate.ts';
import type { PricingDoc } from '../../models.ts';
import { contentRoutes } from '../../support/content.ts';
import { createPricing, pricingResource, roundPrice, updatePricing, type PricingServices } from './schema.ts';

/**
 * Admin: ordered by service id, sort_order, id. Public: only visible prices of visible services, ordered by the
 * service's sort_order and id, then the price's; optional ?service_id=.
 */
export const pricingRoutes = (api: Api, env: Env): void =>
  contentRoutes<PricingDoc, PricingServices>(api, env, {
    path: 'pricing', model: 'Pricing', create: createPricing, update: updatePricing, resource: pricingResource,
    map: roundPrice,
    check: async (m, body) => {
      if (body.service_id !== undefined && !(await m.Service.exists({ _id: body.service_id as number }))) {
        throw validationError({ service_id: ['The selected service id is invalid.'] });
      }
    },
    prepare: async (m, rows) => {
      const ids = [...new Set(rows.map((r) => r.service_id))];
      const services = await m.Service.find({ _id: inList(ids) }, { title: 1, title_2nd: 1 }).lean();
      return new Map(services.map((s) => [s._id, s]));
    },
    list: async (m, req, { public: isPublic }) => {
      if (!isPublic) return (await m.Pricing.find({}).sort({ service_id: 1, sort_order: 1, _id: 1 }).lean()) as PricingDoc[];
      const only = Number.parseInt(String(req.query.service_id ?? ''), 10);
      const services = await m.Service.find({ is_visible: true }).sort({ sort_order: 1, _id: 1 }).lean();
      const rank = new Map(services.map((s, i) => [s._id, i]));
      const prices = await m.Pricing.find({ is_visible: true, service_id: inList([...rank.keys()]) }).lean();
      return prices
        .filter((p) => !only || p.service_id === only)
        .sort((a, b) => rank.get(a.service_id)! - rank.get(b.service_id)! || a.sort_order - b.sort_order || a._id - b._id) as PricingDoc[];
    },
  });
