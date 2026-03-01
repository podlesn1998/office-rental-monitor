import type { InsertListing } from "../../drizzle/schema";
import { createStealthPage } from "./browser";
import type { SearchParams } from "./index";

// CIAN office type codes
const OFFICE_TYPE_CODES: Record<string, number[]> = {
  office: [5],           // Офис
  coworking: [9],        // Коворкинг
  free_purpose: [4],     // Свободного назначения
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
}>> {
  return page.evaluate(() => {
    const cardResults: Array<{
      id: string; href: string; price: number | null; area: number | null;
      metro: string; metroMin: number | null; address: string; imgSrc: string; title: string;
    }> = [];

    const links = Array.from(document.querySelectorAll('a[href*="/rent/commercial/"]'));
    const seenIds: string[] = [];

    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      const idMatch = href.match(/\/rent\/commercial\/(\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      if (seenIds.includes(id)) continue;
      seenIds.push(id);

      let container: Element | null = link.parentElement;
      let depth = 0;
      while (container && depth < 12) {
        const text = container.textContent ?? "";
        if (text.includes("₽/мес") && text.includes("м²")) break;
        container = container.parentElement;
        depth++;
      }
      if (!container) continue;

      const priceEl = container.querySelector('[class*="price"], [class*="Price"]');
      let price: number | null = null;
      if (priceEl) {
        const priceMatch = (priceEl.textContent ?? "").replace(/\s/g, "").match(/(\d{4,})/);
        if (priceMatch) price = parseInt(priceMatch[1]);
      }

      const fullText = container.textContent ?? "";
      const areaMatch = fullText.match(/(\d+[,.]?\d*)\s*м²/);
      const area = areaMatch ? parseFloat(areaMatch[1].replace(",", ".")) : null;

      const metroEl = container.querySelector('[class*="underground"], [class*="metro"]');
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

      let address = "";
      const addressEls = container.querySelectorAll('[class*="address"], [class*="Address"]');
      for (const addrEl of Array.from(addressEls)) {
        const text = addrEl.textContent?.trim() ?? "";
        if (text && !text.includes("⋅") && text.length > 5) {
          address = text;
          break;
        }
      }

      const imgEl = container.querySelector("img");
      const imgSrc = (imgEl?.src ?? imgEl?.getAttribute("data-src") ?? "").slice(0, 200);

      const titleEl = container.querySelector('[class*="title"], [class*="Title"], [class*="name"]');
      const titleText = titleEl?.textContent?.trim() ?? "";

      cardResults.push({ id, href, price, area, metro, metroMin, address, imgSrc, title: titleText });
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

        if (
          title.toLowerCase().includes("captcha") ||
          title.toLowerCase().includes("robot") ||
          title.toLowerCase().includes("не робот")
        ) {
          console.warn("[CIAN] Captcha detected, stopping");
          break;
        }

        const cards = await parseCianPage(page);
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
            district: null,
            metroStation: card.metro || null,
            metroDistanceMin: card.metroMin,
            metroDistanceType: params.transportType,
            price: card.price,
            area: card.area ? Math.round(card.area) : null,
            floor: null,
            totalFloors: null,
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

  console.log(`[CIAN] Total scraped: ${results.length} listings`);
  return results;
}
