import type { InsertListing } from "../../drizzle/schema";
import { createStealthPage } from "./browser";

interface SearchParams {
  minArea: number;
  maxArea: number;
  minPrice: number;
  maxPrice: number;
}

function buildAvitoUrl(params: SearchParams, page = 1): string {
  const url = new URL("https://www.avito.ru/sankt-peterburg/kommercheskaya_nedvizhimost/ofisy");
  url.searchParams.set("deal_type", "rent");
  if (params.minArea) url.searchParams.set("sq_from", String(params.minArea));
  if (params.maxArea) url.searchParams.set("sq_to", String(params.maxArea));
  if (params.minPrice) url.searchParams.set("prc_from", String(params.minPrice));
  if (params.maxPrice) url.searchParams.set("prc_to", String(params.maxPrice));
  if (page > 1) url.searchParams.set("p", String(page));
  return url.toString();
}

export async function scrapeAvito(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const { page, context } = await createStealthPage();
  // Hard cap on all page operations to prevent indefinite hangs.
  page.setDefaultTimeout(30000);

  try {
    const url = buildAvitoUrl(params, 1);
    console.log(`[Avito] Navigating to: ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const title = await page.title();
    console.log(`[Avito] Page title: ${title}`);

    // Avito aggressively blocks datacenter IPs
    if (
      title.toLowerCase().includes("captcha") ||
      title.toLowerCase().includes("robot") ||
      title.toLowerCase().includes("доступ ограничен") ||
      title.toLowerCase().includes("access denied") ||
      title.toLowerCase().includes("blocked")
    ) {
      console.warn("[Avito] IP blocked — Avito restricts datacenter IPs. Skipping.");
      return results;
    }

    // Parse cards using Avito's data-marker attributes
    const cards = await page.evaluate(() => {
      const cardResults: Array<{
        id: string;
        title: string;
        href: string;
        price: number | null;
        address: string;
        metro: string;
      }> = [];

      const items = Array.from(document.querySelectorAll("[data-marker='item']"));
      for (const item of items) {
        const id = item.getAttribute("data-item-id") ?? "";
        if (!id) continue;

        const titleEl = item.querySelector("[data-marker='item-title']");
        const titleText = titleEl?.textContent?.trim() ?? "";

        const linkEl = item.querySelector("a[data-marker='item-title']");
        const href = (linkEl as HTMLAnchorElement)?.href ?? "";

        // Price
        const priceMeta = item.querySelector("[data-marker='item-price'] meta[itemprop='price']");
        const priceContent = priceMeta?.getAttribute("content") ?? "";
        const price = priceContent ? parseInt(priceContent) : null;

        // Address
        const addressEl = item.querySelector("[data-marker='item-address']");
        const address = addressEl?.textContent?.trim() ?? "";

        // Metro
        const metroEl = item.querySelector("[class*='geo-icons'], [class*='metro']");
        const metro = metroEl?.textContent?.trim() ?? "";

        cardResults.push({ id, title: titleText, href, price, address, metro });
      }
      return cardResults;
    });

    console.log(`[Avito] Parsed ${cards.length} cards`);

    for (const card of cards) {
      const areaMatch = card.title.match(/(\d+[,.]?\d*)\s*м²/);
      const area = areaMatch ? parseFloat(areaMatch[1].replace(",", ".")) : null;

      results.push({
        platform: "avito",
        platformId: card.id,
        title: card.title || null,
        address: card.address || null,
        district: null,
        metroStation: card.metro || null,
        metroDistanceMin: null,
        metroDistanceType: "foot",
        price: card.price,
        area,
        floor: null,
        totalFloors: null,
        description: null,
        photos: [],
        url: card.href || `https://www.avito.ru/items/${card.id}`,
        phone: null,
        isNew: true,
        isSent: false,
        firstSeen: new Date(),
        lastSeen: new Date(),
      });
    }
  } catch (err) {
    console.error("[Avito] Scraper error:", err instanceof Error ? err.message : err);
  } finally {
    await context.close();
  }

  console.log(`[Avito] Scraped ${results.length} listings`);
  return results;
}
