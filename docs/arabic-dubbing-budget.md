# Budget-limited Arabic dubbing draft

This repository workflow is an initial CPU-only draft pipeline. It is **not** a Netflix-quality mastering workflow and does not implement speaker diarization, per-speaker voice matching, emotional acting, music/source separation, or visual lip-sync. It creates a timed Arabic TTS track and an MP4 draft.

## Run it
1. Open **Actions → Arabic Dubbing (budget-capped CPU)**.
2. Choose **Run workflow**.
3. Keep `max_minutes` at or below 45. The workflow uses CPU only and calls no paid model API.
4. Download the short-lived `arabic-dubbing-draft` artifact from the run page.

## Budget and limits
- GitHub Actions minutes/quota may apply. This workflow enforces a runtime limit but cannot measure or guarantee your account's USD-equivalent charges.
- The 2h 8m source is unlikely to finish transcription and TTS within a 45-minute CPU cap. If the job times out, it must be split into short segments and resumed; no final full-episode file should be claimed.
- This workflow does not upload to Google Drive because no Drive OAuth/service-account secret is configured in this repository. Do not add credentials to source code. Configure a least-privilege GitHub Actions secret only if you want Drive upload.
- The TTS voice is one Arabic voice for all speakers. Review Arabic translation and pronunciation manually.
