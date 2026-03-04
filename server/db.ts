import { and, desc, eq, inArray, isNotNull, isNull, notInArray, sql, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool as createMysqlPool } from "mysql2/promise";
import {
  InsertUser,
  listings,
  scrapeLogs,
  searchConfig,
  telegramConfig,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

type MysqlPool = ReturnType<typeof createMysqlPool>;
let _pool: MysqlPool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function initPool() {
  if (!process.env.DATABASE_URL) return null;
  const pool = createMysqlPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 5,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000, // 30s keepalive ping
  });
  // Reset cached db if a connection is lost so next call reconnects
  pool.on("connection", () => {});
  return pool;
}

export async function getDb() {
  if (!_pool) {
    _pool = initPool();
    _db = _pool ? drizzle(_pool as any) : null;
  }
  return _db;
}

// Call this to force reconnect after ECONNRESET
// DO NOT call pool.end() — it permanently closes the pool and causes "Pool is closed" errors
// Simply drop the references; mysql2 will GC the old pool and the next getDb() creates a fresh one
export function resetDbConnection() {
  _pool = null;
  _db = null;
  // Eagerly create a new pool so the next query doesn't need to wait
  _pool = initPool();
  _db = _pool ? drizzle(_pool as any) : null;
  console.log("[Database] Pool recreated after connection loss");
}

// ---- User helpers ----

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ---- Listings helpers ----

export async function updateListingStatus(id: number, status: "new" | "not_interesting" | "interesting") {
  const db = await getDb();
  if (!db) return;
  await db.update(listings).set({ status }).where(eq(listings.id, id));
}

export async function getListings(opts: {
  platform?: "cian" | "avito" | "yandex";
  isNew?: boolean;
  isSent?: boolean;
  status?: "new" | "not_interesting" | "interesting";
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts.platform) conditions.push(eq(listings.platform, opts.platform));
  if (opts.isNew !== undefined) conditions.push(eq(listings.isNew, opts.isNew));
  if (opts.isSent !== undefined) conditions.push(eq(listings.isSent, opts.isSent));
  if (opts.status !== undefined) conditions.push(eq(listings.status, opts.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(where)
      .orderBy(desc(listings.score), desc(listings.firstSeen))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(listings)
      .where(where),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function getListingStats() {
  const db = await getDb();
  if (!db) return { total: 0, newCount: 0, cian: 0, avito: 0, yandex: 0, lastScrapeAt: null };

  const result = await db
    .select({
      platform: listings.platform,
      count: sql<number>`count(*)`,
      newCount: sql<number>`sum(case when \`isNew\` = 1 then 1 else 0 end)`,
    })
    .from(listings)
    .groupBy(listings.platform);

  // Use the last completed scrape run time, not the last listing creation time
  const lastRow = await db
    .select({ lastScrapeAt: sql<Date>`max(\`finishedAt\`)` })
    .from(scrapeLogs)
    .where(sql`\`status\` = 'success'`)
    .limit(1);

  const stats: { total: number; newCount: number; cian: number; avito: number; yandex: number; lastScrapeAt: Date | null } = {
    total: 0, newCount: 0, cian: 0, avito: 0, yandex: 0,
    lastScrapeAt: lastRow[0]?.lastScrapeAt ?? null,
  };
  for (const row of result) {
    (stats as Record<string, unknown>)[row.platform] = Number(row.count);
    stats.total += Number(row.count);
    stats.newCount += Number(row.newCount ?? 0);
  }
  return stats;
}

// ---- Search config helpers ----

export async function getSearchConfig() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(searchConfig).limit(1);
  return rows[0] ?? null;
}

export async function updateSearchConfig(
  data: Partial<{
    minArea: number;
    maxArea: number;
    minPrice: number;
    maxPrice: number;
    footMin: number;
    metroStations: string[];
    active: boolean;
    officeType: string;
    transportType: string;
    maxPages: number;
    enableCian: boolean;
    enableAvito: boolean;
    enableYandex: boolean;
    minFloor: number | null;
    maxFloor: number | null;
    keywords: string[];
    districts: string[];
  }>
) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(searchConfig).limit(1);
  if (existing.length === 0) {
    await db.insert(searchConfig).values({
      minArea: data.minArea ?? 40,
      maxArea: data.maxArea ?? 70,
      minPrice: data.minPrice ?? 50000,
      maxPrice: data.maxPrice ?? 90000,
      footMin: data.footMin ?? 45,
      metroStations: data.metroStations ?? [],
      active: data.active ?? true,
      officeType: data.officeType ?? "office",
      transportType: data.transportType ?? "foot",
      maxPages: data.maxPages ?? 2,
      enableCian: data.enableCian ?? true,
      enableAvito: data.enableAvito ?? true,
      enableYandex: data.enableYandex ?? true,
      minFloor: data.minFloor ?? null,
      maxFloor: data.maxFloor ?? null,
      keywords: data.keywords ?? [],
      districts: data.districts ?? [],
    });
  } else {
    // Build update object, handling null values explicitly
    const updateData: Record<string, unknown> = {};
    if (data.minArea !== undefined) updateData.minArea = data.minArea;
    if (data.maxArea !== undefined) updateData.maxArea = data.maxArea;
    if (data.minPrice !== undefined) updateData.minPrice = data.minPrice;
    if (data.maxPrice !== undefined) updateData.maxPrice = data.maxPrice;
    if (data.footMin !== undefined) updateData.footMin = data.footMin;
    if (data.metroStations !== undefined) updateData.metroStations = data.metroStations;
    if (data.active !== undefined) updateData.active = data.active;
    if (data.officeType !== undefined) updateData.officeType = data.officeType;
    if (data.transportType !== undefined) updateData.transportType = data.transportType;
    if (data.maxPages !== undefined) updateData.maxPages = data.maxPages;
    if (data.enableCian !== undefined) updateData.enableCian = data.enableCian;
    if (data.enableAvito !== undefined) updateData.enableAvito = data.enableAvito;
    if (data.enableYandex !== undefined) updateData.enableYandex = data.enableYandex;
    if (data.minFloor !== undefined) updateData.minFloor = data.minFloor;
    if (data.maxFloor !== undefined) updateData.maxFloor = data.maxFloor;
    if (data.keywords !== undefined) updateData.keywords = data.keywords;
    if (data.districts !== undefined) updateData.districts = data.districts;
    await db.update(searchConfig).set(updateData).where(eq(searchConfig.id, existing[0].id));

    // When districts change, delete listings that no longer match
    if (data.districts !== undefined && data.districts.length > 0) {
      const { guessDistrict } = await import("./scrapers/district.js");
      // Re-classify all listings first
      const allListings = await db.select({ id: listings.id, address: listings.address, district: listings.district }).from(listings);
      for (const row of allListings) {
        const newDistrict = guessDistrict(row.address);
        if (newDistrict !== row.district) {
          await db.update(listings).set({ district: newDistrict }).where(eq(listings.id, row.id));
        }
      }
      // Delete listings with known district that doesn't match
      await db.delete(listings).where(
        and(isNotNull(listings.district), notInArray(listings.district, data.districts))
      );
      // Also delete listings with null district (cannot verify they belong to selected districts)
      await db.delete(listings).where(isNull(listings.district));
      console.log(`[Config] Cleaned listings not in districts: ${data.districts.join(", ")}`);
    }
  }
}

// ---- Telegram config helpers ----

export async function getTelegramConfig() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(telegramConfig).limit(1);
  return rows[0] ?? null;
}

export async function updateTelegramConfig(
  data: Partial<{
    botToken: string;
    chatId: string;
    active: boolean;
    initialBulkSent: boolean;
    threadNew: number | null;
    threadInteresting: number | null;
    threadNotInteresting: number | null;
  }>
) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(telegramConfig).limit(1);
  if (existing.length === 0) {
    await db.insert(telegramConfig).values({
      botToken: data.botToken,
      chatId: data.chatId,
      active: data.active ?? false,
      initialBulkSent: data.initialBulkSent ?? false,
    });
  } else {
    await db.update(telegramConfig).set(data).where(eq(telegramConfig.id, existing[0].id));
  }
}

// ---- Manual listing management ----

export async function addManualListing(data: {
  platform: "cian" | "avito" | "yandex";
  url: string;
  title?: string | null;
  address?: string | null;
  metroStation?: string | null;
  metroDistanceMin?: number | null;
  price?: number | null;
  area?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  description?: string | null;
  photos?: string[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Generate a unique platformId from URL
  const platformId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await db.insert(listings).values({
    platform: data.platform,
    platformId,
    title: data.title ?? null,
    address: data.address ?? null,
    metroStation: data.metroStation ?? null,
    metroDistanceMin: data.metroDistanceMin ?? null,
    metroDistanceType: "foot",
    price: data.price ?? null,
    area: data.area ?? null,
    floor: data.floor ?? null,
    totalFloors: data.totalFloors ?? null,
    description: data.description ?? null,
    photos: data.photos ?? [],
    url: data.url,
    phone: null,
    isNew: true,
    isSent: false,
    firstSeen: new Date(),
    lastSeen: new Date(),
  });

  const inserted = await db
    .select()
    .from(listings)
    .where(eq(listings.platformId, platformId))
    .limit(1);

  return inserted[0] ?? null;
}

export async function deleteListing(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(listings).where(eq(listings.id, id));
}

// ---- Scrape logs helpers ----

export async function getScrapeLogs(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scrapeLogs).orderBy(desc(scrapeLogs.startedAt)).limit(limit);
}
