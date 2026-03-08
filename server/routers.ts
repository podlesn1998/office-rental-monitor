import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  getListings,
  getListingStats,
  getScrapeLogs,
  getSearchConfig,
  getTelegramConfig,
  updateSearchConfig,
  updateTelegramConfig,
  addManualListing,
  deleteListing,
  updateListingStatus,
} from "./db";
import { runAllScrapers, runPlatformScrape } from "./scrapers/index";
import { computeScore } from "./utils/scoreListing";
import { scrapeProgress } from "./scrapeProgress";
import { sendPendingListings, sendAllListingsForced, testTelegramConnection } from "./telegram";
import { registerTelegramWebhook } from "./scheduler";

// Backfill state (in-memory, reset on server restart)
let backfillState: {
  running: boolean;
  total: number;
  processed: number;
  updated: number;
  error: string | null;
} = { running: false, total: 0, processed: 0, updated: 0, error: null };

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ---- Listings ----
  listings: router({
    list: publicProcedure
      .input(
        z.object({
          platform: z.enum(["cian", "avito", "yandex"]).optional(),
          isNew: z.boolean().optional(),
          status: z.enum(["new", "not_interesting", "interesting"]).optional(),
          sortBy: z.enum(["score_desc", "score_asc", "date_desc", "price_asc", "price_desc"]).optional(),
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
        })
      )
      .query(async ({ input }) => {
        return getListings(input);
      }),

    stats: publicProcedure.query(async () => {
      return getListingStats();
    }),

    updateStatus: publicProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "not_interesting", "interesting"]),
        })
      )
      .mutation(async ({ input }) => {
        await updateListingStatus(input.id, input.status);
        return { success: true };
      }),
  }),

  // ---- Search Config ----
  searchConfig: router({
    get: publicProcedure.query(async () => {
      return getSearchConfig();
    }),

    update: publicProcedure
      .input(
        z.object({
          minArea: z.number().min(1).max(10000).optional(),
          maxArea: z.number().min(1).max(10000).optional(),
          minPrice: z.number().min(0).optional(),
          maxPrice: z.number().min(0).optional(),
          footMin: z.number().min(1).max(120).optional(),
          metroStations: z.array(z.string()).optional(),
          active: z.boolean().optional(),
          officeType: z.string().optional(),
          transportType: z.enum(["foot", "transport"]).optional(),
          maxPages: z.number().min(1).max(10).optional(),
          enableCian: z.boolean().optional(),
          enableAvito: z.boolean().optional(),
          enableYandex: z.boolean().optional(),
          minFloor: z.number().min(1).nullable().optional(),
          maxFloor: z.number().min(1).nullable().optional(),
          keywords: z.array(z.string()).optional(),
          districts: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ input }) => {
        await updateSearchConfig(input);
        return { success: true };
      }),
  }),

  // ---- Telegram Config ----
  telegram: router({
    get: publicProcedure.query(async () => {
      const config = await getTelegramConfig();
      if (!config) return null;
      // Mask token for security
      return {
        ...config,
        botToken: config.botToken
          ? config.botToken.slice(0, 8) + "..." + config.botToken.slice(-4)
          : null,
        hasToken: !!config.botToken,
      };
    }),

    update: publicProcedure
      .input(
        z.object({
          botToken: z.string().min(10).optional(),
          chatId: z.string().min(1).optional(),
          active: z.boolean().optional(),
          threadNew: z.number().int().nullable().optional(),
          threadInteresting: z.number().int().nullable().optional(),
          threadNotInteresting: z.number().int().nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await updateTelegramConfig(input);
        return { success: true };
      }),

    test: publicProcedure
      .input(
        z.object({
          botToken: z.string().min(10),
          chatId: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        return testTelegramConnection(input.botToken, input.chatId);
      }),

    sendPending: publicProcedure.mutation(async () => {
      // Use forced send — bypasses active flag, sends all unsent listings
      const count = await sendAllListingsForced();
      return { sent: count };
    }),

    registerWebhook: publicProcedure.mutation(async () => {
      const appId = process.env.VITE_APP_ID ?? "";
      if (!appId) return { success: false, message: "APP_ID not configured" };
      const appIdPrefix = appId.slice(0, 8).toLowerCase();
      const webhookUrl = `https://officerent-${appIdPrefix}.manus.space/api/telegram/webhook`;
      const ok = await registerTelegramWebhook(webhookUrl);
      return { success: ok, webhookUrl };
    }),
  }),

  // ---- Manual listings management ----
  listings_manage: router({
    add: publicProcedure
      .input(
        z.object({
          platform: z.enum(["cian", "avito", "yandex"]),
          url: z.string().url(),
          title: z.string().optional(),
          address: z.string().optional(),
          metroStation: z.string().optional(),
          metroDistanceMin: z.number().optional(),
          price: z.number().optional(),
          area: z.number().optional(),
          floor: z.number().optional(),
          totalFloors: z.number().optional(),
          description: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const listing = await addManualListing(input);
        return { success: true, listing };
      }),

    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteListing(input.id);
        return { success: true };
      }),
  }),

  // ---- Rescore ----
  listings_rescore: router({
    all: publicProcedure.mutation(async () => {
      const db = await (await import("./db")).getDb();
      if (!db) return { updated: 0 };
      const { listings: listingsTable } = await import("../drizzle/schema");
      const all = await db.select().from(listingsTable);
      let updated = 0;
      for (const row of all) {
        const score = computeScore({
          floor: row.floor,
          totalFloors: row.totalFloors,
          ceilingHeight: row.ceilingHeight as number | null | undefined,
          title: row.title,
          description: row.description,
        });
        if (score !== row.score) {
          await db.update(listingsTable).set({ score }).where((await import("drizzle-orm")).eq(listingsTable.id, row.id));
          updated++;
        }
      }
      return { updated, total: all.length };
    }),
  }),

  // ---- Scraper ----
  scraper: router({
    progress: publicProcedure.query(() => {
      return scrapeProgress;
    }),

    triggerAll: publicProcedure.mutation(async () => {
      const result = await runAllScrapers();
      // Send new listings via Telegram
      if (result.newCount > 0) {
        await sendPendingListings();
      }
      return {
        found: result.found,
        newCount: result.newCount,
        platforms: ["cian", "avito", "yandex"],
      };
    }),

    triggerPlatform: publicProcedure
      .input(z.object({ platform: z.enum(["cian", "avito", "yandex"]) }))
      .mutation(async ({ input }) => {
        const result = await runPlatformScrape(input.platform);
        if (result.newCount > 0) {
          await sendPendingListings();
        }
        return {
          platform: result.platform,
          found: result.found,
          newCount: result.newCount,
          error: result.error,
        };
      }),

    getLogs: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
      .query(async ({ input }) => {
        return getScrapeLogs(input.limit);
      }),

    backfillProgress: publicProcedure.query(() => {
      return backfillState;
    }),

    backfillCeilingHeight: publicProcedure.mutation(async () => {
      if (backfillState.running) {
        return { started: false, message: "Бэкфилл уже запущен" };
      }

      // Find all Yandex listings with null ceilingHeight
      const db = await (await import("./db")).getDb();
      if (!db) return { started: false, message: "DB недоступна" };
      const { listings: listingsTable } = await import("../drizzle/schema");
      const { and, eq, isNull } = await import("drizzle-orm");

      const targets = await db
        .select({ id: listingsTable.id, url: listingsTable.url, description: listingsTable.description })
        .from(listingsTable)
        .where(and(eq(listingsTable.platform, "yandex"), isNull(listingsTable.ceilingHeight)))
        .limit(50);

      if (targets.length === 0) {
        return { started: false, message: "Все объявления Яндекса уже имеют данные" };
      }

      // Start background job
      backfillState = { running: true, total: targets.length, processed: 0, updated: 0, error: null };
      console.log(`[Backfill] Queuing ${targets.length} Yandex listings for ceiling height backfill`);

      // Helper: fetch Yandex listing page and extract ceiling height via HTTP (no browser needed)
      async function fetchYandexDetail(url: string): Promise<{ ceilingHeight: number | null; entranceSeparate: boolean }> {
        const headers = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        };
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
        const html = await resp.text();

        let ceilingHeight: number | null = null;
        let entranceSeparate = false;

        // Normalize ceiling height: accept 2-6m or 200-600cm, reject outliers
        const normalizeCeiling = (val: number): number | null => {
          if (val >= 200 && val <= 600) return Math.round(val); // already in cm
          if (val >= 2 && val <= 6) return Math.round(val * 100); // in meters
          return null;
        };

        // Try __NEXT_DATA__ JSON first
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

        // Fallback: search directly in raw HTML (works for ROUTER_SNAPSHOT pages)
        if (ceilingHeight === null) {
          const ceilJsonMatch = html.match(/"ceilingHeight"\s*:\s*([\d.]+)/);
          if (ceilJsonMatch) ceilingHeight = normalizeCeiling(parseFloat(ceilJsonMatch[1]));
        }

        // Fallback: human-readable text
        if (ceilingHeight === null) {
          const textMatch = html.match(/Высота потолков[^<]{0,30}([\d,\.]+)\s*[мm]/i);
          if (textMatch) ceilingHeight = normalizeCeiling(parseFloat(textMatch[1].replace(",", ".")));
        }
        if (!entranceSeparate) {
          entranceSeparate = /отдельн[ыйого\s]+вход/i.test(html);
        }

        return { ceilingHeight, entranceSeparate };
      }

      // Run in background (fire-and-forget)
      (async () => {
        try {
          for (const target of targets) {
            if (!target.url) { backfillState = { ...backfillState, processed: backfillState.processed + 1 }; continue; }
            try {
              const result = await fetchYandexDetail(target.url);
              if (result.ceilingHeight !== null || result.entranceSeparate) {
                const updateData: Record<string, unknown> = {};
                if (result.ceilingHeight !== null) updateData.ceilingHeight = result.ceilingHeight;
                if (result.entranceSeparate && !target.description?.includes("отдельный вход")) updateData.description = "отдельный вход";
                await db.update(listingsTable).set(updateData).where(eq(listingsTable.id, target.id));
                backfillState = { ...backfillState, updated: backfillState.updated + 1 };
                console.log(`[Backfill] Updated ${target.id}: ceiling=${result.ceilingHeight}cm entrance=${result.entranceSeparate}`);
              }
            } catch (err) {
              console.warn(`[Backfill] Failed for ${target.id}:`, err instanceof Error ? err.message : err);
            }
            backfillState = { ...backfillState, processed: backfillState.processed + 1 };
            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 1200));
          }
          // Rescore
          const allListings = await db.select().from(listingsTable);
          const { computeScore } = await import("./utils/scoreListing");
          for (const row of allListings) {
            const score = computeScore({ floor: row.floor, totalFloors: row.totalFloors, ceilingHeight: row.ceilingHeight as number | null | undefined, title: row.title, description: row.description });
            if (score !== row.score) await db.update(listingsTable).set({ score }).where(eq(listingsTable.id, row.id));
          }
          backfillState = { ...backfillState, running: false };
          console.log(`[Backfill] Done: updated=${backfillState.updated}/${backfillState.total}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[Backfill] Fatal error:", msg);
          backfillState = { ...backfillState, running: false, error: msg };
        }
      })();

      return { started: true, message: `Запущен бэкфилл для ${targets.length} объявлений` };
    }),
  }),
});

export type AppRouter = typeof appRouter;
