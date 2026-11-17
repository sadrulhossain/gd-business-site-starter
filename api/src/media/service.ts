import { randomBytes } from 'node:crypto';
import { mediaBasePath, mediaMaxFiles, uploadsMaxBytes, type Env } from '../env.ts';
import { notEq } from '../db.ts';
import { HttpError } from '../errors.ts';
import { validationError } from '../http/validate.ts';
import type { MediaImage, Models } from '../models.ts';
import { defer } from '../runtime.ts';
import { detectKind, pngSize, webpSize } from './detect.ts';
import { commitMedia } from './github.ts';

export const MAX_PIXELS = 36_000_000;
export const MAX_VARIANT_WIDTH = 1600;
export const MAX_VARIANTS = 3;
export const FAVICON_MAX_BYTES = 100 * 1024;

/** Public description of a stored image: legacy keys (url, webp) plus the new dimensions and commit time. */
export function describeImage(env: Env, img: MediaImage | null | undefined) {
  if (!img) return null;
  const base = mediaBasePath(env);
  const url = (p: string) => `${base}/${p}`;
  const webp = Object.fromEntries([...img.variants].sort((a, b) => a.width - b.width).map((v) => [String(v.width), url(v.path)]));
  return { url: url(img.path), webp, width: img.width, height: img.height, committed_at: img.committed_at ? new Date(img.committed_at).toISOString() : null };
}

export const imageFiles = (img: MediaImage): string[] => (img.variants.length ? img.variants.map((v) => v.path) : [img.path]);

const repoPath = (p: string) => `media/${p}`;

interface Prepared { files: { path: string; bytes: Uint8Array }[]; image: Omit<MediaImage, 'committed_at'> }

const intField = (form: FormData, name: string): number => {
  const raw = form.get(name);
  const n = typeof raw === 'string' && /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  return n;
};

/** Validates the browser's variants (WebP only; type by magic bytes, size by container header) and names the files. */
async function prepareImage(env: Env, form: FormData, dir: string): Promise<Prepared> {
  const parts = form.getAll('variants').filter((v): v is File => typeof v !== 'string');
  if (parts.length < 1 || parts.length > MAX_VARIANTS) throw validationError({ variants: [`Send 1 to ${MAX_VARIANTS} WebP variants.`] });
  const width = intField(form, 'width');
  const height = intField(form, 'height');
  const dims: Record<string, string[]> = {};
  if (width < 1) dims.width = ['The original width is required.'];
  if (height < 1) dims.height = ['The original height is required.'];
  if (width * height > MAX_PIXELS) dims.width = ['The image has too many pixels.'];
  if (Object.keys(dims).length) throw validationError(dims);

  const folder = `${dir}/${randomBytes(16).toString('hex')}`;
  const seen = new Set<number>();
  const files: Prepared['files'] = [];
  for (const [i, part] of parts.entries()) {
    const key = `variants.${i}`;
    if (part.size > uploadsMaxBytes(env)) throw validationError({ [key]: ['The file is too large.'] });
    const bytes = new Uint8Array(await part.arrayBuffer());
    const kind = detectKind(bytes);
    if (kind === null) throw validationError({ [key]: ['The file is not a supported image.'] });
    if (kind !== 'webp') throw validationError({ [key]: ['Variants must be WebP images.'] });
    const size = webpSize(bytes);
    if (!size) throw validationError({ [key]: ['The WebP file is damaged.'] });
    if (size.width > MAX_VARIANT_WIDTH || size.width * size.height > MAX_PIXELS) throw validationError({ [key]: ['The image is too large.'] });
    if (seen.has(size.width)) throw validationError({ [key]: ['Two variants have the same width.'] });
    seen.add(size.width);
    files.push({ path: `${folder}/${size.width}.webp`, bytes });
  }
  const widths = [...seen].sort((a, b) => a - b);
  if (widths[widths.length - 1]! > width) throw validationError({ variants: ['A variant is wider than the original.'] });
  const variants = widths.map((w) => ({ width: w, path: `${folder}/${w}.webp` }));
  const biggest = variants[variants.length - 1]!;
  return { files, image: { path: biggest.path, width, height, variants } };
}

/** The favicon is one file: .ico or .png, at most 100 KB (kind by magic bytes). */
async function prepareFavicon(form: FormData, dir: string): Promise<Prepared> {
  const part = form.get('image');
  if (typeof part === 'string' || part === null) throw validationError({ image: ['The image field is required.'] });
  if (part.size > FAVICON_MAX_BYTES) throw validationError({ image: ['The favicon may be at most 100 KB.'] });
  const bytes = new Uint8Array(await part.arrayBuffer());
  const kind = detectKind(bytes);
  if (kind !== 'ico' && kind !== 'png') throw validationError({ image: ['The favicon must be an .ico or .png file.'] });
  const size = kind === 'png' ? pngSize(bytes) : null;
  if (kind === 'png' && (!size || size.width * size.height > MAX_PIXELS)) throw validationError({ image: ['The image is too large.'] });
  const path = `${dir}/${randomBytes(16).toString('hex')}/favicon.${kind}`;
  return { files: [{ path, bytes }], image: { path, width: size?.width ?? null, height: size?.height ?? null, variants: [] } };
}

/** Files already counted on stored documents (never by listing GitHub). Add each media-owning model here. */
async function countMediaFiles(m: Models): Promise<number> {
  const count = (img: MediaImage | null | undefined) => (img ? imageFiles(img).length : 0);
  let n = 0;
  for (const s of await m.Setting.find({}, { logo: 1, favicon: 1 }).lean()) n += count(s.logo) + count(s.favicon);
  for (const model of [m.Section, m.Service, m.Testimonial, m.TeamMember, m.GalleryItem, m.Post] as { find(f: object, p: object): { lean(): Promise<{ image?: MediaImage | null }[]> } }[]) {
    for (const row of await model.find({ image: notEq(null) }, { image: 1 }).lean()) n += count(row.image);
  }
  return n;
}

export type Slot = 'image' | 'favicon';

/**
 * Validates the upload, commits the new files in ONE commit and returns the image to store on the owner.
 * The caller saves it, then calls removeImage() for the replaced image (second commit, best effort).
 */
export async function storeImage(env: Env, m: Models, form: FormData, opts: { dir: string; slot: Slot; replacing: MediaImage | null }): Promise<MediaImage> {
  const prepared = opts.slot === 'favicon' ? await prepareFavicon(form, opts.dir) : await prepareImage(env, form, opts.dir);
  const current = await countMediaFiles(m);
  const replacing = opts.replacing ? imageFiles(opts.replacing).length : 0;
  if (current - replacing + prepared.files.length > mediaMaxFiles(env)) {
    throw new HttpError(409, 'media_limit', `The site already holds the maximum of ${mediaMaxFiles(env)} media files.`);
  }
  await commitMedia(env, {
    add: prepared.files.map((f) => ({ path: repoPath(f.path), bytes: f.bytes })),
    remove: [],
    message: `media: add ${prepared.image.path.split('/').slice(0, 2).join('/')}`,
  });
  return { ...prepared.image, committed_at: new Date() };
}

/** Removes the files of a replaced or deleted image in a second commit, after the document no longer points at them. */
export function removeImage(env: Env, image: MediaImage | null | undefined): void {
  if (!image) return;
  const files = imageFiles(image);
  defer(commitMedia(env, { add: [], remove: files.map(repoPath), message: `media: remove ${image.path.split('/').slice(0, 2).join('/')}` }), 'remove old media');
}
