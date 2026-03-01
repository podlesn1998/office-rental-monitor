import { getDb } from './server/db.js';
import { listings } from './drizzle/schema.js';

const db = await getDb();
if (!db) { console.log('no db'); process.exit(1); }
const rows = await db.select({
  id: listings.id,
  platform: listings.platform,
  platformId: listings.platformId,
  title: listings.title,
  district: listings.district,
  isNew: listings.isNew,
  isSent: listings.isSent
}).from(listings);
console.log('Total listings:', rows.length);
rows.forEach(r => console.log(JSON.stringify(r)));
process.exit(0);
