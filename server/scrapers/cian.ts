import * as cheerio from "cheerio";
import type { InsertListing } from "../../drizzle/schema";

interface SearchParams {
  minArea: number;
  maxArea: number;
  minPrice: number;
  maxPrice: number;
  footMin: number;
  metroStations: string[];
}

// CIAN metro IDs for Saint Petersburg (from the original search URL)
const SPB_METRO_IDS = [174, 175, 176, 177, 194, 206, 207, 221, 222];

const USER_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.105 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildCianUrl(params: SearchParams, page = 1): string {
  const metroParams = SPB_METRO_IDS.map((id, i) => `metro%5B${i}%5D=${id}`).join("&");
  return (
    `https://spb.cian.ru/cat.php?currency=2&deal_type=rent&engine_version=2` +
    `&foot_min=${params.footMin}&maxarea=${params.maxArea}&maxprice=${params.maxPrice}` +
    `&${metroParams}` +
    `&minarea=${params.minArea}&minprice=${params.minPrice}` +
    `&offer_type=offices&office_type%5B0%5D=5&only_foot=2&region=2&p=${page}`
  );
}

function buildCianApiPayload(params: SearchParams, page = 1) {
  return {
    jsonQuery: {
      _type: "commercialrent",
      engine_version: { type: "term", value: 2 },
      region: { type: "terms", value: [2] },
      deal_type: { type: "term", value: "rent" },
      offer_type: { type: "terms", value: ["offices"] },
      office_type: { type: "terms", value: [5] },
      total_area: { type: "range", value: { gte: params.minArea, lte: params.maxArea } },
      price: { type: "range", value: { gte: params.minPrice, lte: params.maxPrice } },
      foot_min: { type: "range", value: { lte: params.footMin } },
      only_foot: { type: "term", value: "2" },
      metro: { type: "terms", value: SPB_METRO_IDS },
      currency: { type: "term", value: 2 },
      page: { type: "term", value: page },
    },
  };
}

function parseCianApiListing(offer: Record<string, unknown>): InsertListing | null {
  try {
    const id = String(offer.id ?? offer.cianId ?? "");
    if (!id) return null;

    const geo = (offer.geo as Record<string, unknown>) ?? {};
    const address =
      (geo.userInput as string) ??
      ((geo.address as { fullAddress?: string })?.fullAddress) ??
      "";

    const undergrounds = (geo.undergrounds as Array<Record<string, unknown>>) ?? [];
    const metro = undergrounds[0];
    const metroStation = metro ? ((metro.name as string) ?? null) : null;
    const metroDistanceMin = metro ? ((metro.travelTime as number) ?? null) : null;
    const metroDistanceType = metro ? ((metro.travelType as string) ?? "foot") : null;

    const priceInfo = (offer.bargainTerms as Record<string, unknown>) ?? {};
    const price = (priceInfo.priceRur as number) ?? (priceInfo.price as number) ?? null;

    const totalArea = (offer.totalArea as number) ?? null;
    const floorNumber = (offer.floorNumber as number) ?? null;
    const building = (offer.building as Record<string, unknown>) ?? {};
    const totalFloors = (building.floorsCount as number) ?? null;

    const photos = ((offer.photos as Array<Record<string, unknown>>) ?? [])
      .slice(0, 5)
      .map((p) => (p.fullUrl as string) ?? (p.miniUrl as string) ?? "")
      .filter(Boolean);

    const cianUrl = (offer.fullUrl as string) ?? `https://spb.cian.ru/rent/commercial/${id}/`;

    return {
      platform: "cian",
      platformId: id,
      title: null,
      address: address || null,
      district: null,
      metroStation,
      metroDistanceMin,
      metroDistanceType,
      price,
      area: totalArea,
      floor: floorNumber,
      totalFloors,
      description: (offer.description as string) ?? null,
      photos,
      url: cianUrl,
      phone: null,
      isNew: true,
      isSent: false,
      firstSeen: new Date(),
      lastSeen: new Date(),
    };
  } catch {
    return null;
  }
}

async function scrapeCianApi(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];

  // Try multiple API endpoints
  const apiEndpoints = [
    "https://api.cian.ru/search-offers/v2/search-offers-desktop/",
    "https://api.cian.ru/search-offers/v2/search-offers-mobile/",
  ];

  for (const apiUrl of apiEndpoints) {
    if (results.length > 0) break;

    for (let page = 1; page <= 3; page++) {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "User-Agent": randomUA(),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ru-RU,ru;q=0.9",
            "Content-Type": "application/json",
            "Origin": "https://spb.cian.ru",
            "Referer": buildCianUrl(params, page),
            "X-Source": "cian",
          },
          body: JSON.stringify(buildCianApiPayload(params, page)),
          signal: AbortSignal.timeout(15000),
        });

        const text = await response.text();
        if (!text.startsWith("{")) {
          console.log(`[CIAN API] ${apiUrl}: non-JSON response (blocked)`);
          break;
        }

        const data = JSON.parse(text) as Record<string, unknown>;
        const dataObj = (data.data as Record<string, unknown>) ?? {};
        const offers =
          (dataObj.offersSerpData as Array<Record<string, unknown>>) ??
          (dataObj.offersSerialized as Array<Record<string, unknown>>) ??
          [];

        if (offers.length === 0) break;

        for (const offer of offers) {
          const listing = parseCianApiListing(offer);
          if (listing) results.push(listing);
        }

        const paging = dataObj.paging as Record<string, unknown>;
        const totalPages = (paging?.pageCount as number) ?? 1;
        if (page >= totalPages || offers.length < 20) break;
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.log(`[CIAN API] Error on page ${page}:`, err instanceof Error ? err.message : err);
        break;
      }
    }
  }

  return results;
}

async function scrapeCianHtml(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];

  for (let page = 1; page <= 2; page++) {
    try {
      const url = buildCianUrl(params, page);
      console.log(`[CIAN HTML] Fetching page ${page}`);

      const response = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Cache-Control": "max-age=0",
        },
        signal: AbortSignal.timeout(20000),
      });

      const html = await response.text();

      // Try to find JSON embedded in script tags
      const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) ?? [];
      for (const script of scriptMatches) {
        const dataMatch = script.match(/"offersSerpData"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
        if (dataMatch) {
          try {
            const offers = JSON.parse(dataMatch[1]) as Array<Record<string, unknown>>;
            for (const offer of offers) {
              const listing = parseCianApiListing(offer);
              if (listing) results.push(listing);
            }
            if (results.length > 0) break;
          } catch {
            // continue
          }
        }
      }

      if (results.length > 0) break;

      // HTML card parsing fallback
      const $ = cheerio.load(html);

      const selectors = [
        '[data-name="CardComponent"]',
        'article[data-id]',
        '[class*="offer-card"]',
        '[class*="OfferCard"]',
        '[data-testid*="offer"]',
      ];

      let cards = $();
      for (const sel of selectors) {
        cards = $(sel);
        if (cards.length > 0) break;
      }

      if (cards.length === 0) {
        console.log(`[CIAN HTML] No listing cards found on page ${page} (likely blocked)`);
        break;
      }

      cards.each((_, el) => {
        const card = $(el);
        const link = card.find("a").filter((_, a) => {
          const href = $(a).attr("href") ?? "";
          return href.includes("/rent/commercial/") || href.includes("cian.ru");
        }).first();
        const href = link.attr("href");
        if (!href) return;

        const idMatch = href.match(/\/(\d+)\/?$/);
        const platformId = idMatch ? idMatch[1] : href.replace(/\W/g, "").slice(-20);

        const priceText = card.find('[data-testid*="price"], [class*="price"]').first().text();
        const priceMatch = priceText.replace(/\s/g, "").match(/(\d{4,})/);
        const price = priceMatch ? parseInt(priceMatch[1]) : null;

        const areaText = card.find('[class*="area"], [data-testid*="area"]').first().text();
        const areaMatch = areaText.match(/(\d+)/);
        const area = areaMatch ? parseInt(areaMatch[1]) : null;

        const address = card.find('[class*="address"], [data-testid*="address"]').first().text().trim() || null;
        const metro = card.find('[class*="underground"], [data-testid*="underground"]').first().text().trim() || null;

        results.push({
          platform: "cian",
          platformId,
          title: null,
          address,
          district: null,
          metroStation: metro,
          metroDistanceMin: null,
          metroDistanceType: "foot",
          price,
          area,
          floor: null,
          totalFloors: null,
          description: null,
          photos: [],
          url: href.startsWith("http") ? href : `https://spb.cian.ru${href}`,
          phone: null,
          isNew: true,
          isSent: false,
          firstSeen: new Date(),
          lastSeen: new Date(),
        });
      });

      if (results.length > 0) break;
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.log(`[CIAN HTML] Error on page ${page}:`, err instanceof Error ? err.message : err);
      break;
    }
  }

  return results;
}

export async function scrapeCian(params: SearchParams): Promise<InsertListing[]> {
  let results = await scrapeCianApi(params);

  if (results.length === 0) {
    console.log("[CIAN] API blocked, trying HTML scraping...");
    results = await scrapeCianHtml(params);
  }

  console.log(`[CIAN] Scraped ${results.length} listings`);
  return results;
}
