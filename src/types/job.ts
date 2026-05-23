export type WorkType =
  | "full-time"
  | "part-time"
  | "internship"
  | "seasonal"
  | "contract"
  | "unknown";

export interface JobListing {
  sourceJobId: string;
  title: string;
  location: string;
  salary?: string | null;
  salaryPerHour?: number | null;
  hoursPerWeek?: number | null;
  schedule?: string | null;
  employmentType?: string | null;
  startDate?: string | null;
  workType: WorkType;
  source: string;
  link: string;
}

export interface JobFilterInput {
  keywords: string[];
  locations: string[];
  minSalaryPerHour: number;
  workTypes: string[];
}
