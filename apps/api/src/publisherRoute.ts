import crypto from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import express from "express";
import Database from "better-sqlite3";
import { google } from "googleapis";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const now = () => new Date().toISOString();

function getSessionId(req: express.Request): string {
  const raw = String(req.get("cookie") || "");
  const match = raw.match(/(?:^|;\s*)acs_session=([^;]+)/);
  return match ? String(match[1]) : "";
}

function requireSession(req: express.Request, res: express.Response): string | null {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    res.status(401).json({ error: { code: "session_required", message: "A studio session is required." } });
    return null;
  }
  return sessionId;
}

function encodeState(sessionId: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({
    sessionId,
    issuedAt: Date.now(),
    nonce: randomUUID(),
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

function decodeState(state: string, secret: string): { sessionId: string; issuedAt: number } | null {
  const parts = String(state || "").split(".");
  if (parts.length !== 2) return null;
  const [payload, supplied] = parts;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.sessionId || !data.issuedAt || Date.now() - Number(data.issuedAt) > 10 * 60 * 1000) return null;
    return { sessionId: String(data.sessionId), issuedAt: Number(data.issuedAt) };
  } catch {
    return null;
  }
}

function encryptionKey(): Buffer {
  const configured = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || process.env.YOUTUBE_OAUTH_STATE_SECRET || "";
  if (!configured) throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY is not configured");
  return crypto.createHash("sha256").update(configured).digest();
}

function encryptToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptToken(value: string): string {
  const [version, iv, tag, ciphertext] = String(value).split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getRedirectUri(req: express.Request): string {
  const configured = process.env.GOOGLE_YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  if (configured) return configured;
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "");
  return `${proto}://${host}/api/youtube/oauth/callback`;
}

function oauthClient(req: express.Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) throw new Error("Google OAuth client credentials are not configured");
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri(req));
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`Upstream request failed (${response.status}): ${text.slice(0, 1000)}`);
  try { return JSON.parse(text); } catch { throw new Error("Upstream returned invalid JSON"); }
}

async function moneyPrinterRequest(path: string, init: RequestInit = {}) {
  const base = String(process.env.MONEYPRINTERTURBO_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("MONEYPRINTERTURBO_URL is not configured");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  const apiKey = String(process.env.MONEYPRINTERTURBO_API_KEY || "");
  if (apiKey) headers.set("x-api-key", apiKey);
  const response = await fetch(base + path, { ...init, headers });
  return readJson(response);
}

function validateVideoUrl(req: express.Request, rawUrl: string): URL | null {
  const value = String(rawUrl || "").trim();
  if (!value) return null;
  let target: URL;
  try {
    const ownBase = `${String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim()}://${String(req.get("x-forwarded-host") || req.get("host") || "")}`;
    target = new URL(value, ownBase);
  } catch {
    return null;
  }
  const allowed = new Set<string>();
  const ownHost = String(req.get("x-forwarded-host") || req.get("host") || "").split(":")[0];
  if (ownHost) allowed.add(ownHost);
  const mpt = String(process.env.MONEYPRINTERTURBO_URL || "");
  if (mpt) {
    try { allowed.add(new URL(mpt).hostname); } catch {}
  }
  if (!["https:", "http:"].includes(target.protocol) || !allowed.has(target.hostname)) return null;
  return target;
}

async function downloadVideo(req: express.Request, videoUrl: string, destination: string) {
  const target = validateVideoUrl(req, videoUrl);
  if (!target) throw new Error("videoUrl must belong to the studio or configured MoneyPrinterTurbo host");

  const headers = new Headers();
  const mpt = String(process.env.MONEYPRINTERTURBO_URL || "");
  if (mpt && process.env.MONEYPRINTERTURBO_API_KEY) {
    try {
      if (target.hostname === new URL(mpt).hostname) headers.set("x-api-key", String(process.env.MONEYPRINTERTURBO_API_KEY));
    } catch {}
  }
  const ownHost = String(req.get("x-forwarded-host") || req.get("host") || "").split(":")[0];
  if (process.env.EDGE_SHARED_SECRET && ownHost && target.hostname === ownHost) {
    headers.set("x-edge-shared-secret", String(process.env.EDGE_SHARED_SECRET));
  }

  const response = await fetch(target, { headers, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Video download failed (${response.status})`);

  const maxBytes = 2 * 1024 * 1024 * 1024;
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("Video is larger than the 2 GB safety limit");

  let bytes = 0;
  const limited = new ReadableStream({
    async start(controller) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxBytes) {
            controller.error(new Error("Video is larger than the 2 GB safety limit"));
            await reader.cancel();
            return;
          }
          controller.enqueue(part.value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  await pipeline(Readable.fromWeb(limited), createWriteStream(destination));
}

export function registerPublisherRoutes(app: express.Express, db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_connections(
      session_id TEXT PRIMARY KEY,
      refresh_token_enc TEXT NOT NULL,
      channel_id TEXT,
      channel_title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  app.get("/api/publisher/status", (req, res) => {
    const sessionId = getSessionId(req);
    const row = sessionId
      ? db.prepare("SELECT channel_id, channel_title, updated_at FROM youtube_connections WHERE session_id=?").get(sessionId)
      : null;
    res.json({
      moneyPrinterTurboConfigured: Boolean(process.env.MONEYPRINTERTURBO_URL),
      youtubeConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      youtubeConnected: Boolean(row?.refresh_token_enc),
      channel: row ? { id: row.channel_id, title: row.channel_title } : null,
      redirectUri: getRedirectUri(req),
    });
  });

  app.get("/api/youtube/oauth/start", (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    try {
      const client = oauthClient(req);
      const stateSecret = process.env.YOUTUBE_OAUTH_STATE_SECRET || process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || "";
      if (!stateSecret) throw new Error("YOUTUBE_OAUTH_STATE_SECRET is not configured");
      const state = encodeState(sessionId, stateSecret);
      const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: YOUTUBE_SCOPES, state });
      res.redirect(url);
    } catch (error) {
      res.status(503).json({ error: { code: "youtube_oauth_unavailable", message: error instanceof Error ? error.message : "YouTube OAuth is unavailable" } });
    }
  });

  app.get("/api/youtube/oauth/callback", async (req, res) => {
    const stateSecret = process.env.YOUTUBE_OAUTH_STATE_SECRET || process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || "";
    const decoded = stateSecret ? decodeState(String(req.query.state || ""), stateSecret) : null;
    const currentSession = getSessionId(req);
    if (!decoded || !currentSession || decoded.sessionId !== currentSession) {
      return res.status(400).send("OAuth state is invalid or expired. Return to the Studio and connect YouTube again.");
    }
    if (req.query.error) return res.status(400).send(`Google OAuth was not completed: ${String(req.query.error)}`);
    try {
      const client = oauthClient(req);
      const { tokens } = await client.getToken(String(req.query.code || ""));
      if (!tokens.access_token && !tokens.refresh_token) throw new Error("Google did not return usable OAuth tokens");
      client.setCredentials(tokens);
      const youtube = google.youtube({ version: "v3", auth: client });
      const channelResponse = await youtube.channels.list({ part: ["id", "snippet"], mine: true, maxResults: 1 });
      const channel = channelResponse.data.items?.[0];
      const existing = db.prepare("SELECT refresh_token_enc, created_at FROM youtube_connections WHERE session_id=?").get(currentSession);
      const refreshToken = tokens.refresh_token
        ? String(tokens.refresh_token)
        : existing?.refresh_token_enc
          ? decryptToken(String(existing.refresh_token_enc))
          : "";
      if (!refreshToken) throw new Error("Google did not return a refresh token");
      const encrypted = encryptToken(refreshToken);
      const ts = now();
      db.prepare(`
        INSERT INTO youtube_connections(session_id,refresh_token_enc,channel_id,channel_title,created_at,updated_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET
          refresh_token_enc=excluded.refresh_token_enc,
          channel_id=excluded.channel_id,
          channel_title=excluded.channel_title,
          updated_at=excluded.updated_at
      `).run(currentSession, encrypted, channel?.id || null, channel?.snippet?.title || null, existing?.created_at || ts, ts);
      res.redirect("/?youtube=connected");
    } catch (error) {
      res.status(502).send(error instanceof Error ? error.message : "YouTube connection failed");
    }
  });

  app.delete("/api/youtube/connection", (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    db.prepare("DELETE FROM youtube_connections WHERE session_id=?").run(sessionId);
    res.json({ ok: true });
  });

  app.post("/api/publisher/moneyprinter/generate", async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    const subject = String(req.body?.videoSubject || "").trim();
    if (!subject) return res.status(400).json({ error: { code: "video_subject_required", message: "videoSubject is required" } });

    try {
      const rawDuration = Number(req.body?.videoClipDuration || 5);
      const payload = {
        video_subject: subject.slice(0, 500),
        video_script: String(req.body?.videoScript || "").slice(0, 8000),
        video_language: String(req.body?.videoLanguage || "ar").slice(0, 64),
        video_aspect: ["9:16", "16:9", "1:1"].includes(String(req.body?.videoAspect)) ? String(req.body.videoAspect) : "9:16",
        video_fit_mode: ["cover", "contain"].includes(String(req.body?.videoFitMode)) ? String(req.body.videoFitMode) : "cover",
        video_concat_mode: ["random", "sequential"].includes(String(req.body?.videoConcatMode)) ? String(req.body.videoConcatMode) : "random",
        video_clip_duration: Number.isFinite(rawDuration) ? Math.max(1, Math.min(30, rawDuration)) : 5,
        video_count: Math.max(1, Math.min(3, Number(req.body?.videoCount || 1))),
        video_source: String(req.body?.videoSource || "pexels").slice(0, 64),
        voice_name: String(req.body?.voiceName || ""),
        subtitle_enabled: req.body?.subtitleEnabled !== false,
        subtitle_position: "bottom",
        video_script_prompt: String(req.body?.videoScriptPrompt || "").slice(0, 2000),
        custom_system_prompt: String(req.body?.customSystemPrompt || "").slice(0, 8000),
      };
      const data = await moneyPrinterRequest("/api/v1/videos", { method: "POST", body: JSON.stringify(payload) });
      const task = data?.data || data;
      const taskId = task?.task_id || task?.taskId;
      if (!taskId) throw new Error("MoneyPrinterTurbo did not return a task id");
      res.status(202).json({ ok: true, taskId, task });
    } catch (error) {
      res.status(502).json({ error: { code: "moneyprinter_generate_failed", message: error instanceof Error ? error.message : "MoneyPrinterTurbo generation failed" } });
    }
  });

  app.get("/api/publisher/moneyprinter/tasks/:taskId", async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    try {
      const data = await moneyPrinterRequest(`/api/v1/tasks/${encodeURIComponent(String(req.params.taskId))}`, { method: "GET" });
      res.json(data?.data || data);
    } catch (error) {
      res.status(502).json({ error: { code: "moneyprinter_task_failed", message: error instanceof Error ? error.message : "MoneyPrinterTurbo task lookup failed" } });
    }
  });

  app.post("/api/publisher/youtube/upload-from-url", async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    const row = db.prepare("SELECT * FROM youtube_connections WHERE session_id=?").get(sessionId);
    if (!row?.refresh_token_enc) return res.status(401).json({ error: { code: "youtube_not_connected", message: "Connect YouTube before publishing." } });

    const videoUrl = String(req.body?.videoUrl || "");
    if (!videoUrl) return res.status(400).json({ error: { code: "video_url_required", message: "videoUrl is required" } });

    const tempDir = join(process.cwd(), "data", "publisher-tmp");
    mkdirSync(tempDir, { recursive: true });
    const tempPath = join(tempDir, randomUUID() + ".mp4");

    try {
      await downloadVideo(req, videoUrl, tempPath);
      const client = oauthClient(req);
      client.setCredentials({ refresh_token: decryptToken(String(row.refresh_token_enc)) });
      const youtube = google.youtube({ version: "v3", auth: client });
      const title = String(req.body?.title || "AI Creative Studio").trim().slice(0, 100);
      const description = String(req.body?.description || "").slice(0, 5000);
      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 30)
        : [];
      const privacyStatus = ["public", "unlisted", "private"].includes(String(req.body?.privacyStatus))
        ? String(req.body.privacyStatus)
        : "private";

      const response = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title, description, tags },
          status: { privacyStatus, selfDeclaredMadeForKids: req.body?.madeForKids === true },
        },
        media: { body: createReadStream(tempPath) },
      });

      const videoId = response.data.id;
      if (!videoId) throw new Error("YouTube did not return a video ID");
      res.status(201).json({
        ok: true,
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        privacyStatus,
      });
    } catch (error) {
      res.status(502).json({ error: { code: "youtube_upload_failed", message: error instanceof Error ? error.message : "YouTube upload failed" } });
    } finally {
      try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch {}
    }
  });
}
