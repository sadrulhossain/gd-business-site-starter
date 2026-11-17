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
export interface SiteStateDoc { _id: string; dirty_at: Date | null; tags: string[] }
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
    used_at: { type: Date, default: null },
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

const siteStateSchema = new Schema<SiteStateDoc>({ _id: String, dirty_at: { type: Date, default: null }, tags: { type: [String], default: [] } }, { versionKey: false, collection: 'site_state' });

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
