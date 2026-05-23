import axios, { type AxiosProxyConfig } from "axios";
import { env } from "../config/env.js";
import type { JobListing, WorkType } from "../types/job.js";
import { logger } from "../utils/logger.js";

type JsonObject = Record<string, unknown>;

interface GraphQLOperation {
  operationName: string;
  variableKey: string;
  query?: string;
}

const SEARCH_OPERATIONS: GraphQLOperation[] = [
  {
    operationName: "searchScheduleCards",
    variableKey: "searchScheduleCardsRequest",
    query:
      "query searchScheduleCards($searchScheduleCardsRequest: SearchScheduleCardsRequestInput!) { searchScheduleCards(searchScheduleCardsRequest: $searchScheduleCardsRequest) { jobId } }"
  },
  {
    operationName: "searchJobs",
    variableKey: "searchJobsRequest",
    query:
      "query searchJobs($searchJobsRequest: SearchJobsRequestInput!) { searchJobs(searchJobsRequest: $searchJobsRequest) { jobId } }"
  },
  {
    operationName: "searchJobCards",
    variableKey: "searchJobCardsRequest",
    query:
      "query searchJobCards($searchJobCardsRequest: SearchJobCardsRequestInput!) { searchJobCards(searchJobCardsRequest: $searchJobCardsRequest) { jobId } }"
  },
  {
    operationName: "searchScheduleCards",
    variableKey: "SearchScheduleRequest",
    query:
      "query searchScheduleCards($SearchScheduleRequest: SearchScheduleRequestInput!) { searchScheduleCards(SearchScheduleRequest: $SearchScheduleRequest) { jobId } }"
  }
];

const GET_JOB_DETAIL_QUERIES = [
  {
    operationName: "getJobDetail",
    query:
      "query getJobDetail($getJobDetailRequest: GetJobDetailRequestInput!) { getJobDetail(getJobDetailRequest: $getJobDetailRequest) { jobId jobTitle employmentType jobType totalPayRateMin currencyCode tagLine city location locationName region hoursPerWeek weeklyHours schedule shiftPattern startDate postedDate firstDay } }"
  },
  {
    operationName: "getJobDetail",
    query: undefined
  }
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

function parseProxyConfig(): AxiosProxyConfig | false {
  if (!env.scrapeProxyUrl) {
    return false;
  }

  try {
    const parsed = new URL(env.scrapeProxyUrl);
    return {
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
      auth:
        parsed.username || parsed.password
          ? {
              username: decodeURIComponent(parsed.username),
              password: decodeURIComponent(parsed.password)
            }
          : undefined
    };
  } catch {
    logger.warn("SCRAPE_PROXY_URL is invalid and will be ignored for GraphQL requests.");
    return false;
  }
}

async function postGraphQL(operationName: string, variables: JsonObject, query?: string): Promise<JsonObject> {
  const proxy = parseProxyConfig();
  const authHeaders =
    env.graphqlAuthHeader && env.graphqlAuthValue
      ? {
          [env.graphqlAuthHeader]: env.graphqlAuthValue
        }
      : {};

  const response = await axios.post(
    env.graphqlEndpoint,
    {
      operationName,
      variables,
      ...(query ? { query } : {})
    },
    {
      timeout: env.scrapeRequestTimeoutMs,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": env.scrapeAcceptLanguage,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Origin: "https://www.jobsatamazon.co.uk",
        Referer: "https://www.jobsatamazon.co.uk/app#/jobSearch",
        ...authHeaders
      },
      proxy,
      validateStatus: (status) => status >= 200 && status < 500
    }
  );

  if (response.status >= 400) {
    const bodySnippet =
      typeof response.data === "string"
        ? response.data.slice(0, 400)
        : JSON.stringify(response.data).slice(0, 400);
    throw new Error(`GraphQL request failed: ${response.status}; body=${bodySnippet}`);
  }

  const payload = response.data as JsonObject;
  if (!payload || typeof payload !== "object") {
    throw new Error("GraphQL response payload is not an object.");
  }

  const errors = payload.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`GraphQL returned errors for ${operationName}`);
  }

  return payload;
}

function deepVisit(value: unknown, visitor: (node: JsonObject) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepVisit(item, visitor);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const node = value as JsonObject;
  visitor(node);

  for (const child of Object.values(node)) {
    deepVisit(child, visitor);
  }
}

function collectJobIds(payload: JsonObject): string[] {
  const ids = new Set<string>();

  deepVisit(payload, (node) => {
    const candidate = node.jobId;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      ids.add(candidate.trim());
    }
  });

  return Array.from(ids).slice(0, Math.max(1, env.graphqlSearchLimit));
}

function firstString(node: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstNumber(node: JsonObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function mapDetailToListing(detail: JsonObject, jobId: string): JobListing {
  const title = firstString(detail, ["jobTitle", "title", "name"]) ?? "Unknown title";
  const city = firstString(detail, ["city", "location", "locationName"]);
  const region = firstString(detail, ["region", "state", "country"]) ?? "Scotland";
  const tagLine = firstString(detail, ["tagLine", "description", "summary"]);
  const location = city && region ? `${city}, ${region}` : city ?? tagLine ?? "Unknown location";

  const payMin = firstNumber(detail, ["totalPayRateMin", "payRateMin", "hourlyRate", "salaryMin"]);
  const currency = firstString(detail, ["currencyCode", "currency"]) ?? "GBP";
  const salary = payMin !== null ? `${currency} ${payMin}/hr` : null;

  const hoursPerWeek = firstNumber(detail, ["hoursPerWeek", "weeklyHours", "hours"]);
  const schedule = firstString(detail, ["schedule", "shiftPattern", "shiftType"]);
  const employmentType = firstString(detail, ["employmentType", "jobType", "workType"]);
  const startDate = firstString(detail, ["startDate", "postedDate", "firstDay"]);
  const workType = inferWorkType(`${employmentType ?? ""} ${firstString(detail, ["jobType"]) ?? ""}`);

  return {
    sourceJobId: jobId,
    title,
    location,
    salary,
    salaryPerHour: payMin,
    hoursPerWeek,
    schedule,
    employmentType,
    startDate,
    workType,
    source: "amazon",
    link: `https://www.jobsatamazon.co.uk/app#/jobDetail?jobId=${encodeURIComponent(jobId)}`
  };
}

function pickDetailNode(payload: JsonObject, targetJobId: string): JsonObject | null {
  let found: JsonObject | null = null;

  deepVisit(payload, (node) => {
    if (found) {
      return;
    }

    if (node.jobId === targetJobId) {
      found = node;
    }
  });

  return found;
}

export async function searchJobs(): Promise<string[]> {
  let lastError: unknown;

  for (const operation of SEARCH_OPERATIONS) {
    try {
      let payload: JsonObject | null = null;

      const candidateVariables = {
        [operation.variableKey]: {
          locale: env.graphqlLocale,
          page: 1,
          size: env.graphqlSearchLimit
        }
      };

      const attempts = [undefined, operation.query];

      for (const query of attempts) {
        try {
          payload = await postGraphQL(operation.operationName, candidateVariables, query);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!payload) {
        continue;
      }

      const ids = collectJobIds(payload);
      if (ids.length > 0) {
        logger.info({ operation: operation.operationName, count: ids.length }, "GraphQL job search succeeded");
        return ids;
      }
    } catch (error) {
      lastError = error;
      logger.warn(
        {
          operation: operation.operationName,
          variableKey: operation.variableKey,
          errorMessage: error instanceof Error ? error.message : String(error)
        },
        "GraphQL job search operation failed"
      );
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("No GraphQL search operation returned any job IDs.");
}

export async function getJobDetail(jobId: string): Promise<JobListing> {
  let payload: JsonObject | null = null;
  let lastError: unknown;

  for (const option of GET_JOB_DETAIL_QUERIES) {
    try {
      payload = await postGraphQL(
        option.operationName,
        {
          getJobDetailRequest: {
            locale: env.graphqlLocale,
            jobId
          }
        },
        option.query
      );
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!payload) {
    throw lastError instanceof Error ? lastError : new Error("GraphQL getJobDetail failed.");
  }

  const detailNode = pickDetailNode(payload, jobId);
  if (!detailNode) {
    throw new Error(`No job detail found in GraphQL response for ${jobId}`);
  }

  return mapDetailToListing(detailNode, jobId);
}
