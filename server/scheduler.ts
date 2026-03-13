import { runAllScrapers } from "./scrapers/index";
import { sendPendingListings, sendStatusMessage, handleTelegramUpdate } from "./telegram";
import { getTelegramConfig, resetDbConnection } from "./db";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let hourlyReportInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const SCRAPE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes hard timeout

// Hourly stats accumulator — reset every hour when report is sent
const hourlyStats = {
  cyclesRun: 0,
  cyclesTimedOut: 0,
  cyclesErrored: 0,
  newListingsFound: 0,
  notificationsSent: 0,
  hourStart: Date.now(),
};

/**
 * Run one full monitoring cycle with a hard 20-minute timeout.
 * If the scraper hangs, the timeout rejects and isRunning is reset.
 */
export async function runMonitoringCycle(): Promise<void> {
  if (isRunning) {
    console.log("[Scheduler] Cycle already running, skipping...");
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[Scheduler] Starting monitoring cycle at ${new Date().toISOString()}`);

  // Hard timeout promise — rejects after SCRAPE_TIMEOUT_MS
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), SCRAPE_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([runAllScrapers(), timeoutPromise]);

    if (result.newCount > 0) {
      console.log(`[Scheduler] Found ${result.newCount} new listings, sending notifications...`);
      const sent = await sendPendingListings();
      console.log(`[Scheduler] Sent ${sent} Telegram notifications`);
      hourlyStats.notificationsSent += sent;
    } else {
      console.log("[Scheduler] No new listings found");
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scheduler] Cycle complete in ${duration}s: ${result.found} found, ${result.newCount} new`);

    hourlyStats.cyclesRun += 1;
    hourlyStats.newListingsFound += result.newCount;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg === "SCRAPE_TIMEOUT") {
      console.error("[Scheduler] Cycle TIMED OUT after 20 minutes — forcing reset");
      hourlyStats.cyclesTimedOut += 1;
      sendStatusMessage(`⏱ <b>Цикл завис</b> — принудительный сброс после 20 минут`).catch(() => {});
    } else {
      console.error("[Scheduler] Cycle error:", err);
      hourlyStats.cyclesErrored += 1;
      // If DB connection was dropped (idle timeout), reset so next cycle reconnects
      const cause = (err as any)?.cause;
      const code = (err as any)?.code ?? cause?.code;
      if (code === "ECONNRESET" || code === "PROTOCOL_CONNECTION_LOST" || code === "ECONNREFUSED") {
        console.warn("[Scheduler] DB connection lost — resetting pool for next cycle");
        resetDbConnection();
      }
      // Send immediate Telegram alert (fire-and-forget, don't block)
      const shortMsg = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      sendStatusMessage(`⚠️ <b>Ошибка цикла мониторинга</b>\n\n<code>${shortMsg}</code>`).catch(() => {});
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Build and send the hourly Telegram report.
 */
async function sendHourlyReport(): Promise<void> {
  const now = new Date();
  const hourLabel = now.toLocaleString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    timeZone: "Europe/Moscow",
  });

  const durationMin = Math.round((Date.now() - hourlyStats.hourStart) / 60000);

  const statusEmoji =
    hourlyStats.cyclesTimedOut > 0 || hourlyStats.cyclesErrored > 0 ? "⚠️" : "✅";

  const lines: string[] = [
    `${statusEmoji} <b>Отчёт за час</b> — ${hourLabel} МСК`,
    "",
    `🔄 Циклов выполнено: <b>${hourlyStats.cyclesRun}</b>`,
    `🏠 Новых объявлений: <b>${hourlyStats.newListingsFound}</b>`,
    `📨 Уведомлений отправлено: <b>${hourlyStats.notificationsSent}</b>`,
  ];

  if (hourlyStats.cyclesTimedOut > 0) {
    lines.push(`⏱ Зависаний (таймаут 10 мин): <b>${hourlyStats.cyclesTimedOut}</b>`);
  }
  if (hourlyStats.cyclesErrored > 0) {
    lines.push(`❌ Ошибок: <b>${hourlyStats.cyclesErrored}</b>`);
  }

  if (hourlyStats.cyclesRun === 0 && hourlyStats.cyclesTimedOut === 0) {
    lines.push(`\n💤 Циклов не было (сервер только запустился или все платформы отключены)`);
  }

  lines.push(`\n⏰ Период: ${durationMin} мин`);

  const message = lines.join("\n");

  try {
    await sendStatusMessage(message);
    console.log("[Scheduler] Hourly report sent");
  } catch (err) {
    console.error("[Scheduler] Failed to send hourly report:", err);
    // Reset DB pool if connection was lost during report
    const cause = (err as any)?.cause;
    const code = (err as any)?.code ?? cause?.code;
    const msg = (err as any)?.message ?? cause?.message ?? "";
    if (code === "ECONNRESET" || code === "PROTOCOL_CONNECTION_LOST" || msg.includes("Pool is closed")) {
      console.warn("[Scheduler] DB connection lost during hourly report — resetting pool");
      resetDbConnection();
    }
  }

  // Reset stats for next hour
  hourlyStats.cyclesRun = 0;
  hourlyStats.cyclesTimedOut = 0;
  hourlyStats.cyclesErrored = 0;
  hourlyStats.newListingsFound = 0;
  hourlyStats.notificationsSent = 0;
  hourlyStats.hourStart = Date.now();
}

/**
 * Start the 30-minute monitoring scheduler and hourly report.
 */
export async function startScheduler(): Promise<void> {
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

  // Read report interval from DB (default 1h if not configured)
  let intervalHours = 1;
  try {
    const config = await getTelegramConfig();
    if (config?.reportIntervalHours && config.reportIntervalHours > 0) {
      intervalHours = config.reportIntervalHours;
    }
  } catch {
    // DB may not be ready yet — use default
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Align first report to the next multiple of intervalHours past midnight
  const now = new Date();
  const midnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msSinceMidnight = now.getTime() - midnightMs;
  const msUntilNext = intervalMs - (msSinceMidnight % intervalMs);
  const minUntilNext = Math.round(msUntilNext / 60000);
  console.log(`[Scheduler] Report interval: every ${intervalHours}h — first report in ${minUntilNext} min.`);

  setTimeout(() => {
    sendHourlyReport().catch(console.error);
    hourlyReportInterval = setInterval(async () => {
      await sendHourlyReport();
    }, intervalMs);
  }, msUntilNext);

  console.log(`[Scheduler] Scheduler started. First run in 2 minutes, then every 30 minutes. Reports every ${intervalHours}h.`);
}

/**
 * Reschedule the periodic report with a new interval (in hours).
 * Cancels the current timer and starts a new one aligned to clock boundaries.
 */
export function rescheduleReport(intervalHours: number): void {
  if (hourlyReportInterval) {
    clearInterval(hourlyReportInterval);
    hourlyReportInterval = null;
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Align first report to the next multiple of intervalHours past midnight
  const now = new Date();
  const nowMs = now.getTime();
  const midnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msSinceMidnight = nowMs - midnightMs;
  const msUntilNext = intervalMs - (msSinceMidnight % intervalMs);
  const minUntilNext = Math.round(msUntilNext / 60000);

  console.log(`[Scheduler] Rescheduling report: every ${intervalHours}h, first in ${minUntilNext} min`);

  // Reset stats so the first report covers only the new period
  hourlyStats.cyclesRun = 0;
  hourlyStats.cyclesTimedOut = 0;
  hourlyStats.cyclesErrored = 0;
  hourlyStats.newListingsFound = 0;
  hourlyStats.notificationsSent = 0;
  hourlyStats.hourStart = Date.now();

  setTimeout(() => {
    sendHourlyReport().catch(console.error);
    hourlyReportInterval = setInterval(async () => {
      await sendHourlyReport();
    }, intervalMs);
  }, msUntilNext);
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
  if (hourlyReportInterval) {
    clearInterval(hourlyReportInterval);
    hourlyReportInterval = null;
    console.log("[Scheduler] Hourly report stopped");
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
    console.log("[Telegram Webhook] Received update:", JSON.stringify(req.body).slice(0, 500));
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
