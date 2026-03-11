import type { InsertListing } from "../../drizzle/schema";
import { createYandexStealthPage, saveYandexSession, refreshProxies } from "./browser";
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

/** Random delay between minMs and maxMs milliseconds */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

/** Simulate human-like mouse movement and scroll on the page */
async function humanBehavior(page: import("playwright-core").Page): Promise<void> {
  try {
    // Random mouse move
    const x = 200 + Math.random() * 800;
    const y = 100 + Math.random() * 500;
    await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });

    // Random scroll down
    const scrollY = 300 + Math.random() * 400;
    await page.evaluate((sy) => window.scrollBy({ top: sy, behavior: "smooth" }), scrollY);
    await randomDelay(500, 1200);

    // Scroll back up a bit
    await page.evaluate(() => window.scrollBy({ top: -100, behavior: "smooth" }));
    await randomDelay(300, 700);
  } catch {
    // ignore — page may have navigated
  }
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

      const priceEl = container.querySelector('[class*="price"], [class*="Price"], [class*="cost"], [class*="Cost"]');
      let price: number | null = null;
      if (priceEl) {
        const priceText = priceEl.textContent?.replace(/[\s\u00a0]/g, "") ?? "";
        const m = priceText.match(/(\d{4,})₽/);
        if (m) price = parseInt(m[1]);
      }
      if (!price) {
        const stripped = fullText.replace(/[\s\u00a0]/g, "");
        const m = stripped.match(/(\d{4,})₽/);
        if (m) price = parseInt(m[1]);
      }
      if (price && price > 5000000) price = null;

      const titleEl = container.querySelector('[class*="title"], [class*="Title"]');
      const titleText = titleEl?.textContent?.trim() ?? "";

      let area: number | null = null;
      const titleAreaMatch = titleText.match(/(\d+[,.]?\d*)\s*м²/);
      if (titleAreaMatch) {
        const val = parseFloat(titleAreaMatch[1].replace(",", "."));
        if (val >= 10 && val <= 500) area = val;
      }
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

      let ceilingHeight: number | null = null;
      const ceilMatch = fullText.match(/(?:потолк[иа]?|высот[аы]\s+потолк[иа]?)[^\d]*(\d+[,.]?\d*)\s*м/i)
        || fullText.match(/высот[аы][^\d]*(\d+[,.]?\d*)\s*м/i);
      if (ceilMatch) {
        const val = parseFloat(ceilMatch[1].replace(",", "."));
        if (val >= 2 && val <= 10) ceilingHeight = Math.round(val * 100);
      }

      let floor: number | null = null;
      let totalFloors: number | null = null;

      const titleFloorMatch = titleText.match(/(\d+)\s*этаж\s+из\s+(\d+)[A-Z]?/i);
      if (titleFloorMatch) {
        const f = parseInt(titleFloorMatch[1]);
        const t = parseInt(titleFloorMatch[2]);
        if (f >= 1 && f <= 100 && t >= 1) { floor = f; totalFloors = t; }
      }

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
 * Fetch a single Yandex offer page via HTTP and extract ceiling height / entrance type.
 * Uses __NEXT_DATA__ JSON embedded in the page (no browser needed).
 */
async function fetchYandexOfferDetails(
  _page: unknown,
  url: string
): Promise<{ ceilingHeight: number | null; entranceSeparate: boolean }> {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
    };
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const html = await resp.text();

    let ceilingHeight: number | null = null;
    let entranceSeparate = false;

    const normalizeCeiling = (val: number): number | null => {
      if (val >= 200 && val <= 600) return Math.round(val);
      if (val >= 2 && val <= 6) return Math.round(val * 100);
      return null;
    };

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const json = JSON.parse(nextDataMatch[1]);
        const jsonStr = JSON.stringify(json);
        const ceilJsonMatch = jsonStr.match(/"ceilingHeight"\s*:\s*([\d.]+)/);
        if (ceilJsonMatch) ceilingHeight = normalizeCeiling(parseFloat(ceilJsonMatch[1]));
        if (/"entranceType"\s*:\s*"SEPARATE"/i.test(jsonStr) || /"SEPARATE_ENTRANCE"/i.test(jsonStr)) {
          entranceSeparate = true;
        }
      } catch { /* ignore */ }
    }

    if (ceilingHeight === null) {
      const ceilJsonMatch = html.match(/"ceilingHeight"\s*:\s*([\d.]+)/);
      if (ceilJsonMatch) ceilingHeight = normalizeCeiling(parseFloat(ceilJsonMatch[1]));
    }

    if (ceilingHeight === null) {
      const textMatch = html.match(/Высота потолков[^<]{0,30}([\d,\.]+)\s*[мm]/i);
      if (textMatch) ceilingHeight = normalizeCeiling(parseFloat(textMatch[1].replace(",", ".")));
    }
    if (!entranceSeparate) {
      entranceSeparate = /отдельн[ыйого\s]+вход/i.test(html);
    }

    return { ceilingHeight, entranceSeparate };
  } catch (err) {
    console.warn(`[Yandex] Detail fetch failed for ${url}:`, err instanceof Error ? err.message : err);
    return { ceilingHeight: null, entranceSeparate: false };
  }
}

export async function scrapeYandex(params: SearchParams): Promise<InsertListing[]> {
  const results: InsertListing[] = [];
  const maxPages = params.maxPages ?? 2;

  // Try without proxy first (faster). If captcha is hit on page 1, retry with proxy.
  // For pages 2+, always use proxy if available.
  const { page, context, proxyUsed } = await createYandexStealthPage(false);
  let proxyContext: import("playwright-core").BrowserContext | null = null;
  let proxyPage: import("playwright-core").Page | null = null;

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildYandexUrl(params, pageNum);
      console.log(`[Yandex] Navigating to page ${pageNum}: ${url}`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
      } catch (navErr) {
        console.warn("[Yandex] Navigation warning:", navErr instanceof Error ? navErr.message : navErr);
      }

      // Human-like behavior: move mouse and scroll before waiting for cards
      await humanBehavior(page);

      // Wait for React to render listing cards
      try {
        await page.waitForSelector('a[href*="/offer/"]', { timeout: 12000 });
      } catch {
        // Cards might not appear (captcha or empty page)
      }

      // Random delay mimicking reading time (longer on first page)
      await randomDelay(pageNum === 1 ? 4000 : 3000, pageNum === 1 ? 8000 : 6000);

      let title = "";
      try {
        title = await page.title();
      } catch {
        title = "";
      }
      console.log(`[Yandex] Page ${pageNum} title: ${title}`);

      const isCaptchaPage =
        title.toLowerCase().includes("captcha") ||
        title.toLowerCase().includes("robot") ||
        title.includes("404") ||
        title.toLowerCase().includes("не робот") ||
        title.toLowerCase().includes("робот");

      if (isCaptchaPage) {
        console.log(`[Yandex] Captcha detected on page ${pageNum}`);

        // Step 1: Try checkbox click (works sometimes on page 1 with fresh session)
        const clicked = await page.evaluate(() => {
          const btn = (document.querySelector('#js-button') ||
                       document.querySelector('.CheckboxCaptcha-Button')) as HTMLElement | null;
          if (btn) { btn.click(); return true; }
          return false;
        });

        let captchaResolved = false;
        if (clicked) {
          try {
            await page.waitForSelector('a[href*="/offer/"]', { timeout: 12000 });
            const newTitle = await page.title().catch(() => '');
            const stillCaptcha = newTitle.toLowerCase().includes('captcha') ||
              newTitle.toLowerCase().includes('робот') ||
              newTitle.toLowerCase().includes('robot');
            if (!stillCaptcha) {
              console.log(`[Yandex] Captcha bypassed via checkbox click!`);
              captchaResolved = true;
              await randomDelay(1500, 2500);
            }
          } catch {
            // checkbox click didn't work
          }
        }

        // Step 2: If checkbox didn't work, retry this page via residential proxy
        if (!captchaResolved) {
          console.log(`[Yandex] Checkbox failed, retrying page ${pageNum} via residential proxy...`);
          try {
            // Close previous proxy context if any
            if (proxyContext) { await proxyContext.close().catch(() => {}); }
            const proxyResult = await createYandexStealthPage(true);
            proxyPage = proxyResult.page;
            proxyContext = proxyResult.context;

            if (!proxyResult.proxyUsed) {
              console.log(`[Yandex] No proxy available, stopping at page ${pageNum}`);
              break;
            }

            const proxyUrl = buildYandexUrl(params, pageNum);
            await proxyPage.goto(proxyUrl, { waitUntil: "domcontentloaded", timeout: 40000 });
            await humanBehavior(proxyPage);
            try {
              await proxyPage.waitForSelector('a[href*="/offer/"]', { timeout: 15000 });
            } catch { /* may be captcha again */ }
            await randomDelay(3000, 6000);

            const proxyTitle = await proxyPage.title().catch(() => '');
            const proxyHasCaptcha = proxyTitle.toLowerCase().includes('captcha') ||
              proxyTitle.toLowerCase().includes('робот') ||
              proxyTitle.toLowerCase().includes('robot');

            if (proxyHasCaptcha) {
              console.log(`[Yandex] Proxy also got captcha on page ${pageNum}, refreshing proxies and stopping`);
              await refreshProxies();
              break;
            }

            console.log(`[Yandex] Proxy page ${pageNum} loaded: ${proxyTitle}`);
            // Parse from proxy page instead
            const proxyCards = await parseYandexPage(proxyPage);
            console.log(`[Yandex] Parsed ${proxyCards.length} cards via proxy from page ${pageNum}`);

            if (proxyCards.length === 0) break;

            const existingIds2 = new Set(results.map((r) => r.platformId));
            for (const card of proxyCards) {
              if (existingIds2.has(card.id)) continue;
              let detailCeilingHeight = card.ceilingHeight;
              let detailEntranceSeparate = false;
              if (card.href) {
                try {
                  const details = await fetchYandexOfferDetails(null, card.href);
                  if (details.ceilingHeight !== null) detailCeilingHeight = details.ceilingHeight;
                  detailEntranceSeparate = details.entranceSeparate;
                } catch { /* ignore */ }
                await randomDelay(800, 2000);
              }
              results.push({
                platform: "yandex", platformId: card.id, title: card.title || null,
                address: card.address || null, district: guessDistrict(card.address),
                metroStation: card.metro || null, metroDistanceMin: card.metroMin,
                metroDistanceType: params.transportType, price: card.price,
                area: card.area ? Math.round(card.area) : null,
                floor: card.floor ?? null, totalFloors: card.totalFloors ?? null,
                ceilingHeight: detailCeilingHeight ?? null,
                description: detailEntranceSeparate ? 'отдельный вход' : null,
                photos: [], url: card.href, phone: null, isNew: true, isSent: false,
                firstSeen: new Date(), lastSeen: new Date(),
              });
            }

            // Save proxy session cookies
            await saveYandexSession(proxyContext);
            // Continue to next page
            if (pageNum < maxPages) await randomDelay(5000, 10000);
            continue;
          } catch (proxyErr) {
            console.warn(`[Yandex] Proxy attempt failed:`, proxyErr instanceof Error ? proxyErr.message : proxyErr);
            await refreshProxies();
            break;
          }
        }
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

        // Fetch detail page via HTTP to get ceiling height
        let detailCeilingHeight = card.ceilingHeight;
        let detailEntranceSeparate = false;
        if (card.href) {
          try {
            const details = await fetchYandexOfferDetails(null, card.href);
            if (details.ceilingHeight !== null) detailCeilingHeight = details.ceilingHeight;
            detailEntranceSeparate = details.entranceSeparate;
            if (details.ceilingHeight !== null || details.entranceSeparate) {
              console.log(`[Yandex] Detail for ${card.id}: ceiling=${details.ceilingHeight}cm entrance_separate=${details.entranceSeparate}`);
            }
          } catch (detailErr) {
            console.warn(`[Yandex] Detail fetch error for ${card.id}:`, detailErr instanceof Error ? detailErr.message : detailErr);
          }
          // Random delay between detail fetches (avoid rate limiting)
          await randomDelay(1000, 2500);
        }

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
        // Random inter-page delay: 5–12 seconds (mimics reading the page)
        const delaySec = (5 + Math.random() * 7).toFixed(1);
        console.log(`[Yandex] Waiting ${delaySec}s before page ${pageNum + 1}...`);
        await randomDelay(5000, 12000);
      }
    }

    // Save session after successful scrape so cookies stay fresh
    await saveYandexSession(context);

  } catch (err) {
    console.error("[Yandex] Scraper error:", err instanceof Error ? err.message : err);
  } finally {
    await context.close();
    if (proxyContext) {
      await proxyContext.close().catch(() => {});
    }
  }

  // Filter by selected districts if any are specified
  if (params.districts && params.districts.length > 0) {
    const before = results.length;
    const filtered = results.filter((r) => {
      if (!r.district) return false;
      return params.districts.includes(r.district);
    });
    console.log(`[Yandex] District filter: ${before} → ${filtered.length} listings (districts: ${params.districts.join(", ")})`);
    return filtered;
  }

  console.log(`[Yandex] Total scraped: ${results.length} listings`);
  return results;
}
