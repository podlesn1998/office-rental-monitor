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

## Bug: Telegram Not Sending (FIXED)
- [x] Diagnose: active=false in DB blocked all sends (sendPendingListings required active=true)
- [x] Add sendAllListingsForced() that bypasses active check — used by manual send button
- [x] Auto-enable active=true and auto-save settings on successful connection test
- [x] Suppress duplicate toast on auto-save after test

## Bug: Incorrect Area Display (FIXED)
- [x] Check what area values are stored in DB — found fake CIAN banners and wrong Yandex area values
- [x] Fix area extraction in CIAN scraper — filter out "Средняя цена" and "Дополнительные предложения" banners
- [x] Fix area extraction in Yandex scraper — extract area from title first (reliable format "XX м² · офис")
- [x] Clean DB: deleted fake CIAN entries, corrected 21 Yandex area values

## Bug: Telegram 429 Rate Limiting (FIXED)
- [x] Add retry-after handling in sendTelegramMessage (reads retry_after from Telegram response)
- [x] Add retry-after handling in sendPhoto path
- [x] Increase default delay between messages from 1000ms to 2000ms

## Feature: District on Listing Cards (COMPLETED)
- [x] Check district column in DB — was null for all listings
- [x] Create guessDistrict() utility with SPb district keyword rules (district.ts)
- [x] Use guessDistrict() in CIAN and Yandex scrapers when building listing objects
- [x] Backfill district for 18/25 existing listings in DB
- [x] Show district badge on listing cards in Home.tsx ("Центральный р-н" etc.)
- [x] Add 13 district detection unit tests (all passing)

## Bug: District Filter Not Working (FIXED)
- [x] Diagnose: applyDistrictFilter was missing from runPlatformScrape pipeline
- [x] Add applyDistrictFilter() and wire it into the filter chain in index.ts
- [x] Delete 12 existing listings from non-selected districts (Выборгский, Кировский, etc.)
- [x] Add 4 unit tests for district filter logic (all 34 tests passing)

## Bug: District Filter Still Not Working (2nd pass — FIXED)
- [x] Diagnose: scraper ran again and re-added wrong-district listings; also Звенигородская was misclassified as Центральный
- [x] Fix district.ts: moved Звенигородская, Серпуховская, Расстанная, Боровая etc. to Адмиралтейский
- [x] Added 9-я Советская and other Центральный streets to correct district
- [x] Add auto-cleanup in saveSearchConfig: when districts change, re-classify all listings and delete non-matching
- [x] Manually re-classified and cleaned DB: deleted 7 wrong-district listings, 1 listing now correctly Адмиралтейский

## Bug: District Filter — Null Districts Pass Through + Wrong Detection (3rd pass — FIXED)
- [x] Audit: 5 listings in DB all had wrong/null district (Заозёрная=Невский, Софийская=Фрунзенский, Пархоменко=Выборгский, CIAN without address)
- [x] Fix applyDistrictFilter: null district now returns false (excluded) when filter is active
- [x] Fix CIAN scraper: use guessDistrict() instead of text search; exclude null-district listings
- [x] Fix Yandex scraper: use guessDistrict() + exclude null-district listings
- [x] Add missing streets: Заозёрная (Невский), Софийская (Фрунзенский), Пархоменко (Выборгский), Артиллерийская (Центральный)
- [x] Fix saveSearchConfig auto-cleanup: also delete null-district listings when filter is active
- [x] Cleaned DB: all 5 wrong-district/null-district listings deleted
- [x] All 34 tests passing

## Bug: Scraper Finds Nothing
- [ ] Check scraper logs to see what's happening
- [ ] Run test scrape and inspect raw HTML/results
- [ ] Fix the root cause

## Bug: Infinite Update Loop in UI (FIXED)
- [x] Diagnose: triggerAll/triggerPlatform/searchConfig.update/telegram.update/test/sendPending were protectedProcedure
- [x] When unauthenticated user clicked "Обновить", server returned UNAUTHORIZED, main.tsx did window.location.href = loginUrl → full page reload
- [x] Fix: changed all app-specific procedures to publicProcedure (personal tool, no auth needed)
- [x] Fix: removed redirect-to-login on UNAUTHORIZED error in main.tsx

## Feature: Telegram Status Buttons + Web Tabs (COMPLETED)
- [x] Add `status` field to listings table (enum: new | viewed | interesting) + telegramMessageId
- [x] Generate and apply DB migration SQL
- [x] Update getListings to filter by status
- [x] Add updateListingStatus helper in db.ts
- [x] Add inline keyboard buttons to Telegram messages (✅ Просмотрено / ⭐ Интересно)
- [x] Handle callback_query in handleTelegramUpdate: update DB status + answer callback + update keyboard
- [x] Add tRPC listings.updateStatus procedure
- [x] Update web UI: status tabs (Все / Новые / Интересные / Просмотренные) + platform chips
- [x] Add status action buttons on listing cards (Отметить / Интересно) with optimistic updates
- [x] All 34 tests passing

## Bug: Telegram Callback Buttons Not Working (FIXED)
- [x] Diagnose: registerTelegramWebhook() existed but was never called — Telegram didn't know our webhook URL
- [x] Fix: call registerTelegramWebhook() on server startup in _core/index.ts
- [x] Fix: add telegram.registerWebhook tRPC procedure + button in TelegramPage for manual re-registration
- [x] Fix: replace dynamic import('./db.js') with static import of updateListingStatus in telegram.ts
- [x] Webhook registered: https://officerent-kommtgdc.manus.space/api/telegram/webhook
- [x] All 34 tests passing

## Feature: Date/Time on Listing Cards + Last Update Time
- [x] Check if createdAt field exists in listings schema
- [x] Add createdAt to listing card UI
- [x] Add last scrape time to page header
- [x] Fix: lastScrapeAt not updating after "Обновить" — invalidate listings.stats cache in triggerMutation.onSuccess

## Feature: Scraping Progress Indicator
- [x] Add per-platform scrape progress state on server (pending/running/done/error) — scrapeProgress.ts
- [x] Expose progress via tRPC polling endpoint (scraper.progress query)
- [x] Show progress UI in header during scraping (ЦИАН ✓ / Янекс ...) with polling every 1.5s

## Feature: Listing Quality Score
- [x] Add `score` integer column to listings table (0-100)
- [x] Create scoreListing.ts utility with scoring algorithm
- [x] Scoring criteria: floor=1 (+35), separateEntrance in title/desc (+35), ceilingHeight>=3.5 (+30)
- [x] Partial scoring: floor=2 (+15), floor=3 (+5), ceilingHeight>=3.0 (+18), ceilingHeight>=2.7 (+8)
- [x] Unknown floor/ceiling: +10 each (might be ideal)
- [x] Compute score when saving new listings in scraper pipeline
- [x] Backfill score for existing 8 listings in DB (all scored 20 — no floor/ceiling data yet)
- [x] Show score badge on listing cards (green ★ 80+, yellow ◐ 50-79, orange 25-49, gray <25)
- [x] Sort listings by score DESC then firstSeen DESC
- [x] Show score in Telegram notification message (⭐/🔶/🔸/⬜ + score/100)
