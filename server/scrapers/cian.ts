import type { InsertListing } from "../../drizzle/schema";
import { createStealthPage } from "./browser";
import type { SearchParams } from "./index";
import { guessDistrict } from "./district";

// CIAN office type codes
// Verified from live CIAN URLs:
// office_type=4 → Офис
// office_type=5 → Помещение свободного назначения (PSN)
// office_type=9 → Коворкинг
const OFFICE_TYPE_CODES: Record<string, number[]> = {
  office: [4],           // Офис
  coworking: [9],        // Коворкинг
  free_purpose: [5],     // Свободного назначения
  all: [4, 5, 9],        // Все типы
};

// CIAN metro IDs for Saint Petersburg (from the original search URL)
const SPB_METRO_IDS = [174, 175, 176, 177, 194, 206, 207, 221, 222];

function buildCianUrl(params: SearchParams, page = 1): string {
  const officeTypeCodes = OFFICE_TYPE_CODES[params.officeType] ?? OFFICE_TYPE_CODES.office;
  const officeTypeParams = officeTypeCodes
    .map((code, i) => `office_type%5B${i}%5D=${code}`)
    .join("&");

  const metroParams = SPB_METRO_IDS.map((id, i) => `metro%5B${i}%5D=${id}`).join("&");

  // only_foot=2 means "walking", only_foot=1 means "any transport"
  const onlyFoot = params.transportType === "foot" ? 2 : 1;

  return (
    `https://spb.cian.ru/cat.php?currency=2&deal_type=rent&engine_version=2` +
    `&foot_min=${params.footMin}&maxarea=${params.maxArea}&maxprice=${params.maxPrice}` +
    `&${metroParams}` +
    `&minarea=${params.minArea}&minprice=${params.minPrice}` +
    `&offer_type=offices&${officeTypeParams}&only_foot=${onlyFoot}&region=2&p=${page}`
  );
}

async function parseCianPage(page: import("playwright-core").Page): Promise<Array<{
  id: string; href: string; price: number | null; area: number | null;
  metro: string; metroMin: number | null; address: string; imgSrc: string; title: string;
  ceilingHeight: number | null; floor: number | null; totalFloors: number | null;
}>> {
  return page.evaluate(() => {
    const cardResults: Array<{
      id: string; href: string; price: number | null; area: number | null;
      metro: string; metroMin: number | null; address: string; imgSrc: string; title: string;
      ceilingHeight: number | null; floor: number | null; totalFloors: number | null;
    }> = [];

    // New CIAN structure uses data-name="CommercialOfferCard" for each listing card
    const cards = Array.from(document.querySelectorAll('[data-name="CommercialOfferCard"]'));
    console.log('[CIAN-parse] CommercialOfferCard count:', cards.length);

    // Fallback: if new structure not found, try old link-based approach
    if (cards.length === 0) {
      const links = Array.from(document.querySelectorAll('a[href*="/rent/commercial/"]'));
      console.log('[CIAN-parse] Fallback: Total links found:', links.length);
    }

    const seenIds: string[] = [];

    for (const card of cards) {
      // Get the main listing URL
      const link = card.querySelector('a[href*="/rent/commercial/"]') as HTMLAnchorElement | null;
      if (!link) continue;
      const href = link.href;
      const idMatch = href.match(/\/rent\/commercial\/(\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      if (seenIds.includes(id)) continue;
      seenIds.push(id);

      const fullText = card.textContent ?? "";

      // Skip CIAN service banners
      if (
        fullText.includes("Средняя цена") ||
        fullText.includes("Дополнительные предложения") ||
        fullText.includes("Похожие объявления") ||
        fullText.includes("Объявления рядом")
      ) continue;

      // Title — CommercialTitle data-name
      const titleEl = card.querySelector('[data-name="CommercialTitle"]');
      const titleText = titleEl?.textContent?.trim() ?? "";

      // Price — extract from CommercialTitle text or full card text
      // Format: "82 м² за 550 000 руб./мес." or "550 000 ₽/мес."
      let price: number | null = null;
      const priceMatch = fullText.replace(/\s/g, "").match(/(\d{4,})(?:руб|₽)\/мес/);
      if (priceMatch) price = parseInt(priceMatch[1]);

      // Area — extract from CommercialTitle or full text
      // Format: "82 м²" or "77,4 – 199,6 м²" (take first/min value)
      let area: number | null = null;
      const areaRe = /(\d+[,.]?\d*)\s*м²/g;
      let areaM: RegExpExecArray | null;
      while ((areaM = areaRe.exec(fullText)) !== null) {
        const val = parseFloat(areaM[1].replace(",", "."));
        if (val >= 10 && val <= 999) { area = val; break; }
      }

      // Metro — Underground data-name: "Парнас⋅15 минут пешком"
      const metroEl = card.querySelector('[data-name="Underground"]');
      let metro = "";
      let metroMin: number | null = null;
      if (metroEl) {
        const metroText = metroEl.textContent ?? "";
        const metroMatch = metroText.match(/^([^⋅•·]+)[⋅•·]\s*(\d+)\s*мин/);
        if (metroMatch) {
          metro = metroMatch[1].trim();
          metroMin = parseInt(metroMatch[2]);
        } else {
          metro = metroText.trim();
        }
      }

      // Address — build from AddressPathItem elements
      // Parts: ["Санкт-Петербург", "р-н Центральный", "улица Гороховая", "11"]
      const addrParts = Array.from(card.querySelectorAll('[data-name="AddressPathItem"]'))
        .map(el => el.textContent?.trim() ?? "")
        .filter(Boolean);
      // Find street part (contains street keywords)
      const streetKeywords = /улица|проспект|пер\.|набережная|шоссе|бульвар|переулок|пл\.|площадь|линия|аллея|тупик|дорога/i;
      const streetIdx = addrParts.findIndex(p => streetKeywords.test(p));
      let address = "";
      if (streetIdx >= 0) {
        // Street + house number (last part)
        const houseNum = addrParts[addrParts.length - 1];
        address = streetIdx < addrParts.length - 1
          ? `${addrParts[streetIdx]}, ${houseNum}`
          : addrParts[streetIdx];
      } else if (addrParts.length >= 2) {
        // Fallback: last two parts
        address = addrParts.slice(-2).join(", ");
      } else {
        address = addrParts.join(", ");
      }

      // Photos — first img with cdn URL
      const imgEl = card.querySelector("img") as HTMLImageElement | null;
      const imgSrc = (imgEl?.src ?? imgEl?.getAttribute("data-src") ?? "").slice(0, 300);

      // Ceiling height: look for patterns like "потолки 3м", "высота потолков 3.5 м"
      let ceilingHeight: number | null = null;
      const ceilMatch = fullText.match(/(?:потолк[иа]?|высот[аы]\s+потолк[иа]?)[^\d]*(\d+[,.]?\d*)\s*м/i)
        || fullText.match(/высот[аы][^\d]*(\d+[,.]?\d*)\s*м/i);
      if (ceilMatch) {
        const val = parseFloat(ceilMatch[1].replace(",", "."));
        if (val >= 2 && val <= 10) ceilingHeight = Math.round(val * 100);
      }

      // Floor: CommercialFactoid may contain "1 этаж", or title/text has "1/5 эт."
      let floor: number | null = null;
      let totalFloors: number | null = null;
      const floorSlashMatch = fullText.match(/(\d+)\s*\/\s*(\d+)\s*эт/i)
        || fullText.match(/этаж\s+(\d+)\s+из\s+(\d+)/i)
        || fullText.match(/(\d+)\s+из\s+(\d+)\s+эт/i);
      if (floorSlashMatch) {
        const f = parseInt(floorSlashMatch[1]);
        const t = parseInt(floorSlashMatch[2]);
        if (f >= 1 && f <= 100 && t >= f) { floor = f; totalFloors = t; }
      }
      if (floor === null) {
        // CommercialFactoid may have "1 этаж" directly
        const factoids = Array.from(card.querySelectorAll('[data-name="CommercialFactoid"]'))
          .map(el => el.textContent?.trim() ?? "");
        for (const factoid of factoids) {
          const fm = factoid.match(/^(\d+)\s*этаж/i) || factoid.match(/этаж\s*(\d+)/i);
          if (fm) { floor = parseInt(fm[1]); break; }
        }
      }
      if (floor === null) {
        const floorSingleMatch = fullText.match(/(\d+)[-й]?\s*этаж/i)
          || fullText.match(/этаж\s*(\d+)/i);
        if (floorSingleMatch) {
          const f = parseInt(floorSingleMatch[1]);
          if (f >= 1 && f <= 100) floor = f;
        }
      }

      cardResults.push({ id, href, price, area, metro, metroMin, address, imgSrc, title: titleText, ceilingHeight, floor, totalFloors });
    }

    return cardResults;
  });
}

export async function scrapeCian(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const { page, context } = await createStealthPage();
  const maxPages = params.maxPages ?? 2;

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildCianUrl(params, pageNum);
      console.log(`[CIAN] Navigating to page ${pageNum}: ${url}`);

      try {
        await page.goto(url, { waitUntil: "load", timeout: 35000 });
        await page.waitForTimeout(pageNum === 1 ? 4000 : 2500);

        const title = await page.title().catch(() => "");
        console.log(`[CIAN] Page ${pageNum} title: ${title}`);

        // Wait for listing links to appear, then scroll to trigger lazy loading
        await page.waitForSelector('a[href*="/rent/commercial/"]', { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(800);

        if (
          title.toLowerCase().includes("captcha") ||
          title.toLowerCase().includes("robot") ||
          title.toLowerCase().includes("не робот")
        ) {
          console.warn("[CIAN] Captcha detected, stopping");
          break;
        }

        // Capture browser console logs for debugging
        const consoleMsgs: string[] = [];
        const consoleHandler = (msg: import('playwright-core').ConsoleMessage) => {
          if (msg.text().includes('[CIAN-parse]')) consoleMsgs.push(msg.text());
        };
        page.on('console', consoleHandler);
        
        const cards = await parseCianPage(page);
        page.off('console', consoleHandler);
        consoleMsgs.forEach(m => console.log(m));
        console.log(`[CIAN] Parsed ${cards.length} cards from page ${pageNum}`);

        if (cards.length === 0) {
          console.log(`[CIAN] No cards on page ${pageNum}, stopping`);
          break;
        }

        const existingIds = new Set(results.map((r) => r.platformId));
        for (const card of cards) {
          if (existingIds.has(card.id)) continue;
          const cleanUrl = card.href.split("?")[0];
          results.push({
            platform: "cian",
            platformId: card.id,
            title: card.title || null,
            address: card.address || null,
            district: guessDistrict(card.address),
            metroStation: card.metro || null,
            metroDistanceMin: card.metroMin,
            metroDistanceType: params.transportType,
            price: card.price,
            area: card.area ? Math.round(card.area) : null,
            floor: card.floor ?? null,
            totalFloors: card.totalFloors ?? null,
            ceilingHeight: card.ceilingHeight ?? null,
            description: null,
            photos: card.imgSrc ? [card.imgSrc] : [],
            url: cleanUrl || card.href,
            phone: null,
            isNew: true,
            isSent: false,
            firstSeen: new Date(),
            lastSeen: new Date(),
          });
        }

        // Delay between pages
        if (pageNum < maxPages) {
          await page.waitForTimeout(2000);
        }
      } catch (pageErr) {
        console.warn(`[CIAN] Page ${pageNum} error:`, pageErr instanceof Error ? pageErr.message : pageErr);
        break;
      }
    }
  } catch (err) {
    console.error("[CIAN] Scraper error:", err instanceof Error ? err.message : err);
  } finally {
    await context.close();
  }

  // Filter by selected districts if any are specified
  // Also try to extract district from title for CIAN listings that have no address
  for (const r of results) {
    if (!r.district) {
      // Try extracting district from title (e.g. "6-я Васильевского острова линия")
      r.district = guessDistrict(r.title) ?? guessDistrict(r.address);
    }
  }

  if (params.districts && params.districts.length > 0) {
    const before = results.length;
    const filtered = results.filter((r) => {
      if (!r.district) return false; // exclude if district cannot be determined
      return params.districts.includes(r.district);
    });
    console.log(`[CIAN] District filter: ${before} → ${filtered.length} listings (districts: ${params.districts.join(", ")})`);
    return filtered;
  }

  console.log(`[CIAN] Total scraped: ${results.length} listings`);
  return results;
}
