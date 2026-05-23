import type { JobFilterInput, JobListing } from "../types/job.js";
import { scotlandLocations } from "../utils/scotlandLocations.js";

export function isScotlandJob(location: string): boolean {
  const normalized = location.toLowerCase();
  return scotlandLocations.some((city) => normalized.includes(city));
}

function matchesKeywords(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const normalizedTitle = title.toLowerCase();
  return keywords.some((keyword) => normalizedTitle.includes(keyword.toLowerCase()));
}

function matchesWorkType(jobWorkType: string, allowedTypes: string[]): boolean {
  if (allowedTypes.length === 0) return true;
  return allowedTypes.some((workType) => jobWorkType.includes(workType.toLowerCase()));
}

function matchesLocation(location: string, locations: string[]): boolean {
  if (locations.length === 0) return true;
  const normalized = location.toLowerCase();
  return locations.some((city) => normalized.includes(city.toLowerCase()));
}

export function filterJobs(jobs: JobListing[], filters: JobFilterInput): JobListing[] {
  return jobs.filter((job) => {
    if (!isScotlandJob(job.location)) {
      return false;
    }

    if (!matchesKeywords(job.title, filters.keywords)) {
      return false;
    }

    if (!matchesLocation(job.location, filters.locations)) {
      return false;
    }

    if (!matchesWorkType(job.workType, filters.workTypes)) {
      return false;
    }

    if (filters.minSalaryPerHour > 0) {
      const salary = job.salaryPerHour ?? 0;
      if (salary < filters.minSalaryPerHour) {
        return false;
      }
    }

    return true;
  });
}
