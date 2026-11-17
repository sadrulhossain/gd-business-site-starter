import { z } from '../../http/validate.ts';
import type { Env } from '../../env.ts';
import type { PricingDoc, ServiceDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { orderFields, stamp } from '../../support/content.ts';

const text = {
  name: { max: 255, required: true }, unit: { max: 80 }, description: { max: 2000 }, features: { max: 4000 },
} as const;

/** Laravel's `numeric`: a number or a numeric string. */
const price = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, 'The price must be a number.').transform(Number)])
  .pipe(z.number().min(0).max(99999999));
const serviceId = z.number().int();

export const createPricing = z.strictObject({
  service_id: serviceId, ...bilingual(text, { partial: false }), price, is_featured: z.boolean().optional(), ...orderFields,
});
export const updatePricing = z.strictObject({
  service_id: serviceId.optional(), ...bilingual(text), price: price.optional(), is_featured: z.boolean().optional(), ...orderFields,
});

/** Prices are stored with two decimals, as the legacy decimal(10,2) column. */
export const roundPrice = (body: Record<string, unknown>): Record<string, unknown> =>
  typeof body.price === 'number' ? { ...body, price: Math.round(body.price * 100) / 100 } : body;

export type PricingServices = Map<number, Pick<ServiceDoc, '_id' | 'title' | 'title_2nd'>>;

export const pricingResource = (_env: Env, p: PricingDoc, services: PricingServices) => {
  const s = services.get(p.service_id);
  return {
    id: p._id, service_id: p.service_id,
    service: s ? { id: s._id, title: s.title, title_2nd: s.title_2nd ?? null } : null,
    name: p.name, name_2nd: p.name_2nd ?? null, price: p.price.toFixed(2),
    unit: p.unit ?? null, unit_2nd: p.unit_2nd ?? null, description: p.description ?? null, description_2nd: p.description_2nd ?? null,
    features: p.features ?? null, features_2nd: p.features_2nd ?? null, is_featured: p.is_featured,
    sort_order: p.sort_order, is_visible: p.is_visible, updated_at: stamp(p),
  };
};
