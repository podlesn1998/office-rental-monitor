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
import { sendPendingListings, sendAllListingsForced, testTelegramConnection } from "./telegram";

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
          status: z.enum(["new", "viewed", "interesting"]).optional(),
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
          status: z.enum(["new", "viewed", "interesting"]),
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

  // ---- Scraper ----
  scraper: router({
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
  }),
});

export type AppRouter = typeof appRouter;
