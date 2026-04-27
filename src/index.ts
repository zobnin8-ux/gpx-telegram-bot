import "dotenv/config";
import fs from "fs";
import path from "path";
import { createBot } from "./bot";
import { startServer } from "./server";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

async function main() {
  const BOT_TOKEN = requireEnv("BOT_TOKEN");
  const BASE_URL = requireEnv("BASE_URL");
  const PORT = parseInt(process.env.PORT || "3000", 10);

  const root = process.cwd();
  const publicDir = path.join(root, "public");
  const publicMapsDir = path.join(publicDir, "maps");
  const uploadsDir = path.join(root, "data", "uploads");

  fs.mkdirSync(publicMapsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  startServer(PORT, publicDir);

  const bot = createBot(BOT_TOKEN, {
    uploadsDir,
    publicMapsDir,
    baseUrl: BASE_URL,
  });

  await bot.launch();
  console.log("Telegram bot started.");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
