import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { Telegraf, Context, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { SessionState, GpxSegment } from "./types";
import { parseGpxFile } from "./gpx";
import { generateMap } from "./mapGenerator";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const BTN_DONE = "✅ Готово";
const BTN_CANCEL = "✖ Отменить";
const BTN_HELP = "ℹ Помощь";

function mainKeyboard(filesCount: number) {
  const doneLabel = filesCount > 0 ? `${BTN_DONE} (${filesCount})` : BTN_DONE;
  return Markup.keyboard([[doneLabel, BTN_CANCEL], [BTN_HELP]])
    .resize()
    .persistent();
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.slice(0, 120) || "file.gpx";
}

function displayNameFromFile(name: string): string {
  const base = path.basename(name);
  return base.replace(/\.gpx$/i, "") || "Segment";
}

export interface BotDeps {
  uploadsDir: string;
  publicMapsDir: string;
  baseUrl: string;
}

export function createBot(token: string, deps: BotDeps): Telegraf {
  const bot = new Telegraf(token);
  const sessions = new Map<number, SessionState>();

  function sessionDir(chatId: number, sessionId: string): string {
    return path.join(deps.uploadsDir, String(chatId), sessionId);
  }

  function ensureSession(chatId: number): SessionState {
    let s = sessions.get(chatId);
    if (!s) {
      s = { files: [] };
      sessions.set(chatId, s);
    }
    return s;
  }

  function clearSession(chatId: number): void {
    const s = sessions.get(chatId);
    if (s) {
      for (const f of s.files) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
      const chatRoot = path.join(deps.uploadsDir, String(chatId));
      try {
        if (fs.existsSync(chatRoot)) {
          for (const dir of fs.readdirSync(chatRoot)) {
            const full = path.join(chatRoot, dir);
            try { fs.rmSync(full, { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    sessions.delete(chatId);
  }

  async function showWelcome(ctx: Context, filesCount: number): Promise<void> {
    await ctx.reply(
      "👋 Привет! Я строю интерактивную карту из GPX-треков.\n\n" +
      "📎 Просто отправь мне один или несколько *.gpx* файлов как документы.\n" +
      "Когда все файлы загружены — нажми *✅ Готово* и я пришлю ссылку на карту.\n\n" +
      "Каждый трек будет показан отдельным цветным сегментом с дистанцией (NM) и средней скоростью (kt).",
      { parse_mode: "Markdown", ...mainKeyboard(filesCount) }
    );
  }

  async function handleDone(ctx: Context): Promise<void> {
    const chatId = ctx.chat!.id;
    const s = sessions.get(chatId);
    if (!s || s.files.length === 0) {
      await ctx.reply(
        "⚠ Сначала загрузи хотя бы один GPX-файл.",
        mainKeyboard(0)
      );
      return;
    }
    try {
      await ctx.reply("⏳ Строю карту…", Markup.removeKeyboard());
      const segments: GpxSegment[] = [];
      for (let i = 0; i < s.files.length; i++) {
        const f = s.files[i];
        const seg = await parseGpxFile(f.path, displayNameFromFile(f.originalName), i);
        segments.push(seg);
      }
      const valid = segments.filter((seg) => seg.points.length >= 2);
      if (valid.length === 0) {
        await ctx.reply(
          "❌ В загруженных файлах не найдено валидных точек трека.",
          mainKeyboard(0)
        );
        clearSession(chatId);
        return;
      }
      const map = generateMap(valid, deps.publicMapsDir, deps.baseUrl);

      const totalNm = valid.reduce((a, b) => a + b.distanceNm, 0);
      const summary =
        `✅ Готово! Сегментов: *${valid.length}*, общая дистанция: *${totalNm.toFixed(1)} NM*\n\n` +
        valid.map((seg, i) =>
          `${i + 1}. ${escapeMd(seg.name)} — ${seg.distanceNm.toFixed(1)} NM` +
          (seg.averageSpeedKt !== null ? `, ${seg.averageSpeedKt.toFixed(1)} kt` : `, скорость N/A`)
        ).join("\n");

      await ctx.reply(summary, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.url("🗺 Открыть карту", map.url)],
        ]),
      });
      await ctx.reply(
        "Можешь начать новую сессию — отправь файлы или /start.",
        mainKeyboard(0)
      );
    } catch (err) {
      console.error("Map generation error:", err);
      await ctx.reply(
        "❌ Не получилось построить карту. Попробуй ещё раз.",
        mainKeyboard(0)
      );
    } finally {
      clearSession(chatId);
    }
  }

  async function handleCancel(ctx: Context): Promise<void> {
    clearSession(ctx.chat!.id);
    await ctx.reply("🧹 Сессия очищена.", mainKeyboard(0));
  }

  bot.start(async (ctx) => {
    clearSession(ctx.chat.id);
    ensureSession(ctx.chat.id);
    await showWelcome(ctx, 0);
  });

  bot.command("done", handleDone);
  bot.command("cancel", handleCancel);
  bot.command("help", (ctx) => showWelcome(ctx, sessions.get(ctx.chat.id)?.files.length || 0));

  bot.on(message("document"), async (ctx) => {
    const chatId = ctx.chat.id;
    const doc = ctx.message.document;
    const fileName = doc.file_name || "file";
    const lower = fileName.toLowerCase();

    if (!lower.endsWith(".gpx")) {
      await ctx.reply(
        "⚠ Я принимаю только *.gpx* файлы. Отправь файл с расширением .gpx.",
        { parse_mode: "Markdown", ...mainKeyboard(sessions.get(chatId)?.files.length || 0) }
      );
      return;
    }
    if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
      await ctx.reply("⚠ Файл слишком большой. Максимум — 20 МБ.");
      return;
    }

    try {
      const session = ensureSession(chatId);
      const sessionId =
        (session.files[0] && path.basename(path.dirname(session.files[0].path))) ||
        crypto.randomUUID();
      const dir = sessionDir(chatId, sessionId);
      fs.mkdirSync(dir, { recursive: true });

      const safeName = sanitizeFileName(fileName);
      const dest = path.join(dir, `${Date.now()}_${session.files.length}_${safeName}`);

      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(link.toString());
      if (!res.ok) {
        await ctx.reply("❌ Не удалось скачать файл из Telegram. Попробуй ещё раз.");
        return;
      }
      const buf = await res.buffer();
      if (buf.length > MAX_FILE_SIZE_BYTES) {
        await ctx.reply("⚠ Файл слишком большой. Максимум — 20 МБ.");
        return;
      }
      fs.writeFileSync(dest, buf);

      session.files.push({ path: dest, originalName: fileName });
      await ctx.reply(
        `📥 Принял файл *${escapeMd(fileName)}*.\n` +
        `Загружено: *${session.files.length}*. Можешь отправить ещё или нажать *✅ Готово*.`,
        { parse_mode: "Markdown", ...mainKeyboard(session.files.length) }
      );
    } catch (err) {
      console.error("Upload error:", err);
      await ctx.reply("❌ Не удалось сохранить файл. Попробуй ещё раз.");
    }
  });

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith(BTN_DONE)) return handleDone(ctx);
    if (text.startsWith(BTN_CANCEL)) return handleCancel(ctx);
    if (text.startsWith(BTN_HELP)) return showWelcome(ctx, sessions.get(ctx.chat.id)?.files.length || 0);
    if (text.startsWith("/")) return;
    await ctx.reply(
      "📎 Отправь GPX-файл как документ, либо нажми кнопку ниже.",
      mainKeyboard(sessions.get(ctx.chat.id)?.files.length || 0)
    );
  });

  bot.catch((err: unknown, ctx: Context) => {
    console.error("Bot error:", err);
    try { ctx.reply("⚠ Внутренняя ошибка. Попробуй ещё раз."); } catch { /* ignore */ }
  });

  // Set Telegram command menu (the "/" hint that appears in the input field)
  bot.telegram.setMyCommands([
    { command: "start", description: "Начать новую сессию" },
    { command: "done", description: "Построить карту" },
    { command: "cancel", description: "Отменить" },
    { command: "help", description: "Помощь" },
  ]).catch((e) => console.warn("setMyCommands failed:", e));

  return bot;
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[\]])/g, "\\$1");
}
