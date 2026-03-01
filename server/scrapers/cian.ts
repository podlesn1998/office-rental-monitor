import type { InsertListing } from "../../drizzle/schema";
import { createStealthPage } from "./browser";

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

export async function scrapeCian(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const { page, context } = await createStealthPage();

  try {
    const url = buildCianUrl(params, 1);
    console.log(`[CIAN] Navigating to: ${url}`);

    await page.goto(url, { waitUntil: "load", timeout: 35000 });
    await page.waitForTimeout(4000);

    const title = await page.title();
    console.log(`[CIAN] Page title: ${title}`);

    if (title.toLowerCase().includes("captcha") || title.toLowerCase().includes("robot")) {
      console.warn("[CIAN] Captcha detected");
      return results;
    }

    // Parse offer cards from DOM using the approach that works
    const cards = await page.evaluate(() => {
      const cardResults: Array<{
        id: string;
        href: string;
        price: number | null;
        area: number | null;
        metro: string;
        metroMin: number | null;
        address: string;
        imgSrc: string;
        title: string;
      }> = [];

      const links = Array.from(document.querySelectorAll('a[href*="/rent/commercial/"]'));
      const seenIds = new Set<string>();

      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const idMatch = href.match(/\/rent\/commercial\/(\d+)/);
        if (!idMatch) continue;
        const id = idMatch[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        // Walk up to find the card container (has both price and area)
        let container: Element | null = link.parentElement;
        let depth = 0;
        while (container && depth < 12) {
          const text = container.textContent ?? "";
          if (text.includes("₽/мес") && text.includes("м²")) break;
          container = container.parentElement;
          depth++;
        }
        if (!container) continue;

        // Extract price from dedicated price element
        const priceEl = container.querySelector('[class*="price"], [class*="Price"]');
        let price: number | null = null;
        if (priceEl) {
          const priceText = priceEl.textContent ?? "";
          const priceMatch = priceText.replace(/\s/g, "").match(/(\d{4,})/);
          if (priceMatch) price = parseInt(priceMatch[1]);
        }

        // Extract area - look for "м²" pattern
        const fullText = container.textContent ?? "";
        const areaMatch = fullText.match(/(\d+[,.]?\d*)\s*м²/);
        const area = areaMatch ? parseFloat(areaMatch[1].replace(",", ".")) : null;

        // Extract metro station and distance
        const metroEl = container.querySelector('[class*="underground"], [class*="metro"]');
        let metro = "";
        let metroMin: number | null = null;
        if (metroEl) {
          const metroText = metroEl.textContent ?? "";
          // Try to split metro name from distance
          const metroMatch = metroText.match(/^([^⋅•·]+)[⋅•·]\s*(\d+)\s*мин/);
          if (metroMatch) {
            metro = metroMatch[1].trim();
            metroMin = parseInt(metroMatch[2]);
          } else {
            metro = metroText.trim();
          }
        }

        // Extract address - find address element that doesn't contain metro
        let address = "";
        const addressEls = container.querySelectorAll('[class*="address"], [class*="Address"]');
        for (const addrEl of Array.from(addressEls)) {
          const text = addrEl.textContent?.trim() ?? "";
          if (text && !text.includes("⋅") && text.length > 5) {
            address = text;
            break;
          }
        }
        // Fallback: extract address from full text after metro
        if (!address && metro) {
          const afterMetro = fullText.split(metro).pop() ?? "";
          const addrMatch = afterMetro.match(/Санкт-Петербург[^,\n]{0,100}/);
          if (addrMatch) address = addrMatch[0].trim();
        }

        // Get image
        const imgEl = container.querySelector("img");
        const imgSrc = (imgEl?.src ?? imgEl?.getAttribute("data-src") ?? "").slice(0, 200);

        // Get title/building name
        const titleEl = container.querySelector('[class*="title"], [class*="Title"], [class*="name"]');
        const titleText = titleEl?.textContent?.trim() ?? "";

        cardResults.push({ id, href, price, area, metro, metroMin, address, imgSrc, title: titleText });
      }

      return cardResults;
    });

    console.log(`[CIAN] Parsed ${cards.length} cards from page 1`);

    for (const card of cards) {
      // Clean up the href - remove tracking params
      const cleanUrl = card.href.split("?")[0];

      results.push({
        platform: "cian",
        platformId: card.id,
        title: card.title || null,
        address: card.address || null,
        district: null,
        metroStation: card.metro || null,
        metroDistanceMin: card.metroMin,
        metroDistanceType: "foot",
        price: card.price,
        area: card.area,
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

    // Try page 2 if we got results
    if (results.length > 0) {
      try {
        const url2 = buildCianUrl(params, 2);
        await page.goto(url2, { waitUntil: "load", timeout: 30000 });
        await page.waitForTimeout(3000);

        const cards2 = await page.evaluate(() => {
          const res: Array<{ id: string; href: string; price: number | null; area: number | null; metro: string; metroMin: number | null; address: string }> = [];
          const links = Array.from(document.querySelectorAll('a[href*="/rent/commercial/"]'));
          const seen = new Set<string>();
          for (const link of links) {
            const href = (link as HTMLAnchorElement).href;
            const idMatch = href.match(/\/rent\/commercial\/(\d+)/);
            if (!idMatch) continue;
            const id = idMatch[1];
            if (seen.has(id)) continue;
            seen.add(id);
            let container: Element | null = link.parentElement;
            let depth = 0;
            while (container && depth < 12) {
              const t = container.textContent ?? "";
              if (t.includes("₽/мес") && t.includes("м²")) break;
              container = container.parentElement;
              depth++;
            }
            if (!container) continue;
            const priceEl = container.querySelector('[class*="price"]');
            const priceMatch = (priceEl?.textContent ?? "").replace(/\s/g, "").match(/(\d{4,})/);
            const price = priceMatch ? parseInt(priceMatch[1]) : null;
            const areaMatch = (container.textContent ?? "").match(/(\d+[,.]?\d*)\s*м²/);
            const area = areaMatch ? parseFloat(areaMatch[1].replace(",", ".")) : null;
            const metroEl = container.querySelector('[class*="underground"]');
            const metroText = metroEl?.textContent ?? "";
            const metroMatch = metroText.match(/^([^⋅•·]+)[⋅•·]\s*(\d+)\s*мин/);
            res.push({
              id,
              href: href.split("?")[0],
              price,
              area,
              metro: metroMatch ? metroMatch[1].trim() : metroText.trim(),
              metroMin: metroMatch ? parseInt(metroMatch[2]) : null,
              address: "",
            });
          }
          return res;
        });

        console.log(`[CIAN] Parsed ${cards2.length} cards from page 2`);
        const existingIds = new Set(results.map((r) => r.platformId));
        for (const card of cards2) {
          if (existingIds.has(card.id)) continue;
          results.push({
            platform: "cian",
            platformId: card.id,
            title: null,
            address: card.address || null,
            district: null,
            metroStation: card.metro || null,
            metroDistanceMin: card.metroMin,
            metroDistanceType: "foot",
            price: card.price,
            area: card.area,
            floor: null,
            totalFloors: null,
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
      } catch (e) {
        console.warn("[CIAN] Page 2 failed:", e instanceof Error ? e.message : e);
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
