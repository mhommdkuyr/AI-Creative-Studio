# MoneyPrinterTurbo + YouTube publishing

This replaces the n8n dependency with a direct server-side integration.

## Flow

Studio UI -> Express API -> MoneyPrinterTurbo API -> generated MP4 -> YouTube OAuth 2.0 -> YouTube Data API v3.

## Render variables

Required for the full flow:
- MONEYPRINTERTURBO_URL
- MONEYPRINTERTURBO_API_KEY (when MPT API authentication is enabled)
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_YOUTUBE_REDIRECT_URI
- YOUTUBE_OAUTH_STATE_SECRET
- YOUTUBE_TOKEN_ENCRYPTION_KEY

## Current Google OAuth redirect URI

https://ai-creative-studio-renderer-v2.onrender.com/api/youtube/oauth/callback

Google requires the OAuth redirect URI to exactly match the URI configured in the OAuth client, and web applications must use HTTPS except localhost.
