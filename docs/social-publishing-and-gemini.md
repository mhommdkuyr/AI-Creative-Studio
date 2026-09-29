# Social publishing and Gemini/Veo

## OAuth callback URLs

- Instagram:
  https://ai-creative-studio-renderer-v2.onrender.com/api/instagram/oauth/callback
- TikTok:
  https://ai-creative-studio-renderer-v2.onrender.com/api/tiktok/oauth/callback
- YouTube:
  https://ai-creative-studio-renderer-v2.onrender.com/api/youtube/oauth/callback

## Render variables

Set these on the AI Creative Studio Render service:

- `INSTAGRAM_CLIENT_ID`
- `INSTAGRAM_CLIENT_SECRET`
- `INSTAGRAM_REDIRECT_URI`
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI`
- `SOCIAL_TOKEN_ENCRYPTION_KEY`
- `GEMINI_API_KEY`
- `GEMINI_VEO_MODEL=veo-3.1-fast-generate-preview`

Do not commit these values to Git.

## Instagram

The implementation uses Instagram Login with the professional-account scopes:
`instagram_business_basic` and `instagram_business_content_publish`.

The Reel publishing path creates a media container, waits for processing, then calls `media_publish`.

## TikTok

The implementation uses Login Kit + Content Posting API with `video.publish`. Direct posting uses FILE_UPLOAD and then polls publish status. TikTok documents that unaudited clients are restricted to private visibility until the app is audited.

## Gemini / Veo

The project calls the Gemini API server-side. A Gemini consumer subscription does not itself reveal an API key; create an API authentication key in Google AI Studio and put it in `GEMINI_API_KEY`.

The current Veo route uses the REST long-running generation API and stores the completed MP4 in the studio media area.

## Free/low-cost strategy

- Use Gemini 3.1 Flash-Lite for scripts, captions and metadata when the free tier is available.
- Use MoneyPrinterTurbo + free stock sources (Pexels/Pixabay/Coverr) for low-cost assembly.
- Use Veo only for clips that need generative video; Veo API usage is paid rather than free-tier video generation.
- Truly free generative video requires self-hosted/open models on a GPU host; Render Free CPU is not an appropriate runtime for those workloads.
