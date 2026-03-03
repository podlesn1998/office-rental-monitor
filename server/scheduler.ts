import { runAllScrapers } from "./scrapers/index";
import { sendPendingListings, sendStatusMessage, handleTelegramUpdate } from "./telegram";
import { getTelegramConfig } from "./db";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Run one full monitoring cycle: scrape all platforms, send new listings via Telegram.
 */
export async function runMonitoringCycle(): Promise<void> {
  if (isRunning) {
    console.log("[Scheduler] Cycle already running, skipping...");
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[Scheduler] Starting monitoring cycle at ${new Date().toISOString()}`);

  try {
    const result = await runAllScrapers();

    if (result.newCount > 0) {
      console.log(`[Scheduler] Found ${result.newCount} new listings, sending notifications...`);
      const sent = await sendPendingListings();
      console.log(`[Scheduler] Sent ${sent} Telegram notifications`);
    } else {
      console.log("[Scheduler] No new listings found");
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scheduler] Cycle complete in ${duration}s: ${result.found} found, ${result.newCount} new`);
  } catch (err) {
    console.error("[Scheduler] Cycle error:", err);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the 30-minute monitoring scheduler.
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    console.log("[Scheduler] Already started");
    return;
  }

  console.log("[Scheduler] Starting 30-minute monitoring scheduler...");

  // Run first cycle after 2 minutes (let server fully start and DB connect)
  setTimeout(async () => {
    console.log("[Scheduler] Running initial cycle on startup...");
    await runMonitoringCycle();
  }, 120000); // 2 min delay

  // Then run every 30 minutes
  schedulerInterval = setInterval(async () => {
    await runMonitoringCycle();
  }, INTERVAL_MS);

  console.log(`[Scheduler] Scheduler started. First run in 2 minutes, then every 30 minutes.`);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Scheduler stopped");
  }
}

/**
 * Express route handler for Telegram webhook.
 * Register this at POST /api/telegram/webhook
 */
export async function telegramWebhookHandler(
  req: { body: Record<string, unknown> },
  res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }
): Promise<void> {
  try {
    await handleTelegramUpdate(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err);
    res.status(500).json({ ok: false });
  }
}

/**
 * Register Telegram webhook URL with Telegram API.
 */
export async function registerTelegramWebhook(webhookUrl: string): Promise<boolean> {
  const config = await getTelegramConfig();
  if (!config?.botToken) {
    console.log("[Telegram] No bot token configured, skipping webhook registration");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/setWebhook`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message", "callback_query", "channel_post"],
      }),
    });

    const data = (await response.json()) as { ok: boolean; description?: string };
    if (data.ok) {
      console.log(`[Telegram] Webhook registered: ${webhookUrl}`);
      return true;
    } else {
      console.warn(`[Telegram] Webhook registration failed: ${data.description}`);
      return false;
    }
  } catch (err) {
    console.error("[Telegram] Webhook registration error:", err);
    return false;
  }
}
