import type { Env } from '../../env.ts';
import type { Api } from '../../http/route.ts';
import type { FaqDoc } from '../../models.ts';
import { contentRoutes } from '../../support/content.ts';
import { createFaq, faqResource, updateFaq } from './schema.ts';

export const faqRoutes = (api: Api, env: Env): void =>
  contentRoutes<FaqDoc>(api, env, { path: 'faqs', model: 'Faq', create: createFaq, update: updateFaq, resource: faqResource });
