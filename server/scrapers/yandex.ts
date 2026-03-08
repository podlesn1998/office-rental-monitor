import type { InsertListing } from "../../drizzle/schema";
import { createStealthPage } from "./browser";
import type { SearchParams } from "./index";
import { guessDistrict } from "./district";

// Yandex office type URL segments
const YANDEX_OFFICE_TYPE_PATH: Record<string, string> = {
  office: "ofis",
  coworking: "ofis",       // Yandex doesn't separate coworking, use office
  free_purpose: "pomeshchenie-svobodnogo-naznacheniya",
  all: "ofis",
};

function buildYandexUrl(params: SearchParams, page = 1): string {
  const typePath = YANDEX_OFFICE_TYPE_PATH[params.officeType] ?? "ofis";
  const url = new URL(
    `https://realty.yandex.ru/sankt-peterburg/snyat/kommercheskaya-nedvizhimost/${typePath}/`
  );
  if (params.minArea) url.searchParams.set("areaMin", String(params.minArea));
  if (params.maxArea) url.searchParams.set("areaMax", String(params.maxArea));
  if (params.minPrice) url.searchParams.set("priceMin", String(params.minPrice));
  if (params.maxPrice) url.searchParams.set("priceMax", String(params.maxPrice));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

async function parseYandexPage(page: import("playwright-core").Page): Promise<Array<{
  id: string; href: string; price: number | null; area: number | null;
  metro: string; metroMin: number | null; address: string; title: string;
  ceilingHeight: number | null; floor: number | null; totalFloors: number | null;
}>> {
  return page.evaluate(() => {
    const cardResults: Array<{
      id: string; href: string; price: number | null; area: number | null;
      metro: string; metroMin: number | null; address: string; title: string;
      ceilingHeight: number | null; floor: number | null; totalFloors: number | null;
    }> = [];

    const links = Array.from(document.querySelectorAll('a[href*="/offer/"]'));
    const seenIds: string[] = [];

    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      const idMatch = href.match(/\/offer\/(\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      if (seenIds.includes(id)) continue;
      seenIds.push(id);

      let container: Element | null = link.parentElement;
      let depth = 0;
      while (container && depth < 12) {
        const text = container.textContent ?? "";
        if ((text.includes("₽") || text.includes("руб")) && text.includes("м²")) break;
        container = container.parentElement;
        depth++;
      }
      if (!container) continue;

      const fullText = container.textContent ?? "";

      // Extract price: find digits immediately before ₽ (after stripping whitespace)
      // Use a dedicated price element first, fall back to regex on stripped text
      const priceEl = container.querySelector('[class*="price"], [class*="Price"], [class*="cost"], [class*="Cost"]');
      let price: number | null = null;
      if (priceEl) {
        // Strip all whitespace to handle "133 200₽" → "133200₽"
        const priceText = priceEl.textContent?.replace(/[\s\u00a0]/g, "") ?? "";
        const m = priceText.match(/(\d{4,})₽/);
        if (m) price = parseInt(m[1]);
      }
      if (!price) {
        // Fallback: strip all whitespace from full text and find digits before ₽
        const stripped = fullText.replace(/[\s\u00a0]/g, "");
        const m = stripped.match(/(\d{4,})₽/);
        if (m) price = parseInt(m[1]);
      }
      // Sanity check: monthly office rent should not exceed 5,000,000 ₽
      if (price && price > 5000000) price = null;

      // Read title first — Yandex titles reliably contain area as "XX м² · офис"
      const titleEl = container.querySelector('[class*="title"], [class*="Title"]');
      const titleText = titleEl?.textContent?.trim() ?? "";

      // Extract area from title first (most reliable for Yandex)
      let area: number | null = null;
      const titleAreaMatch = titleText.match(/(\d+[,.]?\d*)\s*м²/);
      if (titleAreaMatch) {
        const val = parseFloat(titleAreaMatch[1].replace(",", "."));
        if (val >= 10 && val <= 500) area = val;
      }
      // Fallback: scan fullText if title didn't yield area
      if (!area) {
        const areaRe = /(\d+[,.]?\d*)\s*м²/g;
        let areaM: RegExpExecArray | null;
        while ((areaM = areaRe.exec(fullText)) !== null) {
          const val = parseFloat(areaM[1].replace(",", "."));
          if (val >= 10 && val <= 500) { area = val; break; }
        }
      }

      const metroEl = container.querySelector('[class*="metro"], [class*="Metro"], [class*="underground"], [class*="Underground"]');
      let metro = "";
      let metroMin: number | null = null;
      if (metroEl) {
        const metroText = metroEl.textContent ?? "";
        const metroMatch = metroText.match(/^([^⋅•·\d]+)[⋅•·\s]+(\d+)\s*мин/);
        if (metroMatch) {
          metro = metroMatch[1].trim();
          metroMin = parseInt(metroMatch[2]);
        } else {
          metro = metroText.trim().slice(0, 50);
        }
      }

      const addressEl = container.querySelector('[class*="address"], [class*="Address"], [class*="location"], [class*="Location"]');
      const address = addressEl?.textContent?.trim() ?? "";

      // Extract ceiling height from card text
      let ceilingHeight: number | null = null;
      const ceilMatch = fullText.match(/(?:потолк[иа]?|высот[аы]\s+потолк[иа]?)[^\d]*(\d+[,.]?\d*)\s*м/i)
        || fullText.match(/высот[аы][^\d]*(\d+[,.]?\d*)\s*м/i);
      if (ceilMatch) {
        const val = parseFloat(ceilMatch[1].replace(",", "."));
        if (val >= 2 && val <= 10) ceilingHeight = Math.round(val * 100);
      }

      // Extract floor: patterns like "1/5 эт.", "этаж 2 из 9", "2 этаж", "1-й этаж"
      // Yandex title format: "60 м² · офис · 3 этаж из 5C" (letter suffix like C/B for class)
      let floor: number | null = null;
      let totalFloors: number | null = null;

      // First try title — most reliable for Yandex (format: "N этаж из M[A-Z]?")
      const titleFloorMatch = titleText.match(/(\d+)\s*этаж\s+из\s+(\d+)[A-Z]?/i);
      if (titleFloorMatch) {
        const f = parseInt(titleFloorMatch[1]);
        const t = parseInt(titleFloorMatch[2]);
        if (f >= 1 && f <= 100 && t >= 1) { floor = f; totalFloors = t; }
      }

      // Pattern: "N/M эт." or "этаж N из M" or "N из M эт" (with optional letter suffix)
      if (floor === null) {
        const floorSlashMatch = fullText.match(/(\d+)\s*\/\s*(\d+)\s*эт/i)
          || fullText.match(/этаж\s+(\d+)\s+из\s+(\d+)[A-Z]?/i)
          || fullText.match(/(\d+)\s+этаж\s+из\s+(\d+)[A-Z]?/i)
          || fullText.match(/(\d+)\s+из\s+(\d+)\s+эт/i);
        if (floorSlashMatch) {
          const f = parseInt(floorSlashMatch[1]);
          const t = parseInt(floorSlashMatch[2]);
          if (f >= 1 && f <= 100 && t >= 1) { floor = f; if (!totalFloors) totalFloors = t; }
        }
      }
      // Pattern: "2 этаж" or "2-й этаж" or "этаж 2" (without total)
      if (floor === null) {
        const floorSingleMatch = fullText.match(/(\d+)[-й]?\s*этаж/i)
          || fullText.match(/этаж\s*(\d+)/i);
        if (floorSingleMatch) {
          const f = parseInt(floorSingleMatch[1]);
          if (f >= 1 && f <= 100) floor = f;
        }
      }

      cardResults.push({ id, href, price, area, metro, metroMin, address, title: titleText, ceilingHeight, floor, totalFloors });
    }

    return cardResults;
  });
}

/**
 * Visit a single Yandex offer page and extract extra data from the О доме section.
 * Returns partial data: ceilingHeight (cm), entranceSeparate (bool).
 */
async function fetchYandexOfferDetails(
  page: import("playwright-core").Page,
  url: string
): Promise<{ ceilingHeight: number | null; entranceSeparate: boolean }> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    // Wait briefly for React to render characteristics
    await page.waitForTimeout(2000);

    // Click "ещё N характеристик" if present to expand О доме section
    try {
      const expandBtn = await page.$('span[role="button"], button');
      if (expandBtn) {
        const btnText = await expandBtn.textContent();
        if (btnText && btnText.includes("характеристик")) {
          await expandBtn.click();
          await page.waitForTimeout(1000);
        }
      }
      // Try all buttons/spans that say "ещё N характеристик"
      const allBtns = await page.$$('span[role="button"]');
      for (const btn of allBtns) {
        const t = await btn.textContent();
        if (t && t.includes("характеристик")) {
          await btn.click();
          await page.waitForTimeout(800);
          break;
        }
      }
    } catch {
      // ignore expand errors
    }

    const result = await page.evaluate(() => {
      const text = document.body.innerText;

      // Extract ceiling height: "Высота потолков 2,8 м" or "Высота потолков: 2.8 м"
      let ceilingHeight: number | null = null;
      const ceilMatch = text.match(/Высота потолков[:\s]+([\d,\.]+)\s*м/i);
      if (ceilMatch) {
        const val = parseFloat(ceilMatch[1].replace(",", "."));
        if (val >= 2 && val <= 10) ceilingHeight = Math.round(val * 100);
      }

      // Extract entrance type: "Вход Отдельный" or "Вход: Отдельный"
      let entranceSeparate = false;
      const entranceMatch = text.match(/Вход[:\s]+([^\n]+)/i);
      if (entranceMatch) {
        const entranceVal = entranceMatch[1].trim().toLowerCase();
        entranceSeparate = entranceVal.includes("отдельн") || entranceVal.includes("separate");
      }
      // Also check if "отдельный вход" is mentioned anywhere in the text
      if (!entranceSeparate && /отдельн[ыйого]+\s+вход/i.test(text)) {
        entranceSeparate = true;
      }

      return { ceilingHeight, entranceSeparate };
    });

    return result;
  } catch (err) {
    console.warn(`[Yandex] Detail fetch failed for ${url}:`, err instanceof Error ? err.message : err);
    return { ceilingHeight: null, entranceSeparate: false };
  }
}

export async function scrapeYandex(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const { page, context } = await createStealthPage();
  const maxPages = params.maxPages ?? 2;

  // Separate page for detail fetching (reuse same context)
  let detailPage: import("playwright-core").Page | null = null;
  try {
    detailPage = await context.newPage();
  } catch {
    // detail page creation failed, will skip detail fetching
  }

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildYandexUrl(params, pageNum);
      console.log(`[Yandex] Navigating to page ${pageNum}: ${url}`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
      } catch (navErr) {
        console.warn("[Yandex] Navigation warning:", navErr instanceof Error ? navErr.message : navErr);
      }
      // Wait for React to render listing cards
      try {
        await page.waitForSelector('a[href*="/offer/"]', { timeout: 12000 });
      } catch {
        // Cards might not appear (captcha or empty page)
      }
      await page.waitForTimeout(pageNum === 1 ? 3000 : 2000);

      let title = "";
      try {
        title = await page.title();
      } catch {
        title = "";
      }
      console.log(`[Yandex] Page ${pageNum} title: ${title}`);

      if (
        title.toLowerCase().includes("captcha") ||
        title.toLowerCase().includes("robot") ||
        title.includes("404") ||
        title.toLowerCase().includes("не робот") ||
        title.toLowerCase().includes("робот")
      ) {
        console.warn("[Yandex] Captcha/robot check detected, stopping");
        break;
      }

      const cards = await parseYandexPage(page);
      console.log(`[Yandex] Parsed ${cards.length} cards from page ${pageNum}`);

      if (cards.length === 0) {
        console.log(`[Yandex] No cards on page ${pageNum}, stopping`);
        break;
      }

      const existingIds = new Set(results.map((r) => r.platformId));
      for (const card of cards) {
        if (existingIds.has(card.id)) continue;

        // Fetch detail page to get ceiling height from О доме section
        let detailCeilingHeight = card.ceilingHeight;
        let detailEntranceSeparate = false;
        if (detailPage && card.href) {
          try {
            const details = await fetchYandexOfferDetails(detailPage, card.href);
            if (details.ceilingHeight !== null) detailCeilingHeight = details.ceilingHeight;
            detailEntranceSeparate = details.entranceSeparate;
            if (details.ceilingHeight !== null || details.entranceSeparate) {
              console.log(`[Yandex] Detail for ${card.id}: ceiling=${details.ceilingHeight}cm entrance_separate=${details.entranceSeparate}`);
            }
          } catch (detailErr) {
            console.warn(`[Yandex] Detail fetch error for ${card.id}:`, detailErr instanceof Error ? detailErr.message : detailErr);
          }
          // Small delay to avoid rate limiting
          await detailPage.waitForTimeout(1500);
        }

        // Build title with entrance info if found on detail page
        let titleWithEntrance = card.title || null;
        if (detailEntranceSeparate && titleWithEntrance && !titleWithEntrance.toLowerCase().includes('отдельн')) {
          // We'll store this info in description for scoring purposes
        }

        results.push({
          platform: "yandex",
          platformId: card.id,
          title: titleWithEntrance,
          address: card.address || null,
          district: guessDistrict(card.address),
          metroStation: card.metro || null,
          metroDistanceMin: card.metroMin,
          metroDistanceType: params.transportType,
          price: card.price,
          area: card.area ? Math.round(card.area) : null,
          floor: card.floor ?? null,
          totalFloors: card.totalFloors ?? null,
          ceilingHeight: detailCeilingHeight ?? null,
          description: detailEntranceSeparate ? 'отдельный вход' : null,
          photos: [],
          url: card.href,
          phone: null,
          isNew: true,
          isSent: false,
          firstSeen: new Date(),
          lastSeen: new Date(),
        });
      }

      if (pageNum < maxPages) {
        await page.waitForTimeout(2000);
      }
    }
  } catch (err) {
    console.error("[Yandex] Scraper error:", err instanceof Error ? err.message : err);
  } finally {
    await context.close();
  }
  // detailPage is closed with context

  // Filter by selected districts if any are specified
  if (params.districts && params.districts.length > 0) {
    const before = results.length;
    const filtered = results.filter((r) => {
      if (!r.district) return false; // exclude if district cannot be determined
      return params.districts.includes(r.district);
    });
    console.log(`[Yandex] District filter: ${before} → ${filtered.length} listings (districts: ${params.districts.join(", ")})`);
    return filtered;
  }

  console.log(`[Yandex] Total scraped: ${results.length} listings`);
  return results;
}
