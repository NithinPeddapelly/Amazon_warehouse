import { sendTelegramMessage } from "../config/telegram.js";
import { env } from "../config/env.js";
import type { JobListing } from "../types/job.js";

export interface NotificationResult {
  sourceJobId: string;
  sentToTelegram: boolean;
  errorMessage?: string;
}

const PIPELINE_TEST_MESSAGE = [
  "🚨 ScotJob Pulse Test",
  "",
  "Location: Edinburgh",
  "Job: Warehouse Associate",
  "Status: Telegram connection successful"
].join("\n");

function redactSensitive(input: string): string {
  let value = input;
  if (env.botToken) {
    value = value.split(env.botToken).join("[REDACTED_BOT_TOKEN]");
  }
  if (env.chatId) {
    value = value.split(String(env.chatId)).join("[REDACTED_CHAT_ID]");
  }
  return value;
}

export function toMessage(job: JobListing): string {
  const salaryText = job.salary ?? (job.salaryPerHour !== null && job.salaryPerHour !== undefined ? `£${job.salaryPerHour}/hr` : "N/A");
  const scheduleText = job.schedule ?? (job.hoursPerWeek ? `${job.hoursPerWeek} hrs/week` : "N/A");

  return [
    "🚨 New Scotland Job Found",
    "",
    `📍 ${job.location}`,
    `💼 ${job.title}`,
    `💰 ${salaryText}`,
    `⏰ ${scheduleText}`,
    `🔗 ${job.link}`
  ].join("\n");
}

export async function notifyJobs(jobs: JobListing[]): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  for (const job of jobs) {
    try {
      await sendTelegramMessage(toMessage(job));
      results.push({
        sourceJobId: job.sourceJobId,
        sentToTelegram: true
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      results.push({
        sourceJobId: job.sourceJobId,
        sentToTelegram: false,
        errorMessage: redactSensitive(raw)
      });
    }
  }

  return results;
}

export async function sendPipelineTestNotification(): Promise<{ sentToTelegram: boolean; errorMessage?: string }> {
  try {
    await sendTelegramMessage(PIPELINE_TEST_MESSAGE);
    return { sentToTelegram: true };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      sentToTelegram: false,
      errorMessage: redactSensitive(raw)
    };
  }
}
