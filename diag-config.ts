import { getDb } from './server/db.js';
import { searchConfig } from './drizzle/schema.js';
import { eq } from 'drizzle-orm';

const db = await getDb();
if (!db) { console.log('no db'); process.exit(1); }
const configs = await db.select().from(searchConfig).where(eq(searchConfig.active, true)).limit(1);
const config = configs[0];
console.log('Config:', JSON.stringify({
  id: config?.id,
  districts: config?.districts,
  keywords: config?.keywords,
  minArea: config?.minArea,
  maxArea: config?.maxArea,
}, null, 2));
process.exit(0);
