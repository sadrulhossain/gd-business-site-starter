import type { Connection, Schema } from 'mongoose';

/**
 * Content change hook. In M3 it only records that public content changed (site_state: {dirty_at, tags});
 * M5 reads it to schedule the portal rebuild.
 */
export function markDirty(db: Pick<Connection, 'collection'>, tags: string[]): Promise<unknown> {
  return db.collection('site_state').updateOne({ _id: 'site' as never }, { $set: { dirty_at: new Date() }, $addToSet: { tags: { $each: tags } } }, { upsert: true });
}

const QUERY_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'replaceOne'] as const;

/**
 * One line per module: `schema.plugin(markDirtyPlugin, { tags: ['faqs'] })`. Every successful create, update, delete,
 * bulk write and reorder through the model then records the tags. Call markDirty() directly for changes made elsewhere.
 */
export function markDirtyPlugin(schema: Schema, opts: { tags: string[] }): void {
  const run = async (target: unknown) => {
    const t = target as { model?: { db: Connection }; db?: Connection; constructor: { db?: Connection } };
    const db = t.model?.db ?? t.db ?? t.constructor.db;
    if (db) await markDirty(db, opts.tags);
  };
  for (const op of QUERY_OPS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema.post(op as any, async function (this: unknown) { await run(this); });
  }
  schema.post('save', async function (this: unknown) { await run(this); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema.post('insertMany' as any, async function (this: unknown) { await run(this); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema.post('bulkWrite' as any, async function (this: unknown) { await run(this); });
}
