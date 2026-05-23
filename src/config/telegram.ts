import TelegramBot from "node-telegram-bot-api";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

const bot = env.botToken ? new TelegramBot(env.botToken) : null;

export async function sendTelegramMessage(message: string): Promise<void> {
  if (!bot || !env.chatId) {
    logger.warn("Skipping Telegram notification because BOT_TOKEN or CHAT_ID is not configured.");
    return;
  }

  await bot.sendMessage(env.chatId, message);
}
