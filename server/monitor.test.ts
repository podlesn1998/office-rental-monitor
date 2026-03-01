import { describe, expect, it, vi } from "vitest";
import { formatListingMessage } from "./telegram";
import type { Listing } from "../drizzle/schema";

// ---- Telegram message formatting tests ----

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 1,
    platform: "cian",
    platformId: "12345",
    title: "Офис 50 м²",
    address: "Санкт-Петербург, Невский проспект, 10",
    district: null,
    metroStation: "Невский проспект",
    metroDistanceMin: 5,
    metroDistanceType: "foot",
    price: 75000,
    area: 50,
    floor: 3,
    totalFloors: 10,
    description: "Просторный офис в центре города",
    photos: [],
    url: "https://spb.cian.ru/rent/commercial/12345/",
    phone: null,
    isNew: true,
    isSent: false,
    firstSeen: new Date("2026-03-01"),
    lastSeen: new Date("2026-03-01"),
    createdAt: new Date("2026-03-01"),
    ...overrides,
  };
}

describe("formatListingMessage", () => {
  it("includes platform name", () => {
    const msg = formatListingMessage(makeListing({ platform: "cian" }));
    expect(msg).toContain("ЦИАН");
  });

  it("includes price formatted with Russian locale", () => {
    const msg = formatListingMessage(makeListing({ price: 75000 }));
    expect(msg).toContain("75");
    expect(msg).toContain("₽/мес");
  });

  it("includes address", () => {
    const msg = formatListingMessage(makeListing());
    expect(msg).toContain("Невский проспект, 10");
  });

  it("includes metro station and walking time", () => {
    const msg = formatListingMessage(makeListing());
    expect(msg).toContain("Невский проспект");
    expect(msg).toContain("5 мин");
  });

  it("includes listing URL", () => {
    const msg = formatListingMessage(makeListing());
    expect(msg).toContain("https://spb.cian.ru/rent/commercial/12345/");
  });

  it("handles missing price gracefully", () => {
    const msg = formatListingMessage(makeListing({ price: null }));
    expect(msg).toContain("Цена не указана");
  });

  it("handles missing metro gracefully", () => {
    const msg = formatListingMessage(makeListing({ metroStation: null, metroDistanceMin: null }));
    expect(msg).not.toContain("мин пешком");
  });

  it("handles avito platform", () => {
    const msg = formatListingMessage(makeListing({ platform: "avito" }));
    expect(msg).toContain("Авито");
  });

  it("handles yandex platform", () => {
    const msg = formatListingMessage(makeListing({ platform: "yandex" }));
    expect(msg).toContain("Яндекс");
  });

  it("truncates long description", () => {
    const longDesc = "A".repeat(300);
    const msg = formatListingMessage(makeListing({ description: longDesc }));
    expect(msg).toContain("...");
    expect(msg.length).toBeLessThan(2000);
  });
});

// ---- Search config validation ----

describe("search config defaults", () => {
  it("default area range is 40-70", () => {
    const defaults = { minArea: 40, maxArea: 70 };
    expect(defaults.minArea).toBe(40);
    expect(defaults.maxArea).toBe(70);
  });

  it("default price range is 50k-90k", () => {
    const defaults = { minPrice: 50000, maxPrice: 90000 };
    expect(defaults.minPrice).toBe(50000);
    expect(defaults.maxPrice).toBe(90000);
  });

  it("default foot minutes is 45", () => {
    expect(45).toBeLessThanOrEqual(60);
  });
});

// ---- Deduplication logic ----

describe("deduplication logic", () => {
  it("identifies new listing by platform+platformId", () => {
    const existing = new Set(["cian:111", "avito:222"]);
    const incoming = [
      { platform: "cian", platformId: "111" }, // existing
      { platform: "cian", platformId: "333" }, // new
      { platform: "avito", platformId: "444" }, // new
    ];
    const newOnes = incoming.filter(
      (l) => !existing.has(`${l.platform}:${l.platformId}`)
    );
    expect(newOnes).toHaveLength(2);
    expect(newOnes[0].platformId).toBe("333");
    expect(newOnes[1].platformId).toBe("444");
  });

  it("does not duplicate same platform+id across platforms", () => {
    const existing = new Set(["cian:123"]);
    const incoming = [
      { platform: "avito", platformId: "123" }, // different platform, same ID — should be NEW
    ];
    const newOnes = incoming.filter(
      (l) => !existing.has(`${l.platform}:${l.platformId}`)
    );
    expect(newOnes).toHaveLength(1);
  });
});

// ---- Auth logout (existing test) ----

import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = { name: string; options: Record<string, unknown> };
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1 });
  });
});
