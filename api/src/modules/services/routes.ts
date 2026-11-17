import type { Env } from '../../env.ts';
import type { Api } from '../../http/route.ts';
import type { ServiceDoc } from '../../models.ts';
import { contentRoutes } from '../../support/content.ts';
import { createService, serviceResource, updateService } from './schema.ts';

/** Deleting a service also deletes its prices (legacy: pricings.service_id ON DELETE CASCADE). */
export const serviceRoutes = (api: Api, env: Env): void =>
  contentRoutes<ServiceDoc>(api, env, {
    path: 'services', model: 'Service', create: createService, update: updateService, resource: serviceResource,
    imageDir: 'services', publicShow: true,
    afterDelete: async (m, row) => void (await m.Pricing.deleteMany({ service_id: row._id })),
  });
