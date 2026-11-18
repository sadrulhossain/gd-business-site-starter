import mongoose, { Schema, type Connection } from 'mongoose';
import { markDirtyPlugin } from './support/markDirty.ts';

// Numeric ids (D6): every collection that exposes ids uses _id: Number allocated by nextId().
const ts = { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false } as const;

export interface UserDoc {
  _id: number;
  name: string;
  email: string;
  password_hash: string;
  role_ids: number[];
  is_active: boolean;
  password_changed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
export interface RoleDoc { _id: number; name: string; permissions: string[]; created_at: Date; updated_at: Date }
export interface MenuDoc { _id: number; parent_id: number | null; permission_name: string | null; title: string; icon: string | null; path: string | null; sort: number }
export interface RefreshTokenDoc { _id: number; user_id: number; family_id: string; token_hash: string; expires_at: Date; used_at: Date | null; revoked_at: Date | null }
export interface MediaImage { path: string; width: number | null; height: number | null; variants: { width: number; path: string }[]; committed_at: Date }
export interface DayHours { open: string | null; close: string | null; closed: boolean }
export interface SettingDoc {
  _id: number;
  site_name: string; site_name_2nd: string | null;
  tagline: string | null; tagline_2nd: string | null;
  currency: string | null; currency_symbol: string | null;
  address: string | null; address_2nd: string | null;
  phone: string | null; email: string | null;
  hours: Record<string, DayHours>;
  social_links: Record<string, string | null>;
  logo: MediaImage | null; favicon: MediaImage | null;
  created_at: Date; updated_at: Date;
}
export interface SectionDoc {
  _id: number; key: string;
  title: string; title_2nd: string | null;
  content: string | null; content_2nd: string | null;
  image: MediaImage | null;
  sort_order: number; is_visible: boolean;
  created_at: Date; updated_at: Date;
}
interface Ordered { sort_order: number; is_visible: boolean; created_at: Date; updated_at: Date }
export interface FaqDoc extends Ordered { _id: number; question: string; question_2nd: string | null; answer: string; answer_2nd: string | null }
export interface ServiceDoc extends Ordered { _id: number; title: string; title_2nd: string | null; description: string | null; description_2nd: string | null; image: MediaImage | null }
export interface PricingDoc extends Ordered {
  _id: number; service_id: number;
  name: string; name_2nd: string | null; price: number;
  unit: string | null; unit_2nd: string | null; description: string | null; description_2nd: string | null;
  features: string | null; features_2nd: string | null; is_featured: boolean;
}
export interface TestimonialDoc extends Ordered { _id: number; author_name: string; author_role: string | null; author_role_2nd: string | null; quote: string; quote_2nd: string | null; image: MediaImage | null }
export interface TeamMemberDoc extends Ordered { _id: number; name: string; role: string; role_2nd: string | null; bio: string | null; bio_2nd: string | null; image: MediaImage | null }
export interface GalleryItemDoc extends Ordered { _id: number; title: string | null; title_2nd: string | null; caption: string | null; caption_2nd: string | null; image: MediaImage | null }
export interface CategoryDoc { _id: number; name: string; name_2nd: string | null; slug: string; sort_order: number; created_at: Date; updated_at: Date }
export interface PostDoc {
  _id: number; category_id: number | null;
  title: string; title_2nd: string | null; slug: string;
  excerpt: string | null; excerpt_2nd: string | null; body: string | null; body_2nd: string | null;
  seo_title: string | null; seo_title_2nd: string | null; seo_description: string | null; seo_description_2nd: string | null;
  image: MediaImage | null; is_published: boolean; published_at: Date | null; created_at: Date; updated_at: Date;
}
export interface ContactMessageDoc { _id: number; name: string; email: string; phone: string | null; subject: string | null; message: string; read_at: Date | null; created_at: Date; updated_at: Date }
export interface CaptchaDoc { _id: string; answer: number; expires_at: Date }
export interface SiteStateDoc {
  _id: string; dirty_at: Date | null; tags: string[];
  last_dispatched_at?: Date | null; last_run_at?: Date | null; last_ping_at?: Date | null;
}
export interface RateLimitDoc { _id: string; count: number; expires_at: Date }

const userSchema = new Schema<UserDoc>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    role_ids: { type: [Number], default: [] },
    is_active: { type: Boolean, default: true },
    password_changed_at: { type: Date, default: null },
  },
  { ...ts, collection: 'users' },
);

const roleSchema = new Schema<RoleDoc>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, unique: true },
    permissions: { type: [String], default: [] },
  },
  { ...ts, collection: 'roles' },
);

const menuSchema = new Schema<MenuDoc>(
  {
    _id: { type: Number, required: true },
    parent_id: { type: Number, default: null, index: true },
    permission_name: { type: String, default: null },
    title: { type: String, required: true },
    icon: { type: String, default: null },
    path: { type: String, default: null },
    sort: { type: Number, default: 0 },
  },
  { versionKey: false, collection: 'menus' },
);

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    _id: { type: Number, required: true },
    user_id: { type: Number, required: true, index: true },
    family_id: { type: String, required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true, index: { expires: 0 } }, // TTL
    used_at: { type: Date, default: null, index: true }, // the daily cleanup deletes by used_at
    revoked_at: { type: Date, default: null },
  },
  { versionKey: false, collection: 'refresh_tokens' },
);

const imageSchema = new Schema<MediaImage>(
  {
    path: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    variants: { type: [new Schema({ width: Number, path: String }, { _id: false })], default: [] },
    committed_at: { type: Date, required: true },
  },
  { _id: false },
);
const text = (extra: object = {}) => ({ type: String, default: null, ...extra });

const settingSchema = new Schema<SettingDoc>(
  {
    _id: { type: Number, required: true }, // singleton: always 1
    site_name: { type: String, required: true }, site_name_2nd: text(),
    tagline: text(), tagline_2nd: text(),
    currency: text(), currency_symbol: text(),
    address: text(), address_2nd: text(),
    phone: text(), email: text(),
    hours: { type: Schema.Types.Mixed, default: {} },
    social_links: { type: Schema.Types.Mixed, default: {}, minimize: false },
    logo: { type: imageSchema, default: null },
    favicon: { type: imageSchema, default: null },
  },
  { ...ts, collection: 'settings', minimize: false },
);
settingSchema.plugin(markDirtyPlugin, { tags: ['settings'] });

const sectionSchema = new Schema<SectionDoc>(
  {
    _id: { type: Number, required: true },
    key: { type: String, required: true, unique: true },
    title: { type: String, required: true }, title_2nd: text(),
    content: text(), content_2nd: text(),
    image: { type: imageSchema, default: null },
    sort_order: { type: Number, default: 0 },
    is_visible: { type: Boolean, default: true },
  },
  { ...ts, collection: 'sections' },
);
sectionSchema.plugin(markDirtyPlugin, { tags: ['sections'] });

// Content modules (M4): same shape as legacy tables, tag = legacy table name.
const common = { sort_order: { type: Number, default: 0 }, is_visible: { type: Boolean, default: true } };
const img = { image: { type: imageSchema, default: null } };
const idKey = { _id: { type: Number, required: true } };
const content = <T>(name: string, collection: string, fields: Record<string, unknown>, indexes: Record<string, 1>[] = []) => {
  const schema = new Schema<T>({ ...idKey, ...fields, ...common } as never, { ...ts, collection });
  schema.index({ is_visible: 1, sort_order: 1 });
  for (const i of indexes) schema.index(i);
  schema.plugin(markDirtyPlugin, { tags: [collection] });
  return schema;
};
const faqSchema = content<FaqDoc>('Faq', 'faqs', { question: { type: String, required: true }, question_2nd: text(), answer: { type: String, required: true }, answer_2nd: text() });
const serviceSchema = content<ServiceDoc>('Service', 'services', { title: { type: String, required: true }, title_2nd: text(), description: text(), description_2nd: text(), ...img });
const pricingSchema = content<PricingDoc>('Pricing', 'pricings', {
  service_id: { type: Number, required: true }, name: { type: String, required: true }, name_2nd: text(), price: { type: Number, required: true },
  unit: text(), unit_2nd: text(), description: text(), description_2nd: text(), features: text(), features_2nd: text(), is_featured: { type: Boolean, default: false },
}, [{ service_id: 1 }]);
const testimonialSchema = content<TestimonialDoc>('Testimonial', 'testimonials', { author_name: { type: String, required: true }, author_role: text(), author_role_2nd: text(), quote: { type: String, required: true }, quote_2nd: text(), ...img });
const teamMemberSchema = content<TeamMemberDoc>('TeamMember', 'team_members', { name: { type: String, required: true }, role: { type: String, required: true }, role_2nd: text(), bio: text(), bio_2nd: text(), ...img });
const galleryItemSchema = content<GalleryItemDoc>('GalleryItem', 'gallery_items', { title: text(), title_2nd: text(), caption: text(), caption_2nd: text(), ...img });

const categorySchema = new Schema<CategoryDoc>(
  {
    ...idKey, name: { type: String, required: true }, name_2nd: text(), slug: { type: String, required: true, unique: true }, sort_order: { type: Number, default: 0 },
  },
  { ...ts, collection: 'categories' },
);
categorySchema.plugin(markDirtyPlugin, { tags: ['categories'] });

const postSchema = new Schema<PostDoc>(
  {
    ...idKey, category_id: { type: Number, default: null },
    title: { type: String, required: true }, title_2nd: text(), slug: { type: String, required: true, unique: true },
    excerpt: text(), excerpt_2nd: text(), body: text(), body_2nd: text(),
    seo_title: text(), seo_title_2nd: text(), seo_description: text(), seo_description_2nd: text(),
    ...img, is_published: { type: Boolean, default: false }, published_at: { type: Date, default: null },
  },
  { ...ts, collection: 'posts' },
);
// Public list: equality on is_published, range on published_at, sort published_at desc then _id desc (no in-memory sort).
postSchema.index({ is_published: 1, published_at: -1, _id: -1 });
postSchema.index({ category_id: 1, is_published: 1, published_at: -1, _id: -1 });
postSchema.plugin(markDirtyPlugin, { tags: ['posts'] });

const contactMessageSchema = new Schema<ContactMessageDoc>(
  {
    ...idKey, name: { type: String, required: true }, email: { type: String, required: true }, phone: text(), subject: text(),
    message: { type: String, required: true }, read_at: { type: Date, default: null },
  },
  { ...ts, collection: 'contact_messages' },
);
contactMessageSchema.index({ read_at: 1 });

// TTL index deletes late (about a minute), so verification also checks expires_at in the query.
const captchaSchema = new Schema<CaptchaDoc>({ _id: String, answer: { type: Number, required: true }, expires_at: { type: Date, required: true, index: { expireAfterSeconds: 0 } } }, { versionKey: false, collection: 'captchas' });

const siteStateSchema = new Schema<SiteStateDoc>({ _id: String, dirty_at: { type: Date, default: null }, tags: { type: [String], default: [] }, last_dispatched_at: { type: Date, default: null }, last_run_at: { type: Date, default: null }, last_ping_at: { type: Date, default: null } }, { versionKey: false, collection: 'site_state' });

const counterSchema = new Schema<{ _id: string; seq: number }>({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false, collection: 'counters' });

const rateLimitSchema = new Schema<RateLimitDoc>(
  { _id: String, count: { type: Number, default: 0 }, expires_at: { type: Date, required: true, index: { expires: 0 } } },
  { versionKey: false, collection: 'rate_limits' },
);

export function getModels(conn: Connection) {
  return {
    User: conn.models.User ?? conn.model<UserDoc>('User', userSchema),
    Role: conn.models.Role ?? conn.model<RoleDoc>('Role', roleSchema),
    Menu: conn.models.Menu ?? conn.model<MenuDoc>('Menu', menuSchema),
    RefreshToken: conn.models.RefreshToken ?? conn.model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema),
    Counter: conn.models.Counter ?? conn.model<{ _id: string; seq: number }>('Counter', counterSchema),
    RateLimit: conn.models.RateLimit ?? conn.model<RateLimitDoc>('RateLimit', rateLimitSchema),
    Setting: conn.models.Setting ?? conn.model<SettingDoc>('Setting', settingSchema),
    Section: conn.models.Section ?? conn.model<SectionDoc>('Section', sectionSchema),
    Category: conn.models.Category ?? conn.model<CategoryDoc>('Category', categorySchema),
    Post: conn.models.Post ?? conn.model<PostDoc>('Post', postSchema),
    ContactMessage: conn.models.ContactMessage ?? conn.model<ContactMessageDoc>('ContactMessage', contactMessageSchema),
    Captcha: conn.models.Captcha ?? conn.model<CaptchaDoc>('Captcha', captchaSchema),
    Faq: conn.models.Faq ?? conn.model<FaqDoc>('Faq', faqSchema),
    Service: conn.models.Service ?? conn.model<ServiceDoc>('Service', serviceSchema),
    Pricing: conn.models.Pricing ?? conn.model<PricingDoc>('Pricing', pricingSchema),
    Testimonial: conn.models.Testimonial ?? conn.model<TestimonialDoc>('Testimonial', testimonialSchema),
    TeamMember: conn.models.TeamMember ?? conn.model<TeamMemberDoc>('TeamMember', teamMemberSchema),
    GalleryItem: conn.models.GalleryItem ?? conn.model<GalleryItemDoc>('GalleryItem', galleryItemSchema),
    SiteState: conn.models.SiteState ?? conn.model<SiteStateDoc>('SiteState', siteStateSchema),
  } as {
    User: mongoose.Model<UserDoc>;
    Role: mongoose.Model<RoleDoc>;
    Menu: mongoose.Model<MenuDoc>;
    RefreshToken: mongoose.Model<RefreshTokenDoc>;
    Counter: mongoose.Model<{ _id: string; seq: number }>;
    RateLimit: mongoose.Model<RateLimitDoc>;
    Setting: mongoose.Model<SettingDoc>;
    Section: mongoose.Model<SectionDoc>;
    Category: mongoose.Model<CategoryDoc>;
    Post: mongoose.Model<PostDoc>;
    ContactMessage: mongoose.Model<ContactMessageDoc>;
    Captcha: mongoose.Model<CaptchaDoc>;
    Faq: mongoose.Model<FaqDoc>;
    Service: mongoose.Model<ServiceDoc>;
    Pricing: mongoose.Model<PricingDoc>;
    Testimonial: mongoose.Model<TestimonialDoc>;
    TeamMember: mongoose.Model<TeamMemberDoc>;
    GalleryItem: mongoose.Model<GalleryItemDoc>;
    SiteState: mongoose.Model<SiteStateDoc>;
  };
}
export type Models = ReturnType<typeof getModels>;

/** Atomic numeric id: findOneAndUpdate $inc with upsert on the counters collection. */
export async function nextId(m: Models, collection: string): Promise<number> {
  const c = await m.Counter.findOneAndUpdate({ _id: collection }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
  return c!.seq;
}

export const ensureIndexes = async (m: Models): Promise<void> => {
  await Promise.all(Object.values(m).map((model) => model.createIndexes()));
};
