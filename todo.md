# Office Rental Monitor — TODO

## Database & Schema
- [x] listings table (id, platform, platformId, title, address, price, area, metroStation, metroDistance, photos, url, description, firstSeen, lastSeen, isNew, isSent)
- [x] searchConfig table (id, minArea, maxArea, minPrice, maxPrice, metroStations, footMin, active)
- [x] telegramConfig table (id, botToken, chatId, active)
- [x] scrapeLog table (id, platform, startedAt, finishedAt, found, newCount, error)

## Backend Scrapers
- [x] CIAN scraper (API-based + HTML fallback, St. Petersburg office rentals)
- [x] Avito scraper (HTTP + cheerio parsing, office rentals SPb)
- [x] Yandex Real Estate scraper (HTTP + embedded JSON parser, office rentals SPb)
- [x] Deduplication logic (by platform + platformId)
- [x] Listing comparison to detect truly new listings

## Telegram Bot
- [x] Telegram bot setup (token + chatId configuration)
- [x] Formatted HTML message card (address, price, area, metro, photos, link)
- [x] Send new listing notifications
- [x] Initial bulk load on first /start command
- [x] /start command handler
- [x] /status command handler (show monitoring status)
- [x] /help command handler

## tRPC API Routes
- [x] listings.list (paginated, filterable)
- [x] listings.stats (counts by platform, new count)
- [x] searchConfig.get / searchConfig.update
- [x] telegramConfig.get / telegramConfig.update / telegramConfig.test
- [x] scraper.triggerNow (manual scrape)
- [x] scraper.getLogs (recent scrape logs)
- [x] listings_manage.add (manual listing addition)
- [x] listings_manage.delete (listing deletion)

## Web Dashboard (Mobile-Optimized)
- [x] Mobile-first layout with bottom navigation (5 tabs)
- [x] Listings feed page (cards with photo, price, area, metro, link)
- [x] Filter controls (by platform, new only)
- [x] Search parameters management page
- [x] Telegram settings page (bot token, chat ID, test button, bulk send)
- [x] Scrape logs / monitoring status page
- [x] Manual "Scrape Now" button
- [x] Dark theme, clean card-based design
- [x] Manual listing addition page

## Monitoring & Scheduling
- [x] 30-minute interval scheduler for automatic scraping
- [x] Initial bulk load feature (send all current listings on first /start)
- [x] Scrape result logging to database
- [x] Error handling and graceful fallbacks

## Tests
- [x] Telegram message formatting tests (10 cases)
- [x] Deduplication logic tests (3 cases)
- [x] Auth logout test
- [x] Search config defaults tests
- [x] All 17 tests passing

## Known Limitations
- [ ] CIAN/Avito/Yandex block direct server-side scraping (anti-bot protection)
  → Workaround: manual listing addition available via web UI
  → Scrapers retry automatically every 30 minutes
