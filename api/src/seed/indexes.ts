// pnpm --filter @gd/api indexes   (reads MONGODB_URI and MONGODB_DB from the shell)
// Creates every index declared in models.ts. Idempotent; the seed command and the daily cron run the same function.
import { openConnection } from '../db.ts';
import { ensureIndexes, getModels } from '../models.ts';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('indexes: MONGODB_URI is not set');
  process.exit(1);
}
const conn = openConnection({ MONGODB_URI: uri, MONGODB_DB: process.env.MONGODB_DB || 'gd-business-site-starter' });
try {
  await ensureIndexes(getModels(conn));
  console.log('indexes: ok');
} finally {
  await conn.close();
}
