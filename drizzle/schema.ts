import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Office rental listings from all platforms
export const listings = mysqlTable("listings", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["cian", "avito", "yandex"]).notNull(),
  platformId: varchar("platformId", { length: 128 }).notNull(),
  title: text("title"),
  address: text("address"),
  district: varchar("district", { length: 256 }),
  metroStation: varchar("metroStation", { length: 256 }),
  metroDistanceMin: int("metroDistanceMin"),
  metroDistanceType: varchar("metroDistanceType", { length: 32 }), // "foot" or "transport"
  price: bigint("price", { mode: "number" }), // monthly rent in RUB
  area: int("area"), // sq meters
  floor: int("floor"),
  totalFloors: int("totalFloors"),
  description: text("description"),
  photos: json("photos").$type<string[]>(),
  url: text("url").notNull(),
  phone: varchar("phone", { length: 64 }),
  isNew: boolean("isNew").default(true).notNull(),
  isSent: boolean("isSent").default(false).notNull(),
  firstSeen: timestamp("firstSeen").defaultNow().notNull(),
  lastSeen: timestamp("lastSeen").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;

// Search configuration
export const searchConfig = mysqlTable("searchConfig", {
  id: int("id").autoincrement().primaryKey(),
  minArea: int("minArea").default(40).notNull(),
  maxArea: int("maxArea").default(70).notNull(),
  minPrice: bigint("minPrice", { mode: "number" }).default(50000).notNull(),
  maxPrice: bigint("maxPrice", { mode: "number" }).default(90000).notNull(),
  footMin: int("footMin").default(45).notNull(), // max walking minutes to metro
  metroStations: json("metroStations").$type<string[]>(),
  city: varchar("city", { length: 64 }).default("Санкт-Петербург").notNull(),
  active: boolean("active").default(true).notNull(),
  // New extended fields
  officeType: varchar("officeType", { length: 64 }).default("office").notNull(), // office, coworking, free_purpose, all
  transportType: varchar("transportType", { length: 32 }).default("foot").notNull(), // foot, transport
  maxPages: int("maxPages").default(2).notNull(), // how many pages to scrape per platform
  enableCian: boolean("enableCian").default(true).notNull(),
  enableAvito: boolean("enableAvito").default(true).notNull(),
  enableYandex: boolean("enableYandex").default(true).notNull(),
  minFloor: int("minFloor"), // optional floor filter
  maxFloor: int("maxFloor"),
  keywords: json("keywords").$type<string[]>(), // optional keywords to filter by in title/description
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SearchConfig = typeof searchConfig.$inferSelect;

// Telegram bot configuration
export const telegramConfig = mysqlTable("telegramConfig", {
  id: int("id").autoincrement().primaryKey(),
  botToken: varchar("botToken", { length: 256 }),
  chatId: varchar("chatId", { length: 64 }),
  active: boolean("active").default(false).notNull(),
  initialBulkSent: boolean("initialBulkSent").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TelegramConfig = typeof telegramConfig.$inferSelect;

// Scrape run logs
export const scrapeLogs = mysqlTable("scrapeLogs", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["cian", "avito", "yandex", "all"]).notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
  found: int("found").default(0),
  newCount: int("newCount").default(0),
  sentCount: int("sentCount").default(0),
  status: mysqlEnum("status", ["running", "success", "error"]).default("running").notNull(),
  errorMessage: text("errorMessage"),
});

export type ScrapeLog = typeof scrapeLogs.$inferSelect;
