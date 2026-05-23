import { chromium, type BrowserContextOptions, type Page, type Response } from "playwright";
import { env } from "../config/env.js";
import type { JobListing, WorkType } from "../types/job.js";
import { logger } from "../utils/logger.js";

type JsonRecord = Record<string, unknown>;

export interface CaptureMetrics {
  extractionAttempts: number;
  successfulExtractions: number;
  failedExtractions: number;
}

interface NetworkCaptureResult {
  jobs: JobListing[];
  operationsSeen: string[];
  extractionFailures: number;
  extractionAttempts: number;
  successfulExtractions: number;
}

interface GraphQLPayload {
  operationName?: string;
}

let lastCaptureMetrics: CaptureMetrics = {
  extractionAttempts: 0,
  successfulExtractions: 0,
  failedExtractions: 0
};

export function getLastCaptureMetrics(): CaptureMetrics {
  return { ...lastCaptureMetrics };
}

function inferWorkType(value: string): WorkType {
  const text = value.toLowerCase();
  if (text.includes("full")) return "full-time";
  if (text.includes("part")) return "part-time";
  if (text.includes("intern")) return "internship";
  if (text.includes("season")) return "seasonal";
  if (text.includes("contract")) return "contract";
  return "unknown";
}

function parseNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseWorkHours(input: unknown): number | null {
  const direct = parseNumber(input);
  if (direct !== null) return direct;

  if (typeof input !== "string") return null;
  const match = input.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*\/?\s*week/);
  return match ? Number(match[1]) : null;
}

function readString(node: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(node: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = parseNumber(node[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function buildLocation(node: JsonRecord): string {
  const city = readString(node, ["city", "locationName", "location"]);
  const state = readString(node, ["state", "country", "geoClusterRegion"]);
  const desc = readString(node, ["locationDescription", "tagLine"]);

  if (city && state) return `${city}, ${state}`;
  return city ?? desc ?? "Unknown location";
}

function mapNodeToJob(node: JsonRecord): JobListing | null {
  const jobId = readString(node, ["jobId"]);
  if (!jobId) return null;

  const title = readString(node, ["externalJobTitle", "jobTitle", "title"]) ?? "Unknown title";
  const location = buildLocation(node);
  const pay = readNumber(node, ["totalPayRate", "basePay", "totalPayRateMax", "totalPayRateMin"]);
  const currency = readString(node, ["currencyCode"]) ?? "GBP";
  const salary = pay !== null ? `${currency} ${pay}/hr` : null;
  const hoursPerWeek = readNumber(node, ["hoursPerWeek", "weeklyHours"]) ?? parseWorkHours(node.scheduleText);
  const schedule = readString(node, ["scheduleText", "scheduleType", "scheduleTypeL10N", "tagLine"]);
  const employmentType = readString(node, ["employmentType", "employmentTypeL10N", "jobType"]);
  const startDate = readString(node, ["firstDayOnSite", "firstDayOnSiteL10N", "hireStartDate", "mostRecentPostedDate"]);
  const workType = inferWorkType(`${employmentType ?? ""} ${readString(node, ["jobType"]) ?? ""}`);

  return {
    sourceJobId: jobId,
    title,
    location,
    salary,
    salaryPerHour: pay,
    hoursPerWeek,
    schedule,
    employmentType,
    startDate,
    workType,
    source: "amazon",
    link: `https://www.jobsatamazon.co.uk/app#/jobDetail?jobId=${encodeURIComponent(jobId)}`
  };
}

function parseOperation(response: Response): GraphQLPayload {
  const raw = response.request().postData();
  if (!raw) return {};

  try {
    return (JSON.parse(raw) as GraphQLPayload) ?? {};
  } catch {
    return {};
  }
}

function collectNodes(value: unknown, out: JsonRecord[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return;
  }

  if (!value || typeof value !== "object") return;

  const node = value as JsonRecord;
  if (typeof node.jobId === "string") out.push(node);

  for (const child of Object.values(node)) {
    collectNodes(child, out);
  }
}

function collectPayloadPaths(value: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(value)) return;
  if (!value || typeof value !== "object") return;

  const node = value as JsonRecord;
  for (const [key, child] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    collectPayloadPaths(child, path, out);
  }
}

function discoverCardArrays(data: unknown): Array<{ path: string; items: JsonRecord[] }> {
  const out: Array<{ path: string; items: JsonRecord[] }> = [];

  function walk(value: unknown, prefix: string): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (/jobCards|scheduleCards/i.test(prefix)) {
        const items = value.filter((x): x is JsonRecord => Boolean(x) && typeof x === "object");
        out.push({ path: prefix, items });
      }
      return;
    }

    const node = value as JsonRecord;
    for (const [key, child] of Object.entries(node)) {
      walk(child, prefix ? `${prefix}.${key}` : key);
    }
  }

  walk(data, "data");
  return out;
}

function parseProxyForPlaywright(): BrowserContextOptions["proxy"] {
  if (!env.scrapeProxyUrl) return undefined;

  try {
    const proxy = new URL(env.scrapeProxyUrl);
    return {
      server: `${proxy.protocol}//${proxy.hostname}${proxy.port ? `:${proxy.port}` : ""}`,
      username: proxy.username ? decodeURIComponent(proxy.username) : undefined,
      password: proxy.password ? decodeURIComponent(proxy.password) : undefined
    };
  } catch {
    logger.warn("SCRAPE_PROXY_URL is invalid and will be ignored.");
    return undefined;
  }
}

async function nudgeUiForTraffic(page: Page): Promise<void> {
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(800);

  const clickableSelectors = [
    "button[type='submit']",
    "button[aria-label*='Search']",
    "[data-test-id='search-button']",
    "a[href*='jobSearch']"
  ];

  for (const selector of clickableSelectors) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) continue;
    try {
      await el.click({ timeout: 1200 });
      break;
    } catch {
      // Try next selector.
    }
  }

  await page.waitForTimeout(2500);
}

async function visitSomeJobDetails(page: Page, jobIds: string[]): Promise<void> {
  const sampleIds = jobIds.slice(0, 5);
  for (const jobId of sampleIds) {
    try {
      await page.goto(`https://www.jobsatamazon.co.uk/app#/jobDetail?jobId=${encodeURIComponent(jobId)}`, {
        waitUntil: "networkidle",
        timeout: env.scrapeRenderTimeoutMs
      });
      await page.waitForTimeout(1200);
    } catch {
      // Continue trying to capture available detail traffic.
    }
  }
}

function bodySample(text: string): string {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

export async function captureJobsFromNetwork(): Promise<NetworkCaptureResult> {
  const browser = await chromium.launch({
    headless: env.scrapeHeadless,
    proxy: parseProxyForPlaywright()
  });

  const page = await browser.newPage({ locale: env.graphqlLocale });
  const jobsById = new Map<string, JobListing>();
  const operationsSeen = new Set<string>();
  let extractionAttempts = 0;
  let successfulExtractions = 0;
  let failedExtractions = 0;

  page.on("response", async (response) => {
    if (!response.url().includes("/graphql")) return;

    const observedAt = new Date().toISOString();
    const payload = parseOperation(response);
    const operationName = payload.operationName ?? "unknown";
    operationsSeen.add(operationName);

    let rawBody = "";
    try {
      rawBody = await response.text();
    } catch {
      rawBody = "";
    }

    logger.info(
      {
        observedAt,
        operationName,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? "unknown",
        bodySample: bodySample(rawBody)
      },
      "GraphQL response evidence"
    );

    if (response.status() !== 200) return;

    let parsed: JsonRecord;
    try {
      parsed = JSON.parse(rawBody) as JsonRecord;
    } catch {
      failedExtractions += 1;
      logger.warn({ operationName }, "GraphQL JSON parse failed");
      return;
    }

    const paths: string[] = [];
    collectPayloadPaths(parsed.data, "data", paths);
    logger.info({ operationName, payloadPaths: paths }, "GraphQL payload paths");

    const arrays = discoverCardArrays(parsed.data);
    for (const arr of arrays) {
      const ids = arr.items
        .map((x) => (typeof x.jobId === "string" ? x.jobId : null))
        .filter((x): x is string => Boolean(x));

      logger.info(
        {
          operationName,
          arrayPath: arr.path,
          arrayLength: arr.items.length,
          firstItem: arr.items[0] ?? null,
          jobIdsDiscovered: ids
        },
        "GraphQL card array evidence"
      );
    }

    const nodes: JsonRecord[] = [];
    collectNodes(parsed.data, nodes);
    for (const node of nodes) {
      extractionAttempts += 1;
      const mapped = mapNodeToJob(node);
      if (!mapped) {
        failedExtractions += 1;
        continue;
      }
      successfulExtractions += 1;
      const prev = jobsById.get(mapped.sourceJobId);
      jobsById.set(mapped.sourceJobId, prev ? { ...prev, ...mapped } : mapped);
    }
  });

  try {
    await page.goto(env.amazonJobsUrl, {
      waitUntil: "networkidle",
      timeout: env.scrapeRenderTimeoutMs
    });

    await nudgeUiForTraffic(page);
    await visitSomeJobDetails(page, Array.from(jobsById.keys()));

    const jobs = Array.from(jobsById.values());

    lastCaptureMetrics = {
      extractionAttempts,
      successfulExtractions,
      failedExtractions
    };

    logger.info(
      {
        operationsSeen: Array.from(operationsSeen),
        extractionCount: jobs.length,
        extractionAttempts,
        successfulExtractions,
        failedExtractions
      },
      "Browser-session extraction summary"
    );

    return {
      jobs,
      operationsSeen: Array.from(operationsSeen),
      extractionFailures: failedExtractions,
      extractionAttempts,
      successfulExtractions
    };
  } finally {
    await browser.close();
  }
}
