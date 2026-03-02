/**
 * Backfill score for all existing listings in the database.
 * Run: node scripts/backfill-scores.mjs
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const ENTRANCE_KEYWORDS = [
  "отдельный вход",
  "отдельн. вход",
  "отд. вход",
  "собственный вход",
  "свой вход",
  "вход с улицы",
  "вход со двора",
  "отдельный выход",
  "отдельный парадный",
];

function computeScore({ floor, ceilingHeight, title, description }) {
  let floorScore = 0;
  let entranceScore = 0;
  let ceilingScore = 0;

  if (floor == null) {
    floorScore = 10;
  } else if (floor === 1) {
    floorScore = 35;
  } else if (floor === 2) {
    floorScore = 15;
  } else if (floor === 3) {
    floorScore = 5;
  } else {
    floorScore = 0;
  }

  const haystack = `${title ?? ""} ${description ?? ""}`.toLowerCase();
  const hasEntrance = ENTRANCE_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
  if (hasEntrance) {
    entranceScore = 35;
  } else if (haystack.includes("вход")) {
    entranceScore = 5;
  } else {
    entranceScore = 0;
  }

  if (ceilingHeight == null) {
    ceilingScore = 10;
  } else {
    const heightM = ceilingHeight / 100;
    if (heightM >= 3.5) ceilingScore = 30;
    else if (heightM >= 3.0) ceilingScore = 18;
    else if (heightM >= 2.7) ceilingScore = 8;
    else ceilingScore = 0;
  }

  return Math.min(100, floorScore + entranceScore + ceilingScore);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await mysql.createConnection(dbUrl);
const db = drizzle(conn);

const [rows] = await conn.execute(
  "SELECT id, floor, ceilingHeight, title, description FROM listings"
);

console.log(`Found ${rows.length} listings to backfill`);

let updated = 0;
for (const row of rows) {
  const score = computeScore({
    floor: row.floor,
    ceilingHeight: row.ceilingHeight,
    title: row.title,
    description: row.description,
  });
  await conn.execute("UPDATE listings SET score = ? WHERE id = ?", [score, row.id]);
  console.log(`  id=${row.id} floor=${row.floor} ceiling=${row.ceilingHeight} → score=${score}`);
  updated++;
}

console.log(`\nBackfilled ${updated} listings`);
await conn.end();
