import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { SessionState, GpxSegment } from "./types";
import { parseGpxFile } from "./gpx";
import { generateMap } from "./mapGenerator";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

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

  bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    clearSession(chatId);
    ensureSession(chatId);
    await ctx.reply(
      "Welcome! Upload one or more GPX files. When finished, send /done.\n\n" +
      "Commands:\n" +
      "/done — generate map link\n" +
      "/cancel — clear current session"
    );
  });

  bot.command("cancel", async (ctx) => {
    clearSession(ctx.chat.id);
    await ctx.reply("Session cleared. Send /start to begin again.");
  });

  bot.command("done", async (ctx) => {
    const chatId = ctx.chat.id;
    const s = sessions.get(chatId);
    if (!s || s.files.length === 0) {
      await ctx.reply("Please upload at least one GPX file first.");
      return;
    }
    try {
      await ctx.reply("Generating map…");
      const segments: GpxSegment[] = [];
      for (let i = 0; i < s.files.length; i++) {
        const f = s.files[i];
        const seg = await parseGpxFile(f.path, displayNameFromFile(f.originalName), i);
        segments.push(seg);
      }
      const valid = segments.filter((seg) => seg.points.length >= 2);
      if (valid.length === 0) {
        await ctx.reply("No valid track points were found in the uploaded files.");
        clearSession(chatId);
        return;
      }
      const map = generateMap(valid, deps.publicMapsDir, deps.baseUrl);
      await ctx.reply(`Your map: ${map.url}`);
    } catch (err) {
      console.error("Map generation error:", err);
      await ctx.reply("Sorry, something went wrong while generating the map.");
    } finally {
      clearSession(chatId);
    }
  });

  bot.on(message("document"), async (ctx) => {
    const chatId = ctx.chat.id;
    const doc = ctx.message.document;
    const fileName = doc.file_name || "file";
    const lower = fileName.toLowerCase();

    if (!lower.endsWith(".gpx")) {
      await ctx.reply("Only .gpx files are accepted. Please send a GPX file.");
      return;
    }
    if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
      await ctx.reply("File is too large. Maximum allowed size is 20 MB.");
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
        await ctx.reply("Could not download the file from Telegram. Please try again.");
        return;
      }
      const buf = await res.buffer();
      if (buf.length > MAX_FILE_SIZE_BYTES) {
        await ctx.reply("File is too large. Maximum allowed size is 20 MB.");
        return;
      }
      fs.writeFileSync(dest, buf);

      session.files.push({ path: dest, originalName: fileName });
      await ctx.reply("GPX received. Upload more files or send /done.");
    } catch (err) {
      console.error("Upload error:", err);
      await ctx.reply("Could not save the uploaded file. Please try again.");
    }
  });

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    await ctx.reply(
      "Please upload .gpx files as documents, then send /done.\n" +
      "Use /start to reset the session."
    );
  });

  bot.catch((err: unknown, ctx: Context) => {
    console.error("Bot error:", err);
    try { ctx.reply("Unexpected error. Please try again."); } catch { /* ignore */ }
  });

  return bot;
}
