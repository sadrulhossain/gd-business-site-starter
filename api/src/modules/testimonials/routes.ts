import type { Env } from '../../env.ts';
import type { Api } from '../../http/route.ts';
import type { TestimonialDoc } from '../../models.ts';
import { contentRoutes } from '../../support/content.ts';
import { createTestimonial, testimonialResource, updateTestimonial } from './schema.ts';

export const testimonialRoutes = (api: Api, env: Env): void =>
  contentRoutes<TestimonialDoc>(api, env, {
    path: 'testimonials', model: 'Testimonial', create: createTestimonial, update: updateTestimonial, resource: testimonialResource, imageDir: 'testimonials',
  });
