import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { fetchAmazonJobs } from "../scrapers/amazonScraper.js";
import { splitNewAndExistingJobs } from "./dedupeService.js";
import { filterJobs } from "./filterService.js";
import { getLastCaptureMetrics } from "./networkCaptureService.js";
import { notifyJobs } from "./notificationService.js";
import { logger } from "../utils/logger.js";

let monitorRunning = false;

type CycleClassification = "BLOCKED_CLOUDFRONT" | "EMPTY_GRAPHQL" | "EMPTY_JOB_ARRAY" | "SUCCESS";

function classifyCycle(
  captureMetrics: ReturnType<typeof getLastCaptureMetrics>,
  extractionCount: number
): CycleClassification {
  const blockedByCloudFront =
    captureMetrics.cloudFrontBlockExists ||
    captureMetrics.requestBlockedExists ||
    captureMetrics.pageTitle === "ERROR: The request could not be satisfied";

  if (blockedByCloudFront) {
    return "BLOCKED_CLOUDFRONT";
  }

  if (captureMetrics.graphqlRequestCount === 0 && extractionCount === 0) {
    return "EMPTY_GRAPHQL";
  }

  if (captureMetrics.graphqlRequestCount > 0 && extractionCount === 0) {
    return "EMPTY_JOB_ARRAY";
  }

  return "SUCCESS";
}

export interface MonitorCycleSummary {
  cycleTimestamp: string;
  extractionAttempts: number;
  successfulExtractions: number;
  failedExtractions: number;
  duplicateCount: number;
  filteredCount: number;
  telegramSentCount: number;
  extractionCount: number;
  crashed: boolean;
}

export async function checkAmazonJobs(): Promise<MonitorCycleSummary> {
  const startedAt = new Date();
  const cycleTimestamp = startedAt.toISOString();

  if (monitorRunning) {
    logger.warn("Monitor already running. Skipping.");
    const captureMetrics = getLastCaptureMetrics();
    return {
      cycleTimestamp,
      extractionAttempts: captureMetrics.extractionAttempts,
      successfulExtractions: captureMetrics.successfulExtractions,
      failedExtractions: captureMetrics.failedExtractions,
      duplicateCount: 0,
      filteredCount: 0,
      telegramSentCount: 0,
      extractionCount: 0,
      crashed: false
    };
  }

  monitorRunning = true;

  try {
    logger.info("Amazon fetch started");

    const jobs = await fetchAmazonJobs();

    const filtered = filterJobs(jobs, {
      keywords: env.keywordFilter,
      locations: env.locationFilter,
      minSalaryPerHour: env.minSalaryPerHour,
      workTypes: env.workTypeFilter
    });

    const { newJobs, existingJobs } = await splitNewAndExistingJobs(filtered);
    let sentCount = 0;

    if (newJobs.length > 0) {
      await prisma.job.createMany({
        data: newJobs.map((job) => ({
          sourceJobId: job.sourceJobId,
          title: job.title,
          location: job.location,
          salary: job.salary,
          salaryPerHour: job.salaryPerHour,
          hoursPerWeek: job.hoursPerWeek,
          schedule: job.schedule,
          employmentType: job.employmentType,
          startDate: job.startDate,
          workType: job.workType,
          source: job.source,
          link: job.link
        }))
      });

      const notificationResults = await notifyJobs(newJobs);
      sentCount = notificationResults.filter((result) => result.sentToTelegram).length;

      await prisma.jobLog.createMany({
        data: notificationResults.map((result) => ({
          source: "amazon",
          jobId: result.sourceJobId,
          sentToTelegram: result.sentToTelegram,
          status: result.sentToTelegram ? "sent" : "send_failed",
          errorMessage: result.errorMessage
        }))
      });
    }

    await prisma.jobLog.create({
      data: {
        source: "amazon",
        fetchedCount: jobs.length,
        filteredCount: filtered.length,
        newCount: newJobs.length,
        duplicateCount: existingJobs.length,
        sentToTelegram: sentCount > 0,
        status: "cycle_success"
      }
    });

    const captureMetrics = getLastCaptureMetrics();
    const classification = classifyCycle(captureMetrics, jobs.length);

    logger.info(
      {
        cycleTimestamp,
        classification,
        cloudFrontBlockExists: captureMetrics.cloudFrontBlockExists,
        requestBlockedExists: captureMetrics.requestBlockedExists,
        pageTitle: captureMetrics.pageTitle,
        graphqlRequestCount: captureMetrics.graphqlRequestCount,
        graphqlResponseCount: captureMetrics.graphqlResponseCount,
        extractionCount: jobs.length
      },
      "Amazon monitor cycle classification"
    );

    logger.info(
      {
        cycleTimestamp,
        classification,
        extractionAttempts: captureMetrics.extractionAttempts,
        successfulExtractions: captureMetrics.successfulExtractions,
        failedExtractions: captureMetrics.failedExtractions,
        fetched: jobs.length,
        filtered: filtered.length,
        newJobs: newJobs.length,
        duplicates: existingJobs.length,
        sentToTelegram: sentCount
      },
      "Amazon monitor cycle completed"
    );

    return {
      cycleTimestamp,
      extractionAttempts: captureMetrics.extractionAttempts,
      successfulExtractions: captureMetrics.successfulExtractions,
      failedExtractions: captureMetrics.failedExtractions,
      duplicateCount: existingJobs.length,
      filteredCount: filtered.length,
      telegramSentCount: sentCount,
      extractionCount: jobs.length,
      crashed: false
    };
  } catch (error) {
    try {
      await prisma.jobLog.create({
        data: {
          source: "amazon",
          fetchedCount: 0,
          filteredCount: 0,
          newCount: 0,
          duplicateCount: 0,
          sentToTelegram: false,
          status: "cycle_error",
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
    } catch (loggingError) {
      logger.error({ loggingError }, "Failed to write cycle_error log entry");
    }

    logger.error({ error }, "Amazon monitor cycle failed");

    return {
      cycleTimestamp,
      extractionAttempts: 0,
      successfulExtractions: 0,
      failedExtractions: 0,
      duplicateCount: 0,
      filteredCount: 0,
      telegramSentCount: 0,
      extractionCount: 0,
      crashed: true
    };
  } finally {
    monitorRunning = false;
    const durationMs = Date.now() - startedAt.getTime();
    logger.info({ durationMs }, "Amazon monitor cycle duration");
  }
}
