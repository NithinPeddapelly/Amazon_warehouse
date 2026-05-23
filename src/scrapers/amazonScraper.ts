import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { env } from "../config/env.js";
import { captureJobsFromNetwork } from "../services/networkCaptureService.js";
import type { JobListing, WorkType } from "../types/job.js";
import { logger } from "../utils/logger.js";

const JOB_CONTAINER_SELECTORS = [
  "[data-test-id='job-tile']",
  "[data-test-id='job-card']",
  ".job-tile",
  ".job-card",
  ".job"
];

function inferWorkType(value: string): WorkType {
  const text = value.toLowerCase();
  if (text.includes("full")) return "full-time";
  if (text.includes("part")) return "part-time";
  if (text.includes("intern")) return "internship";
  if (text.includes("season")) return "seasonal";
  if (text.includes("contract")) return "contract";
  return "unknown";
}

function parseHourlyRate(text: string): number | null {
  const match = text.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function parseHoursPerWeek(text: string): number | null {
  const match = text.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*\/?\s*week/);
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function inferSchedule(value: string): string | null {
  const text = value.toLowerCase();
  if (text.includes("night")) return "night";
  if (text.includes("day")) return "day";
  if (text.includes("weekend")) return "weekend";
  if (text.includes("flex")) return "flex";
  return null;
}

function parseProxyForPlaywright(): { server: string; username?: string; password?: string } | undefined {
  if (!env.scrapeProxyUrl) {
    return undefined;
  }

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

async function fetchFallbackHtmlWithPlaywright(): Promise<string> {
  const browser = await chromium.launch({
    headless: false,
    proxy: parseProxyForPlaywright()
  });

  try {
    const page = await browser.newPage({ locale: env.graphqlLocale });
    await page.goto(env.amazonJobsUrl, {
      waitUntil: "networkidle",
      timeout: env.scrapeRenderTimeoutMs
    });

    await page.waitForTimeout(2000);
    return await page.content();
  } finally {
    await browser.close();
  }
}

function parseFallbackHtml(html: string): JobListing[] {
  const $ = cheerio.load(html);
  const jobs: JobListing[] = [];

  const containers = $(JOB_CONTAINER_SELECTORS.join(","));

  containers.each((_, elem) => {
    const container = $(elem);
    const title =
      container.find("[data-test-id='job-title'], .job-title, h3, h2, a").first().text().trim() ||
      "Unknown title";
    const location =
      container.find("[data-test-id='job-location'], .location, .job-location").first().text().trim() ||
      "Unknown location";
    const salary =
      container.find(".salary, [data-test-id='pay-rate'], [data-test-id='salary']").first().text().trim() || null;
    const metaText = container.text();

    const href = container.find("a[href*='job'], a[href*='jobs'], a").first().attr("href") ?? "";
    const link = href.startsWith("http")
      ? href
      : `${new URL(env.amazonJobsUrl).origin}${href}`;

    const sourceJobId =
      container.attr("data-job-id") ??
      href.split("jobId=").at(1)?.split("&").at(0) ??
      href.split("/").filter(Boolean).at(-1) ??
      `${title}-${location}`.toLowerCase().replace(/\s+/g, "-");

    jobs.push({
      sourceJobId,
      title,
      location,
      salary,
      salaryPerHour: salary ? parseHourlyRate(salary) : parseHourlyRate(metaText),
      hoursPerWeek: parseHoursPerWeek(metaText),
      schedule: inferSchedule(metaText),
      employmentType: inferWorkType(metaText),
      startDate: null,
      workType: inferWorkType(metaText),
      source: "amazon",
      link
    });
  });

  return Array.from(new Map(jobs.map((job) => [`${job.source}:${job.sourceJobId}`, job])).values());
}

export async function fetchAmazonJobs(): Promise<JobListing[]> {
  try {
    const networkCapture = await captureJobsFromNetwork();
    if (networkCapture.jobs.length > 0) {
      logger.info(
        {
          count: networkCapture.jobs.length,
          operationsSeen: networkCapture.operationsSeen,
          extractionFailures: networkCapture.extractionFailures
        },
        "Amazon network capture fetch complete"
      );
      return networkCapture.jobs;
    }

    logger.warn(
      {
        operationsSeen: networkCapture.operationsSeen,
        extractionFailures: networkCapture.extractionFailures
      },
      "Network capture returned zero jobs. Using HTML fallback parsing."
    );
  } catch (error) {
    logger.warn(
      { errorMessage: error instanceof Error ? error.message : String(error) },
      "Network capture failed. Using HTML fallback parsing."
    );
  }

  try {
    const html = await fetchFallbackHtmlWithPlaywright();
    const fallbackJobs = parseFallbackHtml(html);
    logger.info({ count: fallbackJobs.length }, "Fallback HTML parse complete");
    return fallbackJobs;
  } catch (error) {
    logger.error({ error }, "Amazon scraper failed on network-capture and fallback paths");
    return [];
  }
}
