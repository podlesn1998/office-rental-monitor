import * as cheerio from "cheerio";
import type { InsertListing } from "../../drizzle/schema";

interface SearchParams {
  minArea: number;
  maxArea: number;
  minPrice: number;
  maxPrice: number;
}

const AVITO_BASE = "https://www.avito.ru";

// Avito search URL for office rentals in Saint Petersburg
function buildAvitoUrl(params: SearchParams, page = 1): string {
  const url = new URL(`${AVITO_BASE}/sankt-peterburg/kommercheskaya_nedvizhimost/ofisy`);
  url.searchParams.set("deal_type", "rent");
  url.searchParams.set("s_trg", "3"); // commercial
  if (params.minArea) url.searchParams.set("sq_from", String(params.minArea));
  if (params.maxArea) url.searchParams.set("sq_to", String(params.maxArea));
  if (params.minPrice) url.searchParams.set("prc_from", String(params.minPrice));
  if (params.maxPrice) url.searchParams.set("prc_to", String(params.maxPrice));
  if (page > 1) url.searchParams.set("p", String(page));
  return url.toString();
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Cache-Control": "no-cache",
};

function parseAvitoListings(html: string): InsertListing[] {
  const $ = cheerio.load(html);
  const listings: InsertListing[] = [];

  // Avito item cards
  $("[data-marker='item']").each((_, el) => {
    try {
      const $el = $(el);
      const itemId = $el.attr("data-item-id") ?? $el.attr("id") ?? "";
      if (!itemId) return;

      const titleEl = $el.find("[itemprop='name'], [data-marker='item-title']").first();
      const title = titleEl.text().trim() || "Офис";

      const linkEl = $el.find("a[data-marker='item-title']").first();
      const href = linkEl.attr("href") ?? "";
      const url = href.startsWith("http") ? href : `${AVITO_BASE}${href}`;

      const priceEl = $el.find("[data-marker='item-price'] meta[itemprop='price']").first();
      const priceContent = priceEl.attr("content");
      const price = priceContent ? parseInt(priceContent, 10) : null;

      const addressEl = $el.find("[data-marker='item-address']").first();
      const address = addressEl.text().trim();

      // Try to extract area from title or description
      const areaMatch = title.match(/(\d+)\s*м²/) ?? title.match(/(\d+)\s*кв/);
      const area = areaMatch ? parseInt(areaMatch[1], 10) : null;

      // Extract metro from address or geo info
      const metroEl = $el.find("[class*='geo-icons']").first();
      const metroText = metroEl.text().trim();
      const metroStation = metroText || null;

      // Photos
      const photos: string[] = [];
      $el.find("img[src*='avito']").each((_, img) => {
        const src = $(img).attr("src") ?? $(img).attr("data-src") ?? "";
        if (src && !src.includes("avatar") && !src.includes("placeholder")) {
          photos.push(src.replace(/\d+x\d+/, "640x480"));
        }
      });

      listings.push({
        platform: "avito",
        platformId: String(itemId),
        title,
        address,
        metroStation: metroStation ?? undefined,
        metroDistanceMin: null,
        metroDistanceType: "foot",
        price,
        area,
        floor: null,
        totalFloors: null,
        description: null,
        photos: photos.slice(0, 5),
        url,
        phone: null,
        isNew: true,
        isSent: false,
      });
    } catch (err) {
      console.warn("[Avito] Error parsing item:", err);
    }
  });

  return listings;
}

export async function scrapeAvito(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = buildAvitoUrl(params, page);
      console.log(`[Avito] Fetching page ${page}: ${url}`);

      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.warn(`[Avito] HTTP ${response.status} on page ${page}`);
        break;
      }

      const html = await response.text();

      // Check for captcha/block
      if (html.includes("captcha") || html.includes("robot") || html.length < 5000) {
        console.warn("[Avito] Possible block/captcha detected");
        break;
      }

      const pageListings = parseAvitoListings(html);
      if (pageListings.length === 0) break;

      results.push(...pageListings);

      // Polite delay
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[Avito] Error on page ${page}:`, err);
      break;
    }
  }

  console.log(`[Avito] Scraped ${results.length} listings`);
  return results;
}
