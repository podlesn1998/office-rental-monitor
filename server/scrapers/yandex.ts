import * as cheerio from "cheerio";
import type { InsertListing } from "../../drizzle/schema";

interface SearchParams {
  minArea: number;
  maxArea: number;
  minPrice: number;
  maxPrice: number;
}

const YANDEX_BASE = "https://realty.yandex.ru";

function buildYandexUrl(params: SearchParams, page = 1): string {
  // Yandex Realty URL for commercial office rent in SPb
  const url = new URL(`${YANDEX_BASE}/sankt-peterburg/snyat/ofis/`);
  url.searchParams.set("officeType", "OFFICE");
  url.searchParams.set("areaMin", String(params.minArea));
  url.searchParams.set("areaMax", String(params.maxArea));
  url.searchParams.set("priceMin", String(params.minPrice));
  url.searchParams.set("priceMax", String(params.maxPrice));
  url.searchParams.set("rentType", "MONTHLY");
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
};

// Also try Yandex API endpoint
const YANDEX_API_URL = "https://realty.yandex.ru/gate/search/";

function buildYandexApiPayload(params: SearchParams, page = 1) {
  return {
    type: "RENT",
    category: "COMMERCIAL",
    commercialType: "OFFICE",
    rgid: 417899, // Saint Petersburg region ID
    areaMin: params.minArea,
    areaMax: params.maxArea,
    priceMin: params.minPrice,
    priceMax: params.maxPrice,
    rentType: "MONTHLY",
    page: page - 1,
    pageSize: 20,
  };
}

function parseYandexHtml(html: string): InsertListing[] {
  const $ = cheerio.load(html);
  const listings: InsertListing[] = [];

  // Try to extract JSON data embedded in page
  const scriptContent = $("script[type='application/json']").first().html() ?? "";
  if (scriptContent) {
    try {
      const jsonData = JSON.parse(scriptContent);
      const offers =
        jsonData?.offers?.entities ??
        jsonData?.searchQuery?.offers?.entities ??
        [];

      for (const offer of offers) {
        const listing = parseYandexOffer(offer);
        if (listing) listings.push(listing);
      }
      return listings;
    } catch {
      // Fall through to HTML parsing
    }
  }

  // HTML fallback parsing
  $("[class*='OfferCard'], [class*='offer-card'], [data-test='offer-card']").each((_, el) => {
    try {
      const $el = $(el);
      const id =
        $el.attr("data-offer-id") ??
        $el.find("[data-offer-id]").attr("data-offer-id") ??
        "";
      if (!id) return;

      const title = $el.find("[class*='title'], [class*='Title']").first().text().trim();
      const priceText = $el.find("[class*='price'], [class*='Price']").first().text().trim();
      const price = parseInt(priceText.replace(/\D/g, ""), 10) || null;

      const address = $el.find("[class*='address'], [class*='Address']").first().text().trim();
      const metro = $el.find("[class*='metro'], [class*='Metro']").first().text().trim();

      const areaMatch = title.match(/(\d+)\s*м²/);
      const area = areaMatch ? parseInt(areaMatch[1], 10) : null;

      const linkEl = $el.find("a[href*='/offer/']").first();
      const href = linkEl.attr("href") ?? "";
      const url = href.startsWith("http") ? href : `${YANDEX_BASE}${href}`;

      if (!url || url === YANDEX_BASE) return;

      listings.push({
        platform: "yandex",
        platformId: id,
        title: title || "Офис",
        address,
        metroStation: metro || undefined,
        metroDistanceMin: null,
        metroDistanceType: "foot",
        price,
        area,
        floor: null,
        totalFloors: null,
        description: null,
        photos: [],
        url,
        phone: null,
        isNew: true,
        isSent: false,
      });
    } catch (err) {
      console.warn("[Yandex] Error parsing card:", err);
    }
  });

  return listings;
}

function parseYandexOffer(offer: Record<string, unknown>): InsertListing | null {
  try {
    const id = String(offer.offerId ?? offer.id ?? "");
    if (!id) return null;

    const building = (offer.building as Record<string, unknown>) ?? {};
    const location = (offer.location as Record<string, unknown>) ?? {};
    const price = (offer.price as Record<string, unknown>) ?? {};
    const area = (offer.area as Record<string, unknown>) ?? {};

    const metroList = (location.metro as Array<Record<string, unknown>>) ?? [];
    const metro = metroList[0];

    const photos = ((offer.photos as Array<Record<string, unknown>>) ?? [])
      .slice(0, 5)
      .map((p) => (p.fullUrl as string) ?? (p.appMiddleSnippetUrl as string) ?? "")
      .filter(Boolean);

    return {
      platform: "yandex",
      platformId: id,
      title: (offer.roomsTotal as string) ? `Офис ${area.value ?? ""}м²` : "Офис",
      address: (location.address as string) ?? "",
      metroStation: (metro?.name as string) ?? undefined,
      metroDistanceMin: (metro?.timeOnFoot as number) ?? null,
      metroDistanceType: "foot",
      price: (price.value as number) ?? null,
      area: (area.value as number) ?? null,
      floor: (building.builtYear as number) ? null : (offer.floorsOffered as number) ?? null,
      totalFloors: (building.floors as number) ?? null,
      description: (offer.description as string) ?? null,
      photos,
      url: `${YANDEX_BASE}/offer/${id}/`,
      phone: null,
      isNew: true,
      isSent: false,
    };
  } catch {
    return null;
  }
}

export async function scrapeYandex(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = buildYandexUrl(params, page);
      console.log(`[Yandex] Fetching page ${page}: ${url}`);

      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.warn(`[Yandex] HTTP ${response.status} on page ${page}`);
        break;
      }

      const html = await response.text();

      if (html.includes("captcha") || html.length < 3000) {
        console.warn("[Yandex] Possible block detected");
        break;
      }

      const pageListings = parseYandexHtml(html);
      if (pageListings.length === 0) break;

      results.push(...pageListings);

      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[Yandex] Error on page ${page}:`, err);
      break;
    }
  }

  console.log(`[Yandex] Scraped ${results.length} listings`);
  return results;
}
