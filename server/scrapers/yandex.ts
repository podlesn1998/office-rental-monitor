import type { InsertListing } from "../../drizzle/schema";
import { createStealthPage } from "./browser";

interface SearchParams {
  minArea: number;
  maxArea: number;
  minPrice: number;
  maxPrice: number;
}

function buildYandexUrl(params: SearchParams, page = 1): string {
  // Correct URL for Yandex Real Estate office rentals in SPb
  const url = new URL(
    "https://realty.yandex.ru/sankt-peterburg/snyat/kommercheskaya-nedvizhimost/ofis/"
  );
  if (params.minArea) url.searchParams.set("areaMin", String(params.minArea));
  if (params.maxArea) url.searchParams.set("areaMax", String(params.maxArea));
  if (params.minPrice) url.searchParams.set("priceMin", String(params.minPrice));
  if (params.maxPrice) url.searchParams.set("priceMax", String(params.maxPrice));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

export async function scrapeYandex(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const { page, context } = await createStealthPage();

  try {
    const url = buildYandexUrl(params, 1);
    console.log(`[Yandex] Navigating to: ${url}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (navErr) {
      // Yandex may redirect; ignore navigation errors and check what we have
      console.warn("[Yandex] Navigation warning:", navErr instanceof Error ? navErr.message : navErr);
    }
    await page.waitForTimeout(5000);

    let title = "";
    try {
      title = await page.title();
    } catch {
      title = "";
    }
    console.log(`[Yandex] Page title: ${title}`);

    if (
      title.toLowerCase().includes("captcha") ||
      title.toLowerCase().includes("robot") ||
      title.includes("404")
    ) {
      console.warn("[Yandex] Blocked or 404");
      return results;
    }

    // Parse offer links and their container cards
    const cards = await page.evaluate(() => {
      const cardResults: Array<{
        id: string;
        href: string;
        price: number | null;
        area: number | null;
        metro: string;
        metroMin: number | null;
        address: string;
        title: string;
      }> = [];

      const links = Array.from(document.querySelectorAll('a[href*="/offer/"]'));
      const seenIds = new Set<string>();

      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const idMatch = href.match(/\/offer\/(\d+)/);
        if (!idMatch) continue;
        const id = idMatch[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        // Walk up to find the card container
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

        // Extract price
        const priceMatch = fullText.replace(/\s/g, "").match(/(\d{4,})\s*₽/);
        const price = priceMatch ? parseInt(priceMatch[1]) : null;

        // Extract area
        const areaMatch = fullText.match(/(\d+[,.]?\d*)\s*м²/);
        const area = areaMatch ? parseFloat(areaMatch[1].replace(",", ".")) : null;

        // Extract metro
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

        // Extract address
        const addressEl = container.querySelector('[class*="address"], [class*="Address"], [class*="location"], [class*="Location"]');
        const address = addressEl?.textContent?.trim() ?? "";

        // Title
        const titleEl = container.querySelector('[class*="title"], [class*="Title"]');
        const titleText = titleEl?.textContent?.trim() ?? "";

        cardResults.push({ id, href, price, area, metro, metroMin, address, title: titleText });
      }

      return cardResults;
    });

    console.log(`[Yandex] Parsed ${cards.length} cards`);

    for (const card of cards) {
      results.push({
        platform: "yandex",
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
        photos: [],
        url: card.href,
        phone: null,
        isNew: true,
        isSent: false,
        firstSeen: new Date(),
        lastSeen: new Date(),
      });
    }
  } catch (err) {
    console.error("[Yandex] Scraper error:", err instanceof Error ? err.message : err);
  } finally {
    await context.close();
  }

  console.log(`[Yandex] Total scraped: ${results.length} listings`);
  return results;
}
