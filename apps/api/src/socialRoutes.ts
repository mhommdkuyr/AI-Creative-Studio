import crypto from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { open as openFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import express from "express";
import Database from "better-sqlite3";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

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

function getPublicBase(req: express.Request): string {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "");
  return `${proto}://${host}`;
}

function secretKey() {
  const value = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || "";
  if (!value) throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY is not configured");
  return crypto.createHash("sha256").update(value).digest();
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decrypt(value: string) {
  const [version, iv, tag, ciphertext] = String(value).split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted social token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function signState(sessionId: string, platform: string) {
  const payload = Buffer.from(JSON.stringify({ sessionId, platform, nonce: randomUUID(), issuedAt: Date.now() })).toString("base64url");
  const signature = crypto.createHmac("sha256", secretKey()).update(payload).digest("base64url");
  return payload + "." + signature;
}

function readState(state: string) {
  const [payload, signature] = String(state || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", secretKey()).update(payload).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.sessionId || !data.platform || Date.now() - Number(data.issuedAt) > 10 * 60 * 1000) return null;
    return { sessionId: String(data.sessionId), platform: String(data.platform) };
  } catch {
    return null;
  }
}

async function jsonResponse(response: Response) {
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || text.slice(0, 1000) || `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return data;
}

async function instagramRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${path}`, init);
  return jsonResponse(response);
}

async function materializeVideo(req: express.Request, rawUrl: string): Promise<{ publicUrl: string; filePath: string }> {
  const value = String(rawUrl || "").trim();
  if (!value) throw new Error("videoUrl is required");

  let target: URL;
  try {
    target = new URL(value, getPublicBase(req));
  } catch {
    throw new Error("Invalid videoUrl");
  }

  const ownHost = String(req.get("x-forwarded-host") || req.get("host") || "").split(":")[0];
  const mptBase = String(process.env.MONEYPRINTERTURBO_URL || "");
  const allowedHosts = new Set<string>();
  if (ownHost) allowedHosts.add(ownHost);
  if (mptBase) {
    try { allowedHosts.add(new URL(mptBase).hostname); } catch {}
  }
  if (!allowedHosts.has(target.hostname) || !["https:", "http:"].includes(target.protocol)) {
    throw new Error("videoUrl host is not allowed");
  }

  const mediaDir = join(resolve(process.cwd(), "../.."), "data", "media", "social");
  mkdirSync(mediaDir, { recursive: true });
  const filename = randomUUID() + ".mp4";
  const filePath = join(mediaDir, filename);

  const headers = new Headers();
  if (mptBase && process.env.MONEYPRINTERTURBO_API_KEY) {
    try {
      if (new URL(mptBase).hostname === target.hostname) {
        headers.set("x-api-key", String(process.env.MONEYPRINTERTURBO_API_KEY));
      }
    } catch {}
  }

  const response = await fetch(target, { headers, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Video download failed (${response.status})`);

  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));

  const publicUrl = getPublicBase(req) + "/media/social/" + filename;
  return { publicUrl, filePath };
}

async function getInstagramLongLivedToken(code: string, redirectUri: string) {
  const form = new URLSearchParams({
    client_id: String(process.env.INSTAGRAM_CLIENT_ID || ""),
    client_secret: String(process.env.INSTAGRAM_CLIENT_SECRET || ""),
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const short = await jsonResponse(await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  }));
  const long = await jsonResponse(await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(String(process.env.INSTAGRAM_CLIENT_SECRET || ""))}&access_token=${encodeURIComponent(String(short.access_token || ""))}`
  ));
  return {
    accessToken: String(long.access_token || short.access_token || ""),
    expiresAt: Date.now() + Number(long.expires_in || 60 * 24 * 3600) * 1000,
    userId: String(long.user_id || short.user_id || ""),
  };
}

async function refreshInstagramToken(token: string) {
  const data = await jsonResponse(await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
  ));
  return {
    accessToken: String(data.access_token || token),
    expiresAt: Date.now() + Number(data.expires_in || 60 * 24 * 3600) * 1000,
  };
}

async function refreshTikTokToken(refreshToken: string) {
  const form = new URLSearchParams({
    client_key: String(process.env.TIKTOK_CLIENT_KEY || ""),
    client_secret: String(process.env.TIKTOK_CLIENT_SECRET || ""),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return jsonResponse(await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  }));
}

function tiktokConfigured() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function instagramConfigured() {
  return Boolean(process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET);
}

function veoConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function ensureTikTokToken(db: Database.Database, sessionId: string) {
  const row = db.prepare("SELECT * FROM tiktok_connections WHERE session_id=?").get(sessionId) as any;
  if (!row?.access_token_enc) throw new Error("TikTok is not connected");
  if (Number(row.access_expires_at || 0) - Date.now() > 5 * 60 * 1000) {
    return { accessToken: decrypt(row.access_token_enc), row };
  }
  const refreshed = await refreshTikTokToken(decrypt(row.refresh_token_enc));
  db.prepare("UPDATE tiktok_connections SET access_token_enc=?, refresh_token_enc=?, access_expires_at=?, updated_at=? WHERE session_id=?")
    .run(encrypt(String(refreshed.access_token)), encrypt(String(refreshed.refresh_token || decrypt(row.refresh_token_enc))), Date.now() + Number(refreshed.expires_in || 86400) * 1000, new Date().toISOString(), sessionId);
  const fresh = db.prepare("SELECT * FROM tiktok_connections WHERE session_id=?").get(sessionId) as any;
  return { accessToken: String(refreshed.access_token), row: fresh };
}

export function registerSocialRoutes(app: express.Express, db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instagram_connections(
      session_id TEXT PRIMARY KEY,
      access_token_enc TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      expires_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tiktok_connections(
      session_id TEXT PRIMARY KEY,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      open_id TEXT,
      display_name TEXT,
      access_expires_at INTEGER,
      refresh_expires_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS veo_operations(
      operation_name TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      video_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  app.get("/api/social/status", (req, res) => {
    const sessionId = getSessionId(req);
    const ig = sessionId ? db.prepare("SELECT user_id, username, expires_at FROM instagram_connections WHERE session_id=?").get(sessionId) as any : null;
    const tt = sessionId ? db.prepare("SELECT open_id, display_name, access_expires_at, refresh_expires_at FROM tiktok_connections WHERE session_id=?").get(sessionId) as any : null;
    res.json({
      instagram: {
        configured: instagramConfigured(),
        connected: Boolean(ig?.access_token_enc || ig?.user_id),
        username: ig?.username || null,
        expiresAt: ig?.expires_at || null,
        redirectUri: process.env.INSTAGRAM_REDIRECT_URI || getPublicBase(req) + "/api/instagram/oauth/callback",
      },
      tiktok: {
        configured: tiktokConfigured(),
        connected: Boolean(tt?.open_id),
        displayName: tt?.display_name || null,
        accessExpiresAt: tt?.access_expires_at || null,
        refreshExpiresAt: tt?.refresh_expires_at || null,
        redirectUri: process.env.TIKTOK_REDIRECT_URI || getPublicBase(req) + "/api/tiktok/oauth/callback",
      },
      veo: {
        configured: veoConfigured(),
        model: process.env.GEMINI_VEO_MODEL || "veo-3.1-fast-generate-preview",
      },
    });
  });

  app.get("/api/instagram/oauth/start", (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    if (!instagramConfigured()) return res.status(503).json({ error: { code: "instagram_not_configured", message: "Configure Instagram Client ID and Secret first." } });
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || getPublicBase(req) + "/api/instagram/oauth/callback";
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", String(process.env.INSTAGRAM_CLIENT_ID));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
    url.searchParams.set("state", signState(sessionId, "instagram"));
    res.redirect(url.toString());
  });

  app.get("/api/instagram/oauth/callback", async (req, res) => {
    const state = readState(String(req.query.state || ""));
    const currentSession = getSessionId(req);
    if (!state || state.platform !== "instagram" || !currentSession || state.sessionId !== currentSession) {
      return res.status(400).send("Instagram OAuth state is invalid or expired.");
    }
    if (req.query.error) return res.status(400).send(`Instagram authorization failed: ${String(req.query.error_description || req.query.error)}`);

    try {
      const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || getPublicBase(req) + "/api/instagram/oauth/callback";
      const token = await getInstagramLongLivedToken(String(req.query.code || ""), redirectUri);
      if (!token.accessToken) throw new Error("Instagram did not return an access token");
      const profile = await instagramRequest("me?fields=id,username", { headers: { authorization: `Bearer ${token.accessToken}` } });
      const ts = new Date().toISOString();
      db.prepare(`
        INSERT INTO instagram_connections(session_id,access_token_enc,user_id,username,expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET
          access_token_enc=excluded.access_token_enc,
          user_id=excluded.user_id,
          username=excluded.username,
          expires_at=excluded.expires_at,
          updated_at=excluded.updated_at
      `).run(currentSession, encrypt(token.accessToken), String(profile?.id || token.userId || ""), String(profile?.username || ""), token.expiresAt, ts, ts);
      res.redirect("/?instagram=connected");
    } catch (error) {
      res.status(502).send(error instanceof Error ? error.message : "Instagram connection failed");
    }
  });

  app.delete("/api/instagram/connection", (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    db.prepare("DELETE FROM instagram_connections WHERE session_id=?").run(sessionId);
    res.json({ ok: true });
  });

  app.post("/api/instagram/publish-reel", async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    let materialized: { publicUrl: string; filePath: string } | null = null;
    try {
      const row = db.prepare("SELECT * FROM instagram_connections WHERE session_id=?").get(sessionId) as any;
      if (!row) return res.status(401).json({ error: { code: "instagram_not_connected", message: "Connect Instagram first." } });

      let token = decrypt(row.access_token_enc);
      if (Number(row.expires_at || 0) - Date.now() < 7 * 24 * 3600 * 1000) {
        const refreshed = await refreshInstagramToken(token);
        token = refreshed.accessToken;
        db.prepare("UPDATE instagram_connections SET access_token_enc=?, expires_at=?, updated_at=? WHERE session_id=?")
          .run(encrypt(token), refreshed.expiresAt, new Date().toISOString(), sessionId);
      }

      materialized = await materializeVideo(req, String(req.body?.videoUrl || ""));
      const response = await instagramRequest(`${row.user_id}/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: materialized.publicUrl,
          caption: String(req.body?.caption || req.body?.title || "").slice(0, 2200),
          share_to_feed: req.body?.shareToFeed !== false,
        }),
      });

      const creationId = String(response?.id || response?.creation_id || "");
      if (!creationId) throw new Error("Instagram did not return a media container id");

      let status: any = null;
      for (let i = 0; i < 60; i++) {
        status = await instagramRequest(`${creationId}?fields=status_code,status`, { headers: { authorization: `Bearer ${token}` } });
        if (String(status?.status_code || "").toUpperCase() === "FINISHED") break;
        if (String(status?.status_code || "").toUpperCase() === "ERROR") throw new Error(String(status?.status || "Instagram media processing failed"));
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      if (String(status?.status_code || "").toUpperCase() !== "FINISHED") throw new Error("Instagram media processing timed out");

      const published = await instagramRequest(`${row.user_id}/media_publish`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ creation_id: creationId }),
      });
      res.status(201).json({ ok: true, mediaId: String(published?.id || ""), username: row.username || null });
    } catch (error) {
      res.status(502).json({ error: { code: "instagram_publish_failed", message: error instanceof Error ? error.message : "Instagram publishing failed" } });
    } finally {
      if (materialized?.filePath) {
        try { if (existsSync(materialized.filePath)) unlinkSync(materialized.filePath); } catch {}
      }
    }
  });

  app.get("/api/tiktok/oauth/start", (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    if (!tiktokConfigured()) return res.status(503).json({ error: { code: "tiktok_not_configured", message: "Configure TikTok Client Key and Secret first." } });
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || getPublicBase(req) + "/api/tiktok/oauth/callback";
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", String(process.env.TIKTOK_CLIENT_KEY));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user.info.basic,video.publish");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", signState(sessionId, "tiktok"));
    res.redirect(url.toString());
  });

  app.get("/api/tiktok/oauth/callback", async (req, res) => {
    const state = readState(String(req.query.state || ""));
    const currentSession = getSessionId(req);
    if (!state || state.platform !== "tiktok" || !currentSession || state.sessionId !== currentSession) {
      return res.status(400).send("TikTok OAuth state is invalid or expired.");
    }
    if (req.query.error) return res.status(400).send(`TikTok authorization failed: ${String(req.query.error_description || req.query.error)}`);

    try {
      const redirectUri = process.env.TIKTOK_REDIRECT_URI || getPublicBase(req) + "/api/tiktok/oauth/callback";
      const form = new URLSearchParams({
        client_key: String(process.env.TIKTOK_CLIENT_KEY || ""),
        client_secret: String(process.env.TIKTOK_CLIENT_SECRET || ""),
        code: String(req.query.code || ""),
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });
      const token = await jsonResponse(await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      }));
      const accessToken = String(token?.access_token || "");
      const refreshToken = String(token?.refresh_token || "");
      if (!accessToken || !refreshToken) throw new Error("TikTok did not return usable tokens");

      const profile = await jsonResponse(await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
        headers: { authorization: `Bearer ${accessToken}` },
      }));
      const user = profile?.data?.user || {};
      const ts = new Date().toISOString();
      db.prepare(`
        INSERT INTO tiktok_connections(session_id,access_token_enc,refresh_token_enc,open_id,display_name,access_expires_at,refresh_expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET
          access_token_enc=excluded.access_token_enc,
          refresh_token_enc=excluded.refresh_token_enc,
          open_id=excluded.open_id,
          display_name=excluded.display_name,
          access_expires_at=excluded.access_expires_at,
          refresh_expires_at=excluded.refresh_expires_at,
          updated_at=excluded.updated_at
      `).run(currentSession, encrypt(accessToken), encrypt(refreshToken), String(user.open_id || token.open_id || ""), String(user.display_name || ""), Date.now() + Number(token.expires_in || 86400) * 1000, Date.now() + Number(token.refresh_expires_in || 365 * 86400) * 1000, ts, ts);
      res.redirect("/?tiktok=connected");
    } catch (error) {
      res.status(502).send(error instanceof Error ? error.message : "TikTok connection failed");
    }
  });

  app.delete("/api/tiktok/connection", (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    db.prepare("DELETE FROM tiktok_connections WHERE session_id=?").run(sessionId);
    res.json({ ok: true });
  });

  app.post("/api/tiktok/publish", async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    let materialized: { publicUrl: string; filePath: string } | null = null;
    try {
      const { accessToken, row } = await ensureTikTokToken(db, sessionId);
      materialized = await materializeVideo(req, String(req.body?.videoUrl || ""));

      const creator = await jsonResponse(await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({}),
      }));
      const options = Array.isArray(creator?.data?.privacy_level_options) ? creator.data.privacy_level_options : [];
      const requestedPrivacy = String(req.body?.privacyLevel || "SELF_ONLY");
      const privacyLevel = options.includes(requestedPrivacy) ? requestedPrivacy : String(options[0] || "SELF_ONLY");

      const stat = statSync(materialized.filePath);
      const init = await jsonResponse(await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          post_info: {
            title: String(req.body?.caption || req.body?.title || "").slice(0, 2200),
            privacy_level: privacyLevel,
            disable_duet: Boolean(req.body?.disableDuet),
            disable_comment: Boolean(req.body?.disableComment),
            disable_stitch: Boolean(req.body?.disableStitch),
            is_aigc: req.body?.isAigc !== false,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: stat.size,
            chunk_size: Math.min(10 * 1024 * 1024, stat.size),
            total_chunk_count: Math.ceil(stat.size / Math.min(10 * 1024 * 1024, stat.size)),
          },
        }),
      }));

      const uploadUrl = String(init?.data?.upload_url || "");
      const publishId = String(init?.data?.publish_id || "");
      if (!uploadUrl || !publishId) throw new Error("TikTok did not return an upload session");

      const chunkSize = Math.min(10 * 1024 * 1024, stat.size);
      const fileHandle = await openFile(materialized.filePath, "r");
      const buffer = Buffer.allocUnsafe(chunkSize);
      try {
        for (let start = 0; start < stat.size;) {
          const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, start);
          if (!bytesRead) break;
          const end = start + bytesRead - 1;
          const chunk = buffer.subarray(0, bytesRead);
          const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "content-type": "video/mp4",
              "content-length": String(chunk.length),
              "content-range": `bytes ${start}-${end}/${stat.size}`,
            },
            body: chunk,
          });
          if (!uploadResponse.ok) throw new Error(`TikTok upload failed (${uploadResponse.status})`);
          start += bytesRead;
        }
      } finally {
        await fileHandle.close();
      }

      let publishStatus: any = null;
      for (let i = 0; i < 24; i++) {
        publishStatus = await jsonResponse(await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify({ publish_id: publishId }),
        }));
        const status = String(publishStatus?.data?.status || "").toUpperCase();
        if (status && !["PROCESSING", "PUBLISH_IN_PROGRESS"].includes(status)) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      res.status(201).json({
        ok: true,
        publishId,
        status: publishStatus?.data?.status || "PROCESSING",
        displayName: row.display_name || null,
        audited: false,
        note: "TikTok unaudited clients are restricted to private viewing until audit approval.",
      });
    } catch (error) {
      res.status(502).json({ error: { code: "tiktok_publish_failed", message: error instanceof Error ? error.message : "TikTok publishing failed" } });
    } finally {
      if (materialized?.filePath) {
        try { if (existsSync(materialized.filePath)) unlinkSync(materialized.filePath); } catch {}
      }
    }
  });

  app.post("/api/publisher/veo/start", async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    if (!veoConfigured()) return res.status(503).json({ error: { code: "veo_not_configured", message: "Add GEMINI_API_KEY on Render first." } });
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: { code: "veo_prompt_required", message: "prompt is required" } });

    const model = process.env.GEMINI_VEO_MODEL || "veo-3.1-fast-generate-preview";
    const response = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": String(process.env.GEMINI_API_KEY), "content-type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: prompt.slice(0, 1024) }],
        parameters: {
          aspectRatio: ["9:16", "16:9"].includes(String(req.body?.aspectRatio)) ? String(req.body.aspectRatio) : "9:16",
          resolution: ["720p", "1080p", "4k"].includes(String(req.body?.resolution)) ? String(req.body.resolution) : "720p",
          numberOfVideos: 1,
        },
      }),
    });
    const data = await jsonResponse(response);
    const operationName = String(data?.name || "");
    if (!operationName) return res.status(502).json({ error: { code: "veo_operation_missing", message: "Veo did not return an operation name." } });
    db.prepare("INSERT OR REPLACE INTO veo_operations(operation_name,session_id,video_url,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(operationName, sessionId, null, new Date().toISOString(), new Date().toISOString());
    res.status(202).json({ ok: true, operationName, model });
  });

  app.get("/api/publisher/veo/operation", async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    if (!veoConfigured()) return res.status(503).json({ error: { code: "veo_not_configured", message: "Add GEMINI_API_KEY on Render first." } });

    const operationName = String(req.query.name || "");
    const row = db.prepare("SELECT * FROM veo_operations WHERE operation_name=? AND session_id=?").get(operationName, sessionId) as any;
    if (!row) return res.status(404).json({ error: { code: "veo_operation_not_found", message: "Veo operation not found." } });

    const response = await fetch(`${GEMINI_BASE}/${operationName}`, {
      headers: { "x-goog-api-key": String(process.env.GEMINI_API_KEY) },
    });
    const data = await jsonResponse(response);
    if (!data?.done) return res.json({ done: false, operationName });

    if (row.video_url) return res.json({ done: true, operationName, videoUrl: row.video_url });

    const uri = String(data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || "");
    if (!uri) {
      const errorMessage = data?.error?.message || "Veo completed without a video URI.";
      return res.status(502).json({ error: { code: "veo_video_missing", message: String(errorMessage) } });
    }

    const mediaDir = join(resolve(process.cwd(), "../.."), "data", "media", "veo");
    mkdirSync(mediaDir, { recursive: true });
    const filename = randomUUID() + ".mp4";
    const filePath = join(mediaDir, filename);
    const videoResponse = await fetch(uri, { headers: { "x-goog-api-key": String(process.env.GEMINI_API_KEY) } });
    if (!videoResponse.ok || !videoResponse.body) throw new Error(`Veo video download failed (${videoResponse.status})`);
    const fs = await import("node:fs");
    const writer = fs.createWriteStream(filePath);
    const reader = videoResponse.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        writer.write(part.value);
      }
    } finally {
      writer.end();
    }

    const publicUrl = getPublicBase(req) + "/media/veo/" + filename;
    db.prepare("UPDATE veo_operations SET video_url=?, updated_at=? WHERE operation_name=?").run(publicUrl, new Date().toISOString(), operationName);
    return res.json({ done: true, operationName, videoUrl: publicUrl });
  });
}
