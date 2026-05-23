import { Router } from "express";
import { prisma } from "../config/database.js";

export const jobsRouter = Router();

jobsRouter.get("/latest", async (_req, res) => {
  const jobs = await prisma.job.findMany({
    orderBy: {
      detectedAt: "desc"
    },
    take: 50
  });

  res.json({ jobs });
});

jobsRouter.get("/logs", async (_req, res) => {
  const logs = await prisma.jobLog.findMany({
    orderBy: {
      createdAt: "desc"
    },
    take: 100
  });

  res.json({ logs });
});
