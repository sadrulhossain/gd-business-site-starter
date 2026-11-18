// pnpm --filter @gd/api seed [--demo]   (reads MONGODB_URI, MONGODB_DB and SUPERADMIN_* from the shell; docs/ENV.md)
import { openConnection } from '../db.ts';
import { getModels } from '../models.ts';
import { seedDemo } from './demo.ts';
import { seedAccess } from './seed.ts';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('seed: MONGODB_URI is not set');
  process.exit(1);
}

const conn = openConnection({ MONGODB_URI: uri, MONGODB_DB: process.env.MONGODB_DB || 'gd-business-site-starter' });
try {
  const r = await seedAccess(getModels(conn), {
    superadmin: { name: process.env.SUPERADMIN_NAME, email: process.env.SUPERADMIN_EMAIL, password: process.env.SUPERADMIN_PASSWORD },
  });
  console.log(`seed: ok (superadmin ${r.superadmin})`);
  if (process.argv.includes('--demo')) {
    await seedDemo(getModels(conn));
    console.log('seed: demo content loaded');
  }
  if (r.superadmin === 'skipped') console.log('seed: set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD to create the superadmin');
} finally {
  await conn.close();
}
