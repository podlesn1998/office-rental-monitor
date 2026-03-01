import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

let _browser: Browser | null = null;

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/usr/bin/chromium-browser";

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  console.log("[Browser] Launching Chromium...");
  _browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
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

  _browser.on("disconnected", () => {
    console.log("[Browser] Disconnected, will relaunch on next request");
    _browser = null;
  });

  return _browser;
}

export async function createStealthPage(): Promise<{ page: Page; context: BrowserContext }> {
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    extraHTTPHeaders: {
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  // Mask automation signals
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["ru-RU", "ru", "en-US", "en"],
    });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Block heavy resources to speed up loading
  await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot}", (route) => route.abort());
  await page.route("**/analytics/**", (route) => route.abort());
  await page.route("**/metrika/**", (route) => route.abort());
  await page.route("**/mc.yandex.ru/**", (route) => route.abort());
  await page.route("**/top-fwz1.mail.ru/**", (route) => route.abort());

  return { page, context };
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}
