import type { InsertListing } from "../../drizzle/schema";
import { createStealthPage } from "./browser";
import type { SearchParams } from "./index";
import { guessDistrict } from "./district";

// Yandex office type URL segments
const YANDEX_OFFICE_TYPE_PATH: Record<string, string> = {
  office: "ofis",
  coworking: "ofis",       // Yandex doesn't separate coworking, use office
  free_purpose: "svobodnoe-naznachenie",
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
  ceilingHeight: number | null;
}>> {
  return page.evaluate(() => {
    const cardResults: Array<{
      id: string; href: string; price: number | null; area: number | null;
      metro: string; metroMin: number | null; address: string; title: string;
      ceilingHeight: number | null;
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

      const priceMatch = fullText.replace(/\s/g, "").match(/(\d{4,})\s*₽/);
      const price = priceMatch ? parseInt(priceMatch[1]) : null;

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

      cardResults.push({ id, href, price, area, metro, metroMin, address, title: titleText, ceilingHeight });
    }

    return cardResults;
  });
}

export async function scrapeYandex(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const { page, context } = await createStealthPage();
  const maxPages = params.maxPages ?? 2;

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
        results.push({
          platform: "yandex",
          platformId: card.id,
          title: card.title || null,
          address: card.address || null,
          district: guessDistrict(card.address),
          metroStation: card.metro || null,
          metroDistanceMin: card.metroMin,
          metroDistanceType: params.transportType,
          price: card.price,
          area: card.area ? Math.round(card.area) : null,
          floor: null,
          totalFloors: null,
          ceilingHeight: card.ceilingHeight ?? null,
          description: null,
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

  // Filter by selected districts if any are specified
  if (params.districts && params.districts.length > 0) {
    const before = results.length;
    const filtered = results.filter((r) => {
      if (!r.address) return true;
      const addr = r.address.toLowerCase();
      return params.districts.some((d) => addr.includes(d.toLowerCase()));
    });
    console.log(`[Yandex] District filter: ${before} → ${filtered.length} listings`);
    return filtered;
  }

  console.log(`[Yandex] Total scraped: ${results.length} listings`);
  return results;
}
