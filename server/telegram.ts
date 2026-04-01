import { eq, and } from "drizzle-orm";
import { listings, telegramConfig, type Listing } from "../drizzle/schema";
import { getDb, updateListingStatus, updateListingComment } from "./db";

const TELEGRAM_API = "https://api.telegram.org";

// Platform display names and emojis
const PLATFORM_INFO: Record<string, { name: string; emoji: string }> = {
  cian: { name: "ЦИАН", emoji: "🏢" },
  avito: { name: "Авито", emoji: "🟢" },
  yandex: { name: "Яндекс", emoji: "🔴" },
};

/**
 * In-memory map of chats waiting for a comment.
 * Key: chatId (string), Value: { listingId, status, promptMessageId, listingMessageId }
 */
interface PendingComment {
  listingId: number;
  status: "interesting" | "not_interesting";
  /** The message_id of the "Напишите комментарий..." prompt, so we can delete it after */
  promptMessageId: number | null;
  /** The message_id of the original listing card, to edit it with the comment */
  listingMessageId: number | null;
  /** Whether the listing card was sent as a photo (caption) or text */
  hasPhoto: boolean;
}
const pendingComments = new Map<string, PendingComment>();

/**
 * Edit a listing card message in Telegram to append a comment.
 * Tries editMessageCaption (for photos) first, then editMessageText.
 */
async function editListingCardWithComment(
  botToken: string,
  chatId: string,
  messageId: number,
  listing: Listing,
  comment: string,
  hasPhoto: boolean,
): Promise<void> {
  const updatedListing = { ...listing, comment } as Listing;
  const newText = formatListingMessage(updatedListing, true);

  // Build the inline keyboard for the listing (preserve status buttons)
  const currentStatus = listing.status as string;
  const listingId = listing.id;
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: currentStatus === "not_interesting" ? "👎 Неинтересно (сбросить)" : "👎 Неинтересно",
          callback_data: currentStatus === "not_interesting" ? `status:new:${listingId}` : `status:not_interesting:${listingId}`,
        },
        {
          text: currentStatus === "interesting" ? "⭐ Интересно (сбросить)" : "⭐ Интересно",
          callback_data: currentStatus === "interesting" ? `status:new:${listingId}` : `status:interesting:${listingId}`,
        },
      ],
    ],
  };

  // Try photo caption edit first, then text edit
  const attempts: Array<{ endpoint: string; bodyField: string; content: string }> = hasPhoto
    ? [{ endpoint: "editMessageCaption", bodyField: "caption", content: newText.slice(0, 1024) }]
    : [{ endpoint: "editMessageText", bodyField: "text", content: newText }];

  for (const { endpoint, bodyField, content } of attempts) {
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          [bodyField]: content,
          parse_mode: "HTML",
          reply_markup: replyMarkup,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const resBody = await res.text();
      if (res.ok) {
        console.log(`[Telegram] Edited listing card ${messageId} with comment (${endpoint})`);
        return;
      }
      console.warn(`[Telegram] ${endpoint} failed (${res.status}): ${resBody}`);
      // If photo caption failed, try text edit as fallback
      if (hasPhoto && res.status !== 200) {
        const textRes = await fetch(`${TELEGRAM_API}/bot${botToken}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: newText,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          }),
          signal: AbortSignal.timeout(8000),
        });
        const textBody = await textRes.text();
        if (textRes.ok) {
          console.log(`[Telegram] Edited listing card ${messageId} with comment (editMessageText fallback)`);
          return;
        }
        console.warn(`[Telegram] editMessageText fallback failed (${textRes.status}): ${textBody}`);
      }
    } catch (err) {
      console.warn(`[Telegram] editListingCardWithComment exception:`, err);
    }
  }
}

/**
 * Format a listing into a Telegram message card (HTML format).
 */
export function formatListingMessage(listing: Listing, includeComment = true): string {
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

  const score = (listing as any).score as number | undefined;
  const scoreEmoji = score == null ? "" : score >= 80 ? "⭐" : score >= 50 ? "🔶" : score >= 25 ? "🔸" : "⬜";
  const scoreLine = score != null ? `${scoreEmoji} Оценка: <b>${score}/100</b>` : null;

  const lines: string[] = [
    `${platform.emoji} <b>${platform.name}</b> — Новое объявление!`,
    "",
    `📍 <b>${listing.address || "Адрес не указан"}</b>`,
    metro,
    "",
    `💰 <b>${price}</b>`,
    `📐 <b>${area}</b>${ceilingHeight ? ` · ↕ ${ceilingHeight}` : ""}${floor ? ` · ${floor}` : ""}`,
    scoreLine ?? "",
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

  // Append comment if present
  if (includeComment && listing.comment) {
    lines.push("");
    lines.push(`💬 <i>${listing.comment}</i>`);
  }

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

    if (response.status === 429) {
      // Rate limited — read retry_after and wait
      try {
        const body = await response.json() as { parameters?: { retry_after?: number } };
        const retryAfter = (body.parameters?.retry_after ?? 30) + 2;
        console.warn(`[Telegram] Rate limited, waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        // Retry once after waiting
        const retry = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false, ...options }),
          signal: AbortSignal.timeout(10000),
        });
        return retry.ok;
      } catch {
        return false;
      }
    }
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
 * Send a text message and return the message_id (or null on failure).
 */
async function sendTelegramMessageWithId(
  botToken: string,
  chatId: string,
  text: string,
  options: Record<string, unknown> = {}
): Promise<number | null> {
  try {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...options,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { result?: { message_id?: number } };
    return data.result?.message_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Build inline keyboard for a listing (status buttons).
 */
function buildListingKeyboard(listingId: number) {
  return {
    inline_keyboard: [
      [
        { text: "👎 Неинтересно", callback_data: `status:not_interesting:${listingId}` },
        { text: "⭐ Интересно", callback_data: `status:interesting:${listingId}` },
      ],
    ],
  };
}

/**
 * Send a listing with photo(s) via Telegram.
 * Uses sendPhoto if photos are available, otherwise sendMessage.
 * Returns the Telegram message_id if successful, or null.
 */
async function sendListingNotification(
  botToken: string,
  chatId: string,
  listing: Listing,
  threadId?: number | null
): Promise<number | null> {
  const text = formatListingMessage(listing);
  const photos = (listing.photos as string[]) ?? [];
  const replyMarkup = buildListingKeyboard(listing.id);
  const threadExtra = threadId ? { message_thread_id: threadId } : {};

  // Helper: check if error is "thread not found" and retry without threadId
  const isThreadNotFound = (status: number, body: string) =>
    status === 400 && body.includes("message thread not found");

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
          reply_markup: replyMarkup,
          ...threadExtra,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = await response.json() as { result?: { message_id?: number } };
        return data.result?.message_id ?? null;
      }
      if (response.status === 429) {
        try {
          const body = await response.json() as { parameters?: { retry_after?: number } };
          const retryAfter = (body.parameters?.retry_after ?? 30) + 2;
          console.warn(`[Telegram] Photo rate limited, waiting ${retryAfter}s...`);
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          const retry = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, photo: photos[0], caption: text.slice(0, 1024), parse_mode: "HTML", reply_markup: replyMarkup, ...threadExtra }),
            signal: AbortSignal.timeout(10000),
          });
          if (retry.ok) {
            const data = await retry.json() as { result?: { message_id?: number } };
            return data.result?.message_id ?? null;
          }
        } catch {
          // Fall through
        }
      }
      // Log photo failure and fall through to text message
      const errBody = await response.text().catch(() => "(unreadable)");
      console.warn(`[Telegram] sendPhoto failed (${response.status}): ${errBody} — falling back to text`);
    } catch (photoErr) {
      console.warn(`[Telegram] sendPhoto exception: ${photoErr} — falling back to text`);
    }
  }

  // Text message (with optional thread)
  const sendText = async (extra: Record<string, unknown> = {}): Promise<number | null> => {
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
          reply_markup: replyMarkup,
          ...extra,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 429) {
        const body = await response.json() as { parameters?: { retry_after?: number } };
        const retryAfter = (body.parameters?.retry_after ?? 30) + 2;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        const retry = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false, reply_markup: replyMarkup, ...extra }),
          signal: AbortSignal.timeout(10000),
        });
        if (retry.ok) {
          const data = await retry.json() as { result?: { message_id?: number } };
          return data.result?.message_id ?? null;
        }
        return null;
      }
      if (!response.ok) {
        const errBody = await response.text().catch(() => "(unreadable)");
        if (isThreadNotFound(response.status, errBody)) {
          console.warn(`[Telegram] Thread not found (id=${threadId}), retrying without thread...`);
          return null; // signal caller to retry without thread
        }
        console.error(`[Telegram] sendMessage failed (${response.status}): ${errBody}`);
        return null;
      }
      const data = await response.json() as { result?: { message_id?: number } };
      return data.result?.message_id ?? null;
    } catch (err) {
      console.error(`[Telegram] sendMessage exception:`, err);
      return null;
    }
  };

  // Try with thread first, fall back to no thread on 400
  if (threadId) {
    const result = await sendText(threadExtra);
    if (result !== null) return result;
    // If thread failed, retry without thread
    return sendText();
  }
  return sendText();
}

/**
 * Send multiple listing notifications, respecting Telegram rate limits.
 */
export async function sendListingsBatch(
  botToken: string,
  chatId: string,
  listingsList: Listing[],
  delayMs = 2000,
  threadId?: number | null
): Promise<number> {
  let sentCount = 0;
  for (const listing of listingsList) {
    const messageId = await sendListingNotification(botToken, chatId, listing, threadId);;
    if (messageId !== null) {
      sentCount++;
      // Mark as sent in DB and save telegram message_id
      const db = await getDb();
      if (db) {
        await db
          .update(listings)
          .set({ isSent: true, telegramMessageId: messageId })
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
 * Only runs when active = true (used by scheduler).
 */
export async function sendPendingListings(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get Telegram config — must be active
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
  return sendListingsBatch(config.botToken, config.chatId, unsentListings, 2000, config.threadNew);
}

/**
 * Force-send all unsent listings regardless of active flag.
 * Used for manual "Send all" button — bypasses active check.
 */
export async function sendAllListingsForced(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get any config (active or not) as long as token and chatId are set
  const configs = await db
    .select()
    .from(telegramConfig)
    .limit(1);

  const config = configs[0];
  if (!config?.botToken || !config?.chatId) {
    console.log("[Telegram] No config found, cannot send");
    return 0;
  }

  // Get ALL unsent listings (not just isNew=true, to catch everything)
  const unsentListings = await db
    .select()
    .from(listings)
    .where(eq(listings.isSent, false))
    .orderBy(listings.firstSeen)
    .limit(50); // Allow up to 50 for manual send

  if (unsentListings.length === 0) {
    console.log("[Telegram] No unsent listings to send");
    return 0;
  }

  console.log(`[Telegram] Force-sending ${unsentListings.length} listings...`);
  return sendListingsBatch(config.botToken, config.chatId, unsentListings, 1200, config.threadNew);
}

/**
 * Re-send ALL listings regardless of isSent flag.
 * Used by the "Переотправить всё" manual button.
 * Resets isSent=false for all listings first, then sends them all.
 */
export async function resendAllListings(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const configs = await db.select().from(telegramConfig).limit(1);
  const config = configs[0];
  if (!config?.botToken || !config?.chatId) {
    console.log("[Telegram] No config found, cannot resend");
    return 0;
  }
  // Fetch ALL listings ordered by firstSeen
  const allListings = await db
    .select()
    .from(listings)
    .orderBy(listings.firstSeen)
    .limit(100); // safety cap — 100 messages at 1.5s = ~2.5 min
  if (allListings.length === 0) {
    console.log("[Telegram] No listings to resend");
    return 0;
  }
  // Reset isSent so sendListingsBatch can re-mark them after sending
  await db.update(listings).set({ isSent: false });
  console.log(`[Telegram] Resending all ${allListings.length} listings (isSent reset)...`);
  return sendListingsBatch(config.botToken, config.chatId, allListings, 1500, config.threadNew);
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
 * Delete a Telegram message.
 */
async function deleteMessage(botToken: string, chatId: string, messageId: number): Promise<boolean> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

/**
 * Answer a Telegram callback query (removes loading spinner on button).
 */
async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

/**
 * Edit the inline keyboard of a sent message to reflect new status.
 */
async function updateMessageKeyboard(
  botToken: string,
  chatId: string,
  messageId: number,
  status: "not_interesting" | "interesting",
  listingId: number,
): Promise<void> {
  const newKeyboard = {
    inline_keyboard: [
      [
        {
          text: status === "not_interesting" ? "👎 Неинтересно (сбросить)" : "👎 Неинтересно",
          callback_data: status === "not_interesting" ? `status:new:${listingId}` : `status:not_interesting:${listingId}`,
        },
        {
          text: status === "interesting" ? "⭐ Интересно (сбросить)" : "⭐ Интересно",
          callback_data: status === "interesting" ? `status:new:${listingId}` : `status:interesting:${listingId}`,
        },
      ],
    ],
  };
  await fetch(`${TELEGRAM_API}/bot${botToken}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: newKeyboard }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

/**
 * Handle Telegram webhook updates (for /start, /status, /list commands and button callbacks).
 */
export async function handleTelegramUpdate(update: Record<string, unknown>): Promise<void> {
  // Handle inline button callback queries
  const callbackQuery = update.callback_query as Record<string, unknown> | undefined;
  if (callbackQuery) {
    const callbackId = String(callbackQuery.id ?? "");
    const data = String(callbackQuery.data ?? "");
    const callbackChatId = String((callbackQuery.message as Record<string, unknown>)?.chat ? ((callbackQuery.message as Record<string, unknown>).chat as Record<string, unknown>).id : "");
    const callbackMessageId = Number((callbackQuery.message as Record<string, unknown>)?.message_id ?? 0);

    const db = await getDb();
    if (!db) return;
    const configs = await db.select().from(telegramConfig).limit(1);
    const config = configs[0];
    if (!config?.botToken) return;

    // Parse: status:viewed:123 or status:interesting:123 or status:new:123
    const match = data.match(/^status:(new|not_interesting|interesting):(\d+)$/);
    if (match) {
      const newStatus = match[1] as "new" | "not_interesting" | "interesting";
      const listingId = parseInt(match[2], 10);

      await updateListingStatus(listingId, newStatus);
      const statusText = newStatus === "not_interesting" ? "Отмечено как неинтересное" : newStatus === "interesting" ? "Добавлено в Интересные" : "Статус сброшен";
      await answerCallbackQuery(config.botToken, callbackId, `✅ ${statusText}`);

      // Move message to target topic thread if configured
      const targetThread = newStatus === "interesting" ? config.threadInteresting : newStatus === "not_interesting" ? config.threadNotInteresting : null;
      // Only update keyboard if NOT moving to another topic (message will be deleted)
      if (callbackMessageId && newStatus !== "new" && !targetThread) {
        await updateMessageKeyboard(config.botToken, callbackChatId, callbackMessageId, newStatus, listingId);
      }
      if (targetThread && config.chatId) {
        const db2 = await getDb();
        const found = db2 ? await db2.select().from(listings).where(eq(listings.id, listingId)).limit(1) : [];
        if (found[0]) {
          // Delete original message from current topic (move semantics)
          if (callbackMessageId) {
            await deleteMessage(config.botToken, callbackChatId, callbackMessageId);
          }
          // Re-send to target topic and save new message_id
          let newMsgId: number | null = null;
          if (newStatus === "interesting") {
            newMsgId = await sendListingNotification(config.botToken, config.chatId, found[0] as Listing, targetThread);
          } else if (newStatus === "not_interesting") {
            const notInterestingMsg = `👎 <b>Неинтересно</b>\n\n${formatListingMessage(found[0] as Listing)}`;
            newMsgId = await sendTelegramMessageWithId(config.botToken, config.chatId, notInterestingMsg, { message_thread_id: targetThread });
          }
          // Update telegramMessageId in DB to the new message in the target topic
          if (newMsgId && db2) {
            await db2.update(listings).set({ telegramMessageId: newMsgId }).where(eq(listings.id, listingId));
          }
        }
      }

      // Ask for a comment (only when setting a real status, not resetting to "new")
      if (newStatus !== "new" && config.chatId) {
        // Fetch listing to check if it has photos (determines edit endpoint)
        const db3 = await getDb();
        const listingRow = db3 ? await db3.select().from(listings).where(eq(listings.id, listingId)).limit(1) : [];
        const hasPhoto = Array.isArray((listingRow[0] as any)?.photos) && (listingRow[0] as any).photos.length > 0;
        // The listing's stored telegramMessageId is the card we want to edit.
        // Fall back to callbackMessageId (the message the button was pressed on) if not in DB.
        const listingMsgId = (listingRow[0] as any)?.telegramMessageId ?? (callbackMessageId || null);

        const statusLabel = newStatus === "interesting" ? "⭐ Интересно" : "👎 Неинтересно";
        const promptText = `${statusLabel}\n\nДобавьте комментарий к объявлению (или отправьте /skip чтобы пропустить):`;
        const promptMsgId = await sendTelegramMessageWithId(config.botToken, callbackChatId, promptText, {
          reply_markup: {
            inline_keyboard: [[{ text: "⏭ Пропустить", callback_data: `skip_comment:${listingId}` }]],
          },
        });
        pendingComments.set(callbackChatId, {
          listingId,
          status: newStatus as "interesting" | "not_interesting",
          promptMessageId: promptMsgId,
          listingMessageId: listingMsgId,
          hasPhoto,
        });
      }
    } else {
      // Handle skip_comment inline button
      const skipMatch = data.match(/^skip_comment:(\d+)$/);
      if (skipMatch) {
        const listingId = parseInt(skipMatch[1], 10);
        const db2 = await getDb();
        const configs2 = db2 ? await db2.select().from(telegramConfig).limit(1) : [];
        const config2 = configs2[0];
        if (!config2?.botToken) return;

        // Remove pending state
        pendingComments.delete(callbackChatId);

        // Delete the prompt message
        if (callbackMessageId) {
          await deleteMessage(config2.botToken, callbackChatId, callbackMessageId);
        }

        await answerCallbackQuery(config2.botToken, callbackId, "Комментарий пропущен");
      } else {
        await answerCallbackQuery(config.botToken, callbackId);
      }
    }
    return;
  }

  const message = update.message as Record<string, unknown> | undefined;
  if (!message) return;

  const chatId = String((message.chat as Record<string, unknown>)?.id ?? "");
  const text = String(message.text ?? "");
  const userMessageId = Number(message.message_id ?? 0) || null;
  const db = await getDb();

  if (!db) return;

  const configs = await db.select().from(telegramConfig).limit(1);
  const config = configs[0];
  if (!config?.botToken) return;

  const botToken = config.botToken;

  // Check if this chat is waiting for a comment
  const pending = pendingComments.get(chatId);
  if (pending) {
    // /skip command or "пропустить"
    if (text.startsWith("/skip") || text.toLowerCase() === "пропустить") {
      pendingComments.delete(chatId);
      // Delete prompt message if we have its ID
      if (pending.promptMessageId) {
        await deleteMessage(botToken, chatId, pending.promptMessageId);
      }
      const skipMsgId = await sendTelegramMessageWithId(botToken, chatId, "⏭ Комментарий пропущен.");
      if (skipMsgId) {
        setTimeout(() => deleteMessage(botToken, chatId, skipMsgId), 3000);
      }
      return;
    }

    // Save the comment
    const comment = text.trim().slice(0, 500); // max 500 chars
    await updateListingComment(pending.listingId, comment);
    pendingComments.delete(chatId);

    // Delete the prompt message and the user's own comment message
    if (pending.promptMessageId) {
      await deleteMessage(botToken, chatId, pending.promptMessageId);
    }
    if (userMessageId) {
      await deleteMessage(botToken, chatId, userMessageId);
    }

    // Edit the original listing card to append the comment
    if (pending.listingMessageId && config.chatId) {
      const db2 = await getDb();
      const listingRows = db2 ? await db2.select().from(listings).where(eq(listings.id, pending.listingId)).limit(1) : [];
      if (listingRows[0]) {
        const updatedListing = { ...listingRows[0], comment } as Listing;
        await editListingCardWithComment(
          botToken,
          config.chatId,
          pending.listingMessageId,
          updatedListing,
          comment,
          pending.hasPhoto,
        );
      }
    }

    // Send confirmation then delete it after a short delay
    const confirmMsgId = await sendTelegramMessageWithId(botToken, chatId, `✅ Комментарий сохранён:\n<i>${comment}</i>`);
    if (confirmMsgId) {
      setTimeout(() => deleteMessage(botToken, chatId, confirmMsgId), 3000);
    }
    return;
  }

  if (text.startsWith("/getids")) {
    const threadId = (message.message_thread_id as number | undefined) ?? null;
    const replyLines = [
      `🔍 <b>ID для настройки топиков</b>`,
      ``,
      `<b>Chat ID:</b> <code>${chatId}</code>`,
      threadId
        ? `<b>Thread ID этого топика:</b> <code>${threadId}</code>`
        : `<b>Thread ID:</b> не определён — напишите /getids <b>внутри нужного топика</b>`,
      ``,
      `ℹ️ Запишите Thread ID каждого топика в настройках приложения (вкладка Telegram).`,
    ];
    await sendTelegramMessage(botToken, chatId, replyLines.join("\n"),
      threadId ? { message_thread_id: threadId } : {}
    );
    return;
  }
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
