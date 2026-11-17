import type { Env } from '../../env.ts';
import type { Api } from '../../http/route.ts';
import type { GalleryItemDoc } from '../../models.ts';
import { contentRoutes } from '../../support/content.ts';
import { createGalleryItem, galleryItemResource, updateGalleryItem } from './schema.ts';

export const galleryRoutes = (api: Api, env: Env): void =>
  contentRoutes<GalleryItemDoc>(api, env, {
    path: 'gallery', model: 'GalleryItem', create: createGalleryItem, update: updateGalleryItem, resource: galleryItemResource, imageDir: 'gallery',
  });
