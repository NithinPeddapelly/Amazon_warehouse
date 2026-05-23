import dotenv from "dotenv";

dotenv.config();

const requiredAtStartup = ["BOT_TOKEN", "CHAT_ID", "SCRAPE_INTERVAL"] as const;

for (const key of requiredAtStartup) {
  if (!process.env[key] || !process.env[key]?.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  scrapeHeadless:
    process.env.SCRAPE_HEADLESS !== undefined
      ? process.env.SCRAPE_HEADLESS.toLowerCase() !== "false"
      : (process.env.NODE_ENV ?? "development") === "production",
  scrapeIntervalSeconds: Number(process.env.SCRAPE_INTERVAL ?? 10),
  scrapeRequestTimeoutMs: Number(process.env.SCRAPE_TIMEOUT_MS ?? 20000),
  scrapeMaxRetries: Number(process.env.SCRAPE_MAX_RETRIES ?? 2),
  scrapeRenderTimeoutMs: Number(process.env.SCRAPE_RENDER_TIMEOUT_MS ?? 30000),
  scrapeUsePlaywright: (process.env.SCRAPE_USE_PLAYWRIGHT ?? "true").toLowerCase() !== "false",
  graphqlEndpoint: process.env.GRAPHQL_ENDPOINT ?? "https://www.jobsatamazon.co.uk/graphql",
  graphqlLocale: process.env.GRAPHQL_LOCALE ?? "en-GB",
  graphqlSearchLimit: Number(process.env.GRAPHQL_SEARCH_LIMIT ?? 75),
  graphqlAuthHeader: process.env.GRAPHQL_AUTH_HEADER,
  graphqlAuthValue: process.env.GRAPHQL_AUTH_VALUE,
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  botToken: process.env.BOT_TOKEN,
  chatId: process.env.CHAT_ID,
  amazonJobsUrl:
    process.env.AMAZON_JOBS_URL ??
    "https://www.jobsatamazon.co.uk/app#/jobSearch?query=&postal=&locale=en-GB",
  scrapeProxyUrl: process.env.SCRAPE_PROXY_URL,
  scrapeAcceptLanguage: process.env.SCRAPE_ACCEPT_LANGUAGE ?? "en-GB,en;q=0.9",
  keywordFilter: (process.env.KEYWORD_FILTER ?? "warehouse").split(",").map((v) => v.trim()).filter(Boolean),
  locationFilter: (process.env.LOCATION_FILTER ?? "scotland").split(",").map((v) => v.trim()).filter(Boolean),
  minSalaryPerHour: Number(process.env.MIN_SALARY_PER_HOUR ?? 0),
  workTypeFilter: (process.env.WORK_TYPE_FILTER ?? "").split(",").map((v) => v.trim()).filter(Boolean)
};
