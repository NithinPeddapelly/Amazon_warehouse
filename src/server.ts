import cron from "node-cron";
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

cron.schedule(`*/${env.scrapeIntervalSeconds} * * * * *`, async () => {
  await checkAmazonJobs();
});

const run = async () => {
  await checkAmazonJobs();

  app.listen(env.port, () => {
    logger.info({ port: env.port }, "Server started");
  });
};

run().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
