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
- [x] CIAN: Playwright headless browser bypass → 25+ listings found per cycle
- [x] Yandex: Playwright headless browser bypass → 23+ listings found per cycle
- [ ] Avito: datacenter IP blocked — requires residential proxy to scrape

## Bug Fixes
- [x] Scrapers return 0 results — fixed with Playwright headless browser
- [x] CIAN: --user-data-dir Playwright error → removed invalid arg
- [x] CIAN: correct DOM selectors found → a[href*="/rent/commercial/"]
- [x] Yandex: navigation error fixed with try/catch wrapper
- [x] Avito: graceful skip with informative log message when IP blocked

## Feature: Flexible Search Parameters
- [x] Extend searchConfig schema: officeType, transportType, maxPages, enableCian/Avito/Yandex, minFloor, maxFloor, keywords
- [x] Update tRPC searchConfig.update to accept all new fields
- [x] Fix db.ts updateSearchConfig to persist all new fields
- [x] Rewrite Settings page: price/area inputs, metro station multi-select with line colors, walking distance + transport type, office type selector, floor filter, keyword filter, platform toggles, pages count
- [x] Update CIAN scraper to use metroStations, footMin, officeType, maxPages from DB config
- [x] Update Yandex scraper to use area/price/maxPages from DB config
- [x] Update Avito scraper to use area/price from DB config
- [x] Fix Yandex scraper: wait for cards selector before parsing
- [x] Add graceful browser shutdown on SIGTERM/SIGINT

## Feature: SPb District Filter (COMPLETED)
- [x] Add districts JSON column to searchConfig table
- [x] Update tRPC searchConfig.update to accept districts array
- [x] Update db.ts updateSearchConfig to persist districts
- [x] Add district multi-select UI to Settings page (all 18 SPb districts)
- [x] Update CIAN scraper to filter results by selected districts
- [x] Update Yandex scraper to filter results by selected districts
- [ ] Update CIAN scraper to pass district filter in URL
- [ ] Update Yandex scraper to pass district filter in URL
- [ ] Post-filter listings by district if scraper can't filter natively

## Feature: Area & Ceiling Height on Cards
- [x] Add ceilingHeight column to listings table
- [x] Update CIAN scraper to extract ceiling height from card text
- [x] Update Yandex scraper to extract ceiling height from card text
- [x] Update listing cards UI: show area (м²) and ceiling height prominently
- [x] Update Telegram message formatter to include area and ceiling height
