import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

export interface GoogleDriveImportInput {
  fileId: string;
  name?: string;
  downloadUrl?: string;
}

export interface ProbedMedia {
  duration: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  mime: string;
  size: number;
}

export class GoogleDriveImportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'GoogleDriveImportError';
  }
}

function maxBytes() {
  const configured = Number(process.env.GOOGLE_DRIVE_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

function timeoutMs() {
  const configured = Number(process.env.GOOGLE_DRIVE_DOWNLOAD_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function safeExtension(name: string) {
  const extension = extname(name).toLowerCase();
  return VIDEO_EXTENSIONS.has(extension) ? extension : '.mp4';
}

function safeName(name: string | undefined, fileId: string) {
  const raw = (name || `drive-${fileId}.mp4`).trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  return cleaned || `drive-${fileId}.mp4`;
}

function isAllowedSourceHost(hostname: string) {
  const configured = String(process.env.GOOGLE_DRIVE_IMPORT_ALLOWED_HOSTS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const defaults = ['www.googleapis.com', 'googleapis.com', 'r2.cloudflarestorage.com'];
  const allowed = new Set([...defaults, ...configured]);
  const normalized = hostname.toLowerCase();
  if (allowed.has(normalized)) return true;
  for (const suffix of allowed) {
    if (normalized.endsWith(`.${suffix}`)) return true;
  }
  if (process.env.NODE_ENV === 'test' && (normalized === '127.0.0.1' || normalized === 'localhost')) return true;
  return false;
}

function resolveDownloadTarget(input: GoogleDriveImportInput): { url: string; headers: Record<string, string> } {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.fileId)) {
    throw new GoogleDriveImportError('Invalid Google Drive file ID', 'invalid_file_id', 400);
  }

  if (input.downloadUrl) {
    let url: URL;
    try {
      url = new URL(input.downloadUrl);
    } catch {
      throw new GoogleDriveImportError('Invalid Google Drive download URL', 'invalid_download_url', 400);
    }
    const httpAllowed = process.env.NODE_ENV === 'test' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (url.protocol !== 'https:' && !httpAllowed) {
      throw new GoogleDriveImportError('Download URL must use HTTPS', 'invalid_download_url', 400);
    }
    if (!isAllowedSourceHost(url.hostname)) {
      throw new GoogleDriveImportError('Download host is not an approved media source', 'download_host_not_allowed', 403);
    }
    return { url: url.toString(), headers: {} };
  }

  const token = String(process.env.GOOGLE_DRIVE_ACCESS_TOKEN || '').trim();
  if (!token) {
    throw new GoogleDriveImportError(
      'No direct Google Drive credential is configured; provide an authorized temporary download URL',
      'google_drive_credentials_unavailable',
      424,
    );
  }

  return {
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media&supportsAllDrives=true`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

function validateResponseContentType(response: Response, extension: string) {
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const acceptable = contentType.startsWith('video/') || (contentType === 'application/octet-stream' && VIDEO_EXTENSIONS.has(extension));
  if (!acceptable) {
    throw new GoogleDriveImportError(
      `Downloaded content is not a video (content-type: ${contentType || 'missing'})`,
      'invalid_video_content_type',
      415,
    );
  }
  return contentType || `video/${extension.replace('.', '')}`;
}

export function probeMedia(path: string, mime = 'video/mp4'): ProbedMedia {
  let metadata: any;
  try {
    metadata = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
        { encoding: 'utf8', timeout: 30_000 },
      ),
    );
  } catch (error) {
    throw new GoogleDriveImportError(
      `FFprobe could not read the downloaded media: ${error instanceof Error ? error.message : 'invalid media'}`,
      'ffprobe_failed',
      422,
    );
  }

  const video = Array.isArray(metadata.streams) ? metadata.streams.find((stream: any) => stream.codec_type === 'video') : null;
  const audio = Array.isArray(metadata.streams) ? metadata.streams.find((stream: any) => stream.codec_type === 'audio') : null;
  const duration = Number(metadata.format?.duration || video?.duration || 0);
  const width = Number(video?.width || 0);
  const height = Number(video?.height || 0);
  if (!video || !Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0) {
    throw new GoogleDriveImportError('Downloaded file is not a valid playable video', 'invalid_video_file', 422);
  }

  const size = Number(metadata.format?.size || stat(path).then?.length || 0);
  return {
    duration,
    width,
    height,
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    mime,
    size: Number.isFinite(size) ? size : 0,
  };
}

export async function downloadGoogleDriveMedia(input: GoogleDriveImportInput, mediaDirectory: string): Promise<ProbedMedia & { fileId: string; name: string; path: string }> {
  const { url, headers } = resolveDownloadTarget(input);
  await mkdir(mediaDirectory, { recursive: true });

  const name = safeName(input.name, input.fileId);
  const extension = safeExtension(name);
  const filename = `${randomUUID()}${extension}`;
  const destination = join(mediaDirectory, filename);
  const limit = maxBytes();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GoogleDriveImportError(
        `Google Drive download failed with HTTP ${response.status}`,
        'google_drive_download_failed',
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }

    const mime = validateResponseContentType(response, extension);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > limit) {
      throw new GoogleDriveImportError(
        `Downloaded file exceeds the configured size limit of ${limit} bytes`,
        'download_too_large',
        413,
      );
    }
    if (!response.body) {
      throw new GoogleDriveImportError('Google Drive returned an empty response body', 'empty_download', 502);
    }

    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > limit) {
          callback(new GoogleDriveImportError(`Downloaded file exceeds the configured size limit of ${limit} bytes`, 'download_too_large', 413));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as any),
      limiter,
      createWriteStream(destination, { flags: 'wx' }),
    );

    const probed = probeMedia(destination, mime);
    const actualSize = Number((await stat(destination)).size);
    return {
      ...probed,
      size: actualSize,
      fileId: input.fileId,
      name,
      path: destination,
    };
  } catch (error) {
    try {
      await unlink(destination);
    } catch {}
    if (error instanceof GoogleDriveImportError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GoogleDriveImportError('Google Drive download timed out', 'download_timeout', 504);
    }
    throw new GoogleDriveImportError(
      error instanceof Error ? error.message : 'Google Drive download failed',
      'google_drive_download_failed',
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
