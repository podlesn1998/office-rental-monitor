import { eq, and } from "drizzle-orm";
import { listings, telegramConfig, type Listing } from "../drizzle/schema";
import { getDb } from "./db";

const TELEGRAM_API = "https://api.telegram.org";

// Platform display names and emojis
const PLATFORM_INFO: Record<string, { name: string; emoji: string }> = {
  cian: { name: "ЦИАН", emoji: "🏢" },
  avito: { name: "Авито", emoji: "🟢" },
  yandex: { name: "Яндекс", emoji: "🔴" },
};

/**
 * Format a listing into a Telegram message card (HTML format).
 */
export function formatListingMessage(listing: Listing): string {
  const platform = PLATFORM_INFO[listing.platform] ?? { name: listing.platform, emoji: "📋" };
  const price = listing.price
    ? `${Number(listing.price).toLocaleString("ru-RU")} ₽/мес`
    : "Цена не указана";
  const area = listing.area ? `${listing.area} м²` : "Площадь не указана";
  const ceilingHeight = (listing as any).ceilingHeight
    ? `потолок ${((listing as any).ceilingHeight / 100).toFixed(1)} м`
    : null;
  const floor = listing.floor
    ? `${listing.floor}${listing.totalFloors ? `/${listing.totalFloors}` : ""} эт.`
    : null;

  let metro = "";
  if (listing.metroStation) {
    metro = `🚇 <b>${listing.metroStation}</b>`;
    if (listing.metroDistanceMin) {
      metro += ` — ${listing.metroDistanceMin} мин пешком`;
    }
  }

  const lines: string[] = [
    `${platform.emoji} <b>${platform.name}</b> — Новое объявление!`,
    "",
    `📍 <b>${listing.address || "Адрес не указан"}</b>`,
    metro,
    "",
    `💰 <b>${price}</b>`,
    `📐 <b>${area}</b>${ceilingHeight ? ` · ↕ ${ceilingHeight}` : ""}${floor ? ` · ${floor}` : ""}`,
    "",
  ];

  if (listing.title && listing.title !== "Офис") {
    lines.push(`📝 ${listing.title}`);
    lines.push("");
  }

  if (listing.description) {
    const shortDesc = listing.description.slice(0, 200);
    lines.push(`${shortDesc}${listing.description.length > 200 ? "..." : ""}`);
    lines.push("");
  }

  lines.push(`🔗 <a href="${listing.url}">Открыть объявление</a>`);

  return lines.filter((l) => l !== undefined).join("\n");
}

/**
 * Send a text message via Telegram Bot API.
 */
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  options: Record<string, unknown> = {}
): Promise<boolean> {
  try {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
        ...options,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Telegram] sendMessage failed: ${response.status} ${err}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Telegram] sendMessage error:", err);
    return false;
  }
}

/**
 * Send a listing with photo(s) via Telegram.
 * Uses sendPhoto if photos are available, otherwise sendMessage.
 */
async function sendListingNotification(
  botToken: string,
  chatId: string,
  listing: Listing
): Promise<boolean> {
  const text = formatListingMessage(listing);
  const photos = (listing.photos as string[]) ?? [];

  if (photos.length > 0) {
    try {
      // Send photo with caption
      const url = `${TELEGRAM_API}/bot${botToken}/sendPhoto`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photos[0],
          caption: text.slice(0, 1024), // Telegram caption limit
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) return true;
      // Fall through to text message if photo fails
    } catch {
      // Fall through
    }
  }

  return sendTelegramMessage(botToken, chatId, text);
}

/**
 * Send multiple listing notifications, respecting Telegram rate limits.
 */
export async function sendListingsBatch(
  botToken: string,
  chatId: string,
  listingsList: Listing[],
  delayMs = 1000
): Promise<number> {
  let sentCount = 0;

  for (const listing of listingsList) {
    const success = await sendListingNotification(botToken, chatId, listing);
    if (success) {
      sentCount++;
      // Mark as sent in DB
      const db = await getDb();
      if (db) {
        await db
          .update(listings)
          .set({ isSent: true, isNew: false })
          .where(eq(listings.id, listing.id));
      }
    }
    // Rate limit: Telegram allows ~30 messages/sec, we use 1s delay to be safe
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return sentCount;
}

/**
 * Send new listings that haven't been sent yet.
 */
export async function sendPendingListings(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get Telegram config
  const configs = await db
    .select()
    .from(telegramConfig)
    .where(eq(telegramConfig.active, true))
    .limit(1);

  const config = configs[0];
  if (!config?.botToken || !config?.chatId) {
    console.log("[Telegram] No active config, skipping notifications");
    return 0;
  }

  // Get unsent listings
  const unsentListings = await db
    .select()
    .from(listings)
    .where(and(eq(listings.isSent, false), eq(listings.isNew, true)))
    .orderBy(listings.firstSeen)
    .limit(20); // Send max 20 at a time

  if (unsentListings.length === 0) return 0;

  console.log(`[Telegram] Sending ${unsentListings.length} pending listings...`);
  return sendListingsBatch(config.botToken, config.chatId, unsentListings);
}

/**
 * Send a status/info message to the configured chat.
 */
export async function sendStatusMessage(message: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const configs = await db
    .select()
    .from(telegramConfig)
    .where(eq(telegramConfig.active, true))
    .limit(1);

  const config = configs[0];
  if (!config?.botToken || !config?.chatId) return false;

  return sendTelegramMessage(config.botToken, config.chatId, message);
}

/**
 * Test Telegram connection with a given token and chatId.
 */
export async function testTelegramConnection(
  botToken: string,
  chatId: string
): Promise<{ success: boolean; botName?: string; error?: string }> {
  try {
    // First verify the bot token
    const meUrl = `${TELEGRAM_API}/bot${botToken}/getMe`;
    const meResponse = await fetch(meUrl, { signal: AbortSignal.timeout(8000) });
    if (!meResponse.ok) {
      return { success: false, error: "Неверный токен бота" };
    }
    const meData = (await meResponse.json()) as { ok: boolean; result: { first_name: string; username: string } };
    const botName = meData.result?.first_name ?? meData.result?.username ?? "Bot";

    // Send test message
    const sent = await sendTelegramMessage(
      botToken,
      chatId,
      `✅ <b>Office Rental Monitor</b>\n\nПодключение успешно! Бот будет присылать уведомления об аренде офисов в Санкт-Петербурге.\n\n🏢 Параметры поиска:\n• Площадь: 40–70 м²\n• Цена: 50 000–90 000 ₽/мес\n• Пешком до метро: до 45 мин\n\nИспользуйте /start для получения текущих объявлений.`
    );

    if (!sent) {
      return { success: false, error: "Не удалось отправить сообщение. Проверьте Chat ID." };
    }

    return { success: true, botName };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Ошибка подключения" };
  }
}

/**
 * Handle Telegram webhook updates (for /start, /status, /list commands).
 */
export async function handleTelegramUpdate(update: Record<string, unknown>): Promise<void> {
  const message = update.message as Record<string, unknown> | undefined;
  if (!message) return;

  const chatId = String((message.chat as Record<string, unknown>)?.id ?? "");
  const text = String(message.text ?? "");
  const db = await getDb();

  if (!db) return;

  const configs = await db.select().from(telegramConfig).limit(1);
  const config = configs[0];
  if (!config?.botToken) return;

  const botToken = config.botToken;

  if (text.startsWith("/start")) {
    await sendTelegramMessage(
      botToken,
      chatId,
      `🏢 <b>Office Rental Monitor</b>\n\nДобро пожаловать! Я слежу за объявлениями об аренде офисов в Санкт-Петербурге.\n\n📋 Команды:\n/start — Получить все актуальные объявления\n/status — Статус мониторинга\n/list — Последние 10 объявлений\n\nВаш Chat ID: <code>${chatId}</code>\n\nЗагружаю актуальные объявления...`
    );

    // Send all current listings
    const allListings = await db
      .select()
      .from(listings)
      .orderBy(listings.firstSeen)
      .limit(30);

    if (allListings.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "📭 Объявлений пока нет. Мониторинг запущен — как только появятся новые объявления, я пришлю их сюда."
      );
    } else {
      await sendTelegramMessage(
        botToken,
        chatId,
        `📦 Найдено <b>${allListings.length}</b> актуальных объявлений. Отправляю...`
      );
      await sendListingsBatch(botToken, chatId, allListings, 800);
    }
  } else if (text.startsWith("/status")) {
    const totalCount = await db.select().from(listings);
    const newCount = totalCount.filter((l) => l.isNew).length;
    await sendTelegramMessage(
      botToken,
      chatId,
      `📊 <b>Статус мониторинга</b>\n\nВсего объявлений: <b>${totalCount.length}</b>\nНовых (несмотренных): <b>${newCount}</b>\n\n🔄 Мониторинг работает каждые 30 минут`
    );
  } else if (text.startsWith("/list")) {
    const recent = await db
      .select()
      .from(listings)
      .orderBy(listings.firstSeen)
      .limit(10);

    if (recent.length === 0) {
      await sendTelegramMessage(botToken, chatId, "📭 Объявлений пока нет.");
    } else {
      await sendTelegramMessage(botToken, chatId, `📋 Последние ${recent.length} объявлений:`);
      await sendListingsBatch(botToken, chatId, recent, 800);
    }
  }
}
