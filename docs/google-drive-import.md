# Google Drive media import

The editor now supports a real server-side Google Drive media import path.

## API

POST /api/media/google-drive

Accepts JSON with fileId, optional name, and optional downloadUrl. The server downloads the binary video into data/media and does not return the temporary signed URL.

POST /api/projects/:id/import/google-drive

Uses the same downloader, probes the downloaded media with FFprobe, creates a real asset, inserts a real timeline clip, and returns the project plus importedMedia metadata.

## Direct Drive API mode

Set GOOGLE_DRIVE_ACCESS_TOKEN in the server environment to let the server fetch Google Drive media directly by fileId. The browser never receives this token.

For temporary signed URLs, approved hosts include Google APIs and Cloudflare R2 by default. Add more hosts with GOOGLE_DRIVE_IMPORT_ALLOWED_HOSTS.

## Runtime behavior

1. Validate the Drive file ID and source URL.
2. Stream the binary response directly to disk with a configurable maximum size.
3. Apply a download timeout and remove partial files on failure.
4. Validate video content type and use FFprobe to verify a playable video and extract duration, dimensions, and codecs.
5. Store the local file as a project asset so the existing FFmpeg renderer consumes the downloaded file, not a remote URL.

Optional settings:
GOOGLE_DRIVE_MAX_BYTES (default 1 GiB)
GOOGLE_DRIVE_DOWNLOAD_TIMEOUT_MS (default 120000 ms)
GOOGLE_DRIVE_IMPORT_ALLOWED_HOSTS (comma-separated additional hosts)