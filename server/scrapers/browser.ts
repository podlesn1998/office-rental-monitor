import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright-core";
import * as fs from "fs";
import * as path from "path";
import { getNextProxy, refreshProxies } from "./proxyLine";

// Register stealth plugin once
chromiumExtra.use(StealthPlugin());

let _browser: Browser | null = null;
let _scrapeLock = false;
let _lockWaiters: Array<() => void> = [];

// Auto-detect Chromium executable — try multiple common paths in order
function detectChromiumPath(): string {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium-browser",   // Ubuntu snap / apt
    "/usr/bin/chromium",           // Debian / Alpine
    "/usr/bin/google-chrome",      // Google Chrome deb
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",          // Ubuntu snap
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      console.log(`[Browser] Using Chromium at: ${p}`);
      return p;
    }
  }
  // Fallback — let Playwright use its own bundled browser
  console.warn("[Browser] No system Chromium found, using Playwright default");
  return "";
}

const CHROMIUM_PATH = detectChromiumPath();

// Session storage path for Yandex cookies
const SESSION_DIR = path.join(process.cwd(), ".sessions");
const YANDEX_SESSION_PATH = path.join(SESSION_DIR, "yandex.json");

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  console.log("[Browser] Launching Chromium (stealth)...");
  const launched = await (chromiumExtra as any).launch({
    ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
    headless: true,
    // Timeout for the browser launch itself — prevents hanging if Chromium
    // fails to start (e.g. missing binary, OOM, zombie process).
    timeout: 30000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1366,768",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  _browser = launched as Browser;

  _browser.on("disconnected", () => {
    console.log("[Browser] Disconnected, will relaunch on next request");
    _browser = null;
  });

  return _browser;
}

/**
 * Acquire the global scrape lock. Only one scraper runs at a time to prevent
 * browser context conflicts. Waits up to 3 minutes if another scrape is running.
 */
export async function acquireScrapeLock(timeoutMs = 180000): Promise<boolean> {
  if (!_scrapeLock) {
    _scrapeLock = true;
    return true;
  }
  // Wait for lock to be released
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const idx = _lockWaiters.indexOf(release);
      if (idx !== -1) _lockWaiters.splice(idx, 1);
      resolve(false); // timeout
    }, timeoutMs);

    const release = () => {
      clearTimeout(timer);
      _scrapeLock = true;
      resolve(true);
    };
    _lockWaiters.push(release);
  });
}

export function releaseScrapeLock(): void {
  _scrapeLock = false;
  const next = _lockWaiters.shift();
  if (next) next();
}

/** Rotate through realistic Chrome User-Agents */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Random viewport sizes to avoid fingerprinting */
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
];

function randomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

export async function createStealthPage(): Promise<{ page: Page; context: BrowserContext }> {
  const browser = await getBrowser();
  const ua = randomUA();
  const vp = randomViewport();

  const context = await browser.newContext({
    userAgent: ua,
    viewport: vp,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    extraHTTPHeaders: {
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  // Additional stealth patches on top of the plugin
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en-US", "en"] });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Block heavy resources to speed up loading
  await page.route("**/*.{woff,woff2,ttf,eot}", (route) => route.abort());
  await page.route("**/analytics/**", (route) => route.abort());
  await page.route("**/metrika/**", (route) => route.abort());
  await page.route("**/mc.yandex.ru/**", (route) => route.abort());
  await page.route("**/top-fwz1.mail.ru/**", (route) => route.abort());

  return { page, context };
}

/**
 * Create a stealth page with Yandex session cookies loaded (if available).
 * Optionally uses a ProxyLine residential proxy to bypass IP-level captcha.
 *
 * @param useProxy - if true, fetch a proxy from ProxyLine and route traffic through it.
 *                   Falls back to direct connection if no proxies are available.
 */
export async function createYandexStealthPage(
  useProxy = false
): Promise<{ page: Page; context: BrowserContext; proxyUsed: boolean }> {
  const browser = await getBrowser();
  const ua = randomUA();
  const vp = randomViewport();

  // Load saved session if it exists and is fresh (< 14 days)
  let storageState: string | undefined;
  if (fs.existsSync(YANDEX_SESSION_PATH)) {
    try {
      const stat = fs.statSync(YANDEX_SESSION_PATH);
      const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
      if (ageDays < 14) {
        storageState = YANDEX_SESSION_PATH;
        console.log(`[Yandex] Loading saved session (${ageDays.toFixed(1)} days old)`);
      } else {
        console.log(`[Yandex] Session expired (${ageDays.toFixed(1)} days), starting fresh`);
      }
    } catch {
      // ignore
    }
  }

  // Optionally attach a residential proxy
  let proxyConfig: { server: string; username: string; password: string } | undefined;
  let proxyUsed = false;
  if (useProxy) {
    const proxy = await getNextProxy();
    if (proxy) {
      proxyConfig = proxy;
      proxyUsed = true;
      console.log(`[Yandex] Using proxy: ${proxy.server}`);
    } else {
      console.log("[Yandex] No proxies available, using direct connection");
    }
  }

  const context = await browser.newContext({
    userAgent: ua,
    viewport: vp,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    extraHTTPHeaders: {
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    ...(storageState ? { storageState } : {}),
    ...(proxyConfig ? { proxy: proxyConfig } : {}),
  });

  // Additional stealth patches
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en-US", "en"] });
    // @ts-ignore
    window.chrome = { runtime: {} };
    // Fake screen dimensions
    Object.defineProperty(screen, "width", { get: () => 1920 });
    Object.defineProperty(screen, "height", { get: () => 1080 });
    // Fake hardware concurrency
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    // Fake device memory
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
  });

  const page = await context.newPage();

  // Block heavy resources
  await page.route("**/*.{woff,woff2,ttf,eot}", (route) => route.abort());
  await page.route("**/analytics/**", (route) => route.abort());
  await page.route("**/metrika/**", (route) => route.abort());
  await page.route("**/mc.yandex.ru/**", (route) => route.abort());
  await page.route("**/top-fwz1.mail.ru/**", (route) => route.abort());

  return { page, context, proxyUsed };
}

/**
 * Save current Yandex session cookies to disk for reuse.
 */
export async function saveYandexSession(context: BrowserContext): Promise<void> {
  try {
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
    await context.storageState({ path: YANDEX_SESSION_PATH });
    console.log("[Yandex] Session saved to disk");
  } catch (err) {
    console.warn("[Yandex] Failed to save session:", err instanceof Error ? err.message : err);
  }
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// Re-export refreshProxies for use in scraper when a proxy fails
export { refreshProxies };
