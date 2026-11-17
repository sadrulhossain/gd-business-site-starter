import mongoose, { Schema, type Connection } from 'mongoose';

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
  } as {
    User: mongoose.Model<UserDoc>;
    Role: mongoose.Model<RoleDoc>;
    Menu: mongoose.Model<MenuDoc>;
    RefreshToken: mongoose.Model<RefreshTokenDoc>;
    Counter: mongoose.Model<{ _id: string; seq: number }>;
    RateLimit: mongoose.Model<RateLimitDoc>;
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
