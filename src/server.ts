import express from "express";
import { env } from "./config/env.js";
import { jobsRouter } from "./routes/jobs.js";
import { checkAmazonJobs } from "./services/monitorService.js";
import { logger } from "./utils/logger.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "scotjob-pulse-ai"
  });
});

app.use("/jobs", jobsRouter);

const intervalMs = env.scrapeIntervalMinutes * 60 * 1000;

async function runMonitorCycle(reason: "startup" | "schedule"): Promise<void> {
  try {
    await checkAmazonJobs();
  } catch (error) {
    logger.error({ error, reason }, "Monitor cycle failed");
  }
}

const run = async () => {
  app.listen(env.port, () => {
    logger.info({ port: env.port }, "Server started");
  });

  // Run one initial cycle after boot without blocking startup readiness.
  void runMonitorCycle("startup");

  setInterval(() => {
    void runMonitorCycle("schedule");
  }, intervalMs);
};

run().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
