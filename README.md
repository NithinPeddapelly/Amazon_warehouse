# ScotJob Pulse AI (Amazon Warehouse MVP)

MVP backend service for near real-time Amazon job monitoring, Scotland filtering, deduplication, and Telegram alerts.

## Stack
- Node.js + TypeScript + Express
- Playwright (browser-like) GraphQL network interception (primary)
- Playwright + Cheerio fallback HTML parser (secondary, only when GraphQL capture yields no jobs)
- Prisma ORM
- SQLite for development
- Telegram Bot API notifications
- node-cron scheduler

## Quick Start
1. Install dependencies:
   - `npm install`
2. Copy env file:
   - `cp .env.example .env`
3. Update `.env` values for `BOT_TOKEN` and `CHAT_ID`.
4. Generate Prisma client and create DB schema:
   - `npm run db:generate`
   - `npm run db:push`
5. Run dev server:
   - `npm run dev`

## Routes
- `GET /health`
- `GET /jobs/latest`
- `GET /jobs/logs`

## Processing Pipeline
Playwright page load -> Intercept `/graphql` responses -> Extract cards/detail job JSON -> Scotland Filter -> Preference Filter -> Deduplication -> Database -> Telegram Alert

## Notes
- Poll interval is configured via `SCRAPE_INTERVAL` in seconds.
- GraphQL locale and detail-request volume are configurable with `GRAPHQL_LOCALE` and `GRAPHQL_SEARCH_LIMIT`.
- Request timeout/retry behavior is configurable with `SCRAPE_TIMEOUT_MS` and `SCRAPE_MAX_RETRIES`.
- The scraper uses a browser-like Playwright run to capture GraphQL responses and avoid manual HTTP replay from Axios.
- Playwright page timeout is configurable with `SCRAPE_RENDER_TIMEOUT_MS`.
- `SCRAPE_ACCEPT_LANGUAGE` lets you steer locale-specific HTML responses.
- `SCRAPE_PROXY_URL` is supported by Playwright and is recommended when `jobsatamazon.co.uk` returns CloudFront 403 from your runtime network.
- The Amazon page structure can change often, so selectors in `src/scrapers/amazonScraper.ts` may require updates.
- `JobLog` stores per-job delivery status (`jobId`, `detectedAt`, `sentToTelegram`, `status`) and cycle-level summary counts.
- Development DB is SQLite. Move to PostgreSQL by changing `prisma/schema.prisma` datasource and `DATABASE_URL`.
