import { prisma } from "../config/database.js";
import type { JobListing } from "../types/job.js";

export async function splitNewAndExistingJobs(jobs: JobListing[]): Promise<{
  newJobs: JobListing[];
  existingJobs: JobListing[];
}> {
  if (jobs.length === 0) {
    return {
      newJobs: [],
      existingJobs: []
    };
  }

  const existing = await prisma.job.findMany({
    where: {
      OR: jobs.map((job) => ({
        source: job.source,
        sourceJobId: job.sourceJobId
      }))
    },
    select: {
      source: true,
      sourceJobId: true
    }
  });

  const existingKeys = new Set(existing.map((job) => `${job.source}:${job.sourceJobId}`));

  const newJobs = jobs.filter((job) => !existingKeys.has(`${job.source}:${job.sourceJobId}`));
  const existingJobs = jobs.filter((job) => existingKeys.has(`${job.source}:${job.sourceJobId}`));

  return { newJobs, existingJobs };
}
