import { and, eq, inArray } from "drizzle-orm";
import { listings, scrapeLogs, searchConfig, type InsertListing } from "../../drizzle/schema";
import { getDb } from "../db";
import { scrapeCian } from "./cian";
import { scrapeAvito } from "./avito";
import { scrapeYandex } from "./yandex";

export type Platform = "cian" | "avito" | "yandex";

export interface ScrapeResult {
  platform: Platform | "all";
  found: number;
  newCount: number;
  newListings: (typeof listings.$inferSelect)[];
  error?: string;
}

export interface SearchParams {
  minArea: number;
  maxArea: number;
  minPrice: number;
  maxPrice: number;
  footMin: number;
  metroStations: string[];
  officeType: string;
  transportType: "foot" | "transport";
  maxPages: number;
  minFloor?: number | null;
  maxFloor?: number | null;
  keywords: string[];
  districts: string[];
}

/**
 * Deduplicate scraped listings against the database.
 * Returns only truly new listings (not seen before by platform+platformId).
 */
async function deduplicateListings(
  scraped: InsertListing[],
  platform: Platform
): Promise<InsertListing[]> {
  if (scraped.length === 0) return [];

  const db = await getDb();
  if (!db) return scraped;

  const platformIds = scraped.map((l) => l.platformId);

  // Find existing listings by platform + platformId
  const existing = await db
    .select({ platformId: listings.platformId })
    .from(listings)
    .where(and(eq(listings.platform, platform), inArray(listings.platformId, platformIds)));

  const existingIds = new Set(existing.map((e) => e.platformId));

  // Update lastSeen for existing listings
  const existingPlatformIds = scraped
    .filter((l) => existingIds.has(l.platformId))
    .map((l) => l.platformId);

  if (existingPlatformIds.length > 0) {
    await db
      .update(listings)
      .set({ lastSeen: new Date(), isNew: false })
      .where(
        and(
          eq(listings.platform, platform),
          inArray(listings.platformId, existingPlatformIds)
        )
      );
  }

  return scraped.filter((l) => !existingIds.has(l.platformId));
}

/**
 * Apply keyword filter: keep listing if no keywords defined, or if any keyword
 * appears in title or description (case-insensitive).
 */
function applyKeywordFilter(listing: InsertListing, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = `${listing.title ?? ""} ${listing.description ?? ""}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

/**
 * Apply district filter: keep listing if no districts configured, or if listing's
 * district matches one of the selected districts (or district is unknown).
 */
function applyDistrictFilter(listing: InsertListing, districts: string[]): boolean {
  if (!districts || districts.length === 0) return true;
  if (!listing.district) return true; // keep if district unknown
  return districts.includes(listing.district);
}

/**
 * Apply floor filter.
 */
function applyFloorFilter(
  listing: InsertListing,
  minFloor?: number | null,
  maxFloor?: number | null
): boolean {
  if (!minFloor && !maxFloor) return true;
  if (listing.floor == null) return true; // keep if floor unknown
  if (minFloor && listing.floor < minFloor) return false;
  if (maxFloor && listing.floor > maxFloor) return false;
  return true;
}

/**
 * Save new listings to the database and return the saved records.
 */
async function saveNewListings(
  newListings: InsertListing[]
): Promise<(typeof listings.$inferSelect)[]> {
  if (newListings.length === 0) return [];

  const db = await getDb();
  if (!db) return [];

  const saved: (typeof listings.$inferSelect)[] = [];

  for (const listing of newListings) {
    try {
      await db.insert(listings).values({
        ...listing,
        isNew: true,
        isSent: false,
        firstSeen: new Date(),
        lastSeen: new Date(),
      });

      // Fetch the inserted record
      const inserted = await db
        .select()
        .from(listings)
        .where(
          and(
            eq(listings.platform, listing.platform),
            eq(listings.platformId, listing.platformId)
          )
        )
        .limit(1);

      if (inserted[0]) saved.push(inserted[0]);
    } catch (err) {
      console.error(`[Scraper] Error saving listing ${listing.platformId}:`, err);
    }
  }

  return saved;
}

/**
 * Load search config from DB with defaults.
 */
async function loadSearchConfig(): Promise<SearchParams & { enableCian: boolean; enableAvito: boolean; enableYandex: boolean }> {
  const db = await getDb();
  const configs = db
    ? await db.select().from(searchConfig).where(eq(searchConfig.active, true)).limit(1)
    : [];
  const config = configs[0];

  return {
    minArea: config?.minArea ?? 40,
    maxArea: config?.maxArea ?? 70,
    minPrice: Number(config?.minPrice ?? 50000),
    maxPrice: Number(config?.maxPrice ?? 90000),
    footMin: config?.footMin ?? 45,
    metroStations: (config?.metroStations as string[]) ?? [],
    officeType: config?.officeType ?? "office",
    transportType: (config?.transportType as "foot" | "transport") ?? "foot",
    maxPages: config?.maxPages ?? 2,
    minFloor: config?.minFloor ?? null,
    maxFloor: config?.maxFloor ?? null,
    keywords: (config?.keywords as string[]) ?? [],
    districts: (config?.districts as string[]) ?? [],
    enableCian: config?.enableCian ?? true,
    enableAvito: config?.enableAvito ?? true,
    enableYandex: config?.enableYandex ?? true,
  };
}

/**
 * Run scraper for a single platform.
 */
export async function runPlatformScrape(platform: Platform): Promise<ScrapeResult> {
  const logId = await startScrapeLog(platform);

  try {
    const config = await loadSearchConfig();

    // Check if platform is enabled
    if (platform === "cian" && !config.enableCian) {
      console.log("[Scraper] CIAN is disabled, skipping");
      await finishScrapeLog(logId, 0, 0, 0, "success");
      return { platform, found: 0, newCount: 0, newListings: [] };
    }
    if (platform === "avito" && !config.enableAvito) {
      console.log("[Scraper] Avito is disabled, skipping");
      await finishScrapeLog(logId, 0, 0, 0, "success");
      return { platform, found: 0, newCount: 0, newListings: [] };
    }
    if (platform === "yandex" && !config.enableYandex) {
      console.log("[Scraper] Yandex is disabled, skipping");
      await finishScrapeLog(logId, 0, 0, 0, "success");
      return { platform, found: 0, newCount: 0, newListings: [] };
    }

    // Run platform scraper
    let scraped: InsertListing[] = [];
    if (platform === "cian") scraped = await scrapeCian(config);
    else if (platform === "avito") scraped = await scrapeAvito(config);
    else if (platform === "yandex") scraped = await scrapeYandex(config);

    // Apply keyword, floor, and district filters
    const filtered = scraped.filter(
      (l) =>
        applyKeywordFilter(l, config.keywords) &&
        applyFloorFilter(l, config.minFloor, config.maxFloor) &&
        applyDistrictFilter(l, config.districts)
    );

    if (filtered.length < scraped.length) {
      console.log(
        `[Scraper] Filtered ${scraped.length - filtered.length} listings by keywords/floor/district` +
        (config.districts.length > 0 ? ` (districts: ${config.districts.join(", ")})` : "")
      );
    }

    // Deduplicate
    const newOnes = await deduplicateListings(filtered, platform);

    // Save new listings
    const savedListings = await saveNewListings(newOnes);

    await finishScrapeLog(logId, filtered.length, newOnes.length, 0, "success");

    return {
      platform,
      found: filtered.length,
      newCount: newOnes.length,
      newListings: savedListings,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Scraper] Platform ${platform} failed:`, errMsg);
    await finishScrapeLog(logId, 0, 0, 0, "error", errMsg);
    return { platform, found: 0, newCount: 0, newListings: [], error: errMsg };
  }
}

/**
 * Run all platform scrapers in sequence.
 */
export async function runAllScrapers(): Promise<ScrapeResult> {
  console.log("[Scraper] Starting full scrape run...");
  const config = await loadSearchConfig();
  const platforms: Platform[] = [];
  if (config.enableCian) platforms.push("cian");
  if (config.enableAvito) platforms.push("avito");
  if (config.enableYandex) platforms.push("yandex");

  if (platforms.length === 0) {
    console.log("[Scraper] All platforms disabled, skipping run");
    return { platform: "all", found: 0, newCount: 0, newListings: [] };
  }

  const allNew: (typeof listings.$inferSelect)[] = [];
  let totalFound = 0;
  let totalNew = 0;

  for (const platform of platforms) {
    const result = await runPlatformScrape(platform);
    totalFound += result.found;
    totalNew += result.newCount;
    allNew.push(...result.newListings);
    // Delay between platforms
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(`[Scraper] Full run complete: ${totalFound} found, ${totalNew} new`);
  return {
    platform: "all",
    found: totalFound,
    newCount: totalNew,
    newListings: allNew,
  };
}

// ---- Scrape log helpers ----

async function startScrapeLog(platform: Platform | "all"): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    await db.insert(scrapeLogs).values({ platform, status: "running" });
    const rows = await db
      .select({ id: scrapeLogs.id })
      .from(scrapeLogs)
      .where(eq(scrapeLogs.platform, platform))
      .orderBy(scrapeLogs.startedAt)
      .limit(1);
    return rows[0]?.id ?? 0;
  } catch {
    return 0;
  }
}

async function finishScrapeLog(
  logId: number,
  found: number,
  newCount: number,
  sentCount: number,
  status: "success" | "error",
  errorMessage?: string
): Promise<void> {
  if (!logId) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(scrapeLogs)
      .set({ finishedAt: new Date(), found, newCount, sentCount, status, errorMessage })
      .where(eq(scrapeLogs.id, logId));
  } catch {
    // ignore
  }
}
