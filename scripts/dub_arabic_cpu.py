#!/usr/bin/env python3
"""Checkpointable CPU Arabic dubbing draft.

Current honest capability boundary:
- faster-whisper ASR with segment-level timestamps
- per-segment Arabic translation with bounded retries
- one configurable Arabic Edge TTS voice for the whole chunk
- speech placed at detected segment start times
- per-input/per-segment checkpoints that are safe to reuse only when hashes/config match

This does NOT implement speaker diarization, reliable emotion transfer, music separation,
or visual lip-sync. It deliberately fails on translation/TTS errors instead of silently
substituting the source language and labeling the result Arabic.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 3


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def run(cmd: list[str], *, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=timeout,
        )
    except subprocess.CalledProcessError as exc:
        tail = (exc.stderr or exc.stdout or "")[-1800:]
        raise RuntimeError(f"Command failed ({cmd[0]}), exit={exc.returncode}: {tail}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Command timed out after {timeout}s: {cmd[0]}") from exc


def media_duration(path: Path) -> float:
    result = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], timeout=30)
    try:
        value = float(result.stdout.strip())
    except (ValueError, TypeError) as exc:
        raise RuntimeError(f"ffprobe returned an invalid duration for {path.name}") from exc
    if value <= 0:
        raise RuntimeError(f"Non-positive duration for {path.name}: {value}")
    return value


def create_translator(backend: str, source_language: str):
    """Create a dependable local Argos translator, or an explicitly requested remote Google translator.

    Argos will use a direct language-to-Arabic package where available, otherwise it will
    install source-to-English and English-to-Arabic packages so Argos can compose a pivot.
    No failed translation is silently replaced with source-language text.
    """
    if backend == "google":
        from deep_translator import GoogleTranslator
        return GoogleTranslator(source="auto", target="ar"), "GoogleTranslator (remote)"

    import argostranslate.package as argos_package
    import argostranslate.translate as argos_translate

    language = str(source_language or "").strip().lower()
    aliases = {"iw": "he", "jp": "ja", "kr": "ko", "zh-cn": "zh", "zh-tw": "zt"}
    language = aliases.get(language, language)
    if not language:
        raise RuntimeError("ASR did not identify the source language; cannot select an offline translation model.")
    if language == "ar":
        class SameLanguage:
            def translate(self, text: str) -> str:
                return text
        return SameLanguage(), "source-already-Arabic"

    try:
        argos_package.update_package_index()
        available = argos_package.get_available_packages()
    except Exception as exc:
        raise RuntimeError(f"Could not retrieve the Argos translation model index ({type(exc).__name__}).") from exc

    def installed_pair(src: str, dst: str) -> bool:
        try:
            return any(p.from_code == src and p.to_code == dst for p in argos_package.get_installed_packages())
        except Exception:
            return False

    def ensure_pair(src: str, dst: str) -> bool:
        if installed_pair(src, dst):
            return True
        candidate = next((p for p in available if p.from_code == src and p.to_code == dst), None)
        if candidate is None:
            return False
        try:
            print(f"Installing offline Argos model {src}->{dst} (version {candidate.package_version})", flush=True)
            candidate.install()
            return installed_pair(src, dst)
        except Exception as exc:
            raise RuntimeError(f"Failed to install Argos model {src}->{dst} ({type(exc).__name__}).") from exc

    direct = ensure_pair(language, "ar")
    if not direct and language != "en":
        first = ensure_pair(language, "en")
        second = ensure_pair("en", "ar")
        if not (first and second):
            raise RuntimeError(
                f"No installed direct or English-pivot Argos route from {language} to Arabic. "
                "Choose an authorized source language supported by available open translation models."
            )
    elif not direct and language == "en":
        raise RuntimeError("Argos English-to-Arabic model is unavailable and could not be installed.")

    try:
        translation = argos_translate.get_translation_from_codes(language, "ar")
    except Exception as exc:
        raise RuntimeError(f"Argos could not build a translation route from {language} to Arabic ({type(exc).__name__}).") from exc
    print(f"Offline translation route ready: {language}->ar", flush=True)
    return translation, f"Argos offline ({language}->ar)"


def translate_with_retry(translator, text: str, retries: int) -> str:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            translated = translator.translate(text)
            if not isinstance(translated, str) or not translated.strip():
                raise RuntimeError("translator returned an empty result")
            return re.sub(r"\s+", " ", translated).strip()
        except Exception as exc:
            last_error = exc
            if attempt + 1 < retries:
                delay = min(20, 2 ** attempt)
                print(f"translation retry {attempt + 1}/{retries - 1} after error: {type(exc).__name__}", flush=True)
                time.sleep(delay)
    raise RuntimeError(
        f"Arabic translation failed after {retries} attempts; segment was not replaced with source text. "
        f"Last error: {type(last_error).__name__ if last_error else 'unknown'}"
    ) from last_error


async def synthesize_once(text: str, voice: str, rate: str, mp3_path: Path) -> None:
    import edge_tts
    await edge_tts.Communicate(text, voice, rate=rate).save(str(mp3_path))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="small")
    p.add_argument("--voice", default="ar-SA-HamedNeural")
    p.add_argument("--translation-backend", choices=["argos", "google"], default="argos",
                   help="Use offline Argos by default; GoogleTranslator is remote and may rate-limit.")
    p.add_argument("--translation-retries", type=int, default=4)
    p.add_argument("--tts-retries", type=int, default=3)
    p.add_argument("--max-rate", type=float, default=1.35,
                   help="Maximum atempo speed-up when an utterance exceeds its detected window (1.0-1.5).")
    a = p.parse_args()
    if not (1.0 <= a.max_rate <= 1.5):
        raise SystemExit("--max-rate must be between 1.0 and 1.5")
    if a.translation_retries < 1 or a.translation_retries > 6:
        raise SystemExit("--translation-retries must be between 1 and 6")
    if a.tts_retries < 1 or a.tts_retries > 5:
        raise SystemExit("--tts-retries must be between 1 and 5")

    audio = Path(a.audio).resolve()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    checkpoints = out / "checkpoints"
    checkpoints.mkdir(parents=True, exist_ok=True)
    if not audio.is_file() or audio.stat().st_size < 1000:
        raise SystemExit(f"Input audio missing or implausibly small: {audio}")
    audio_sha = sha256_file(audio)
    audio_duration = media_duration(audio)
    transcript_path = out / "transcript_source.json"
    transcription = load_json(transcript_path)
    reusable_transcript = (
        isinstance(transcription, dict)
        and transcription.get("schema") == SCHEMA_VERSION
        and transcription.get("audio_sha256") == audio_sha
        and transcription.get("model") == a.model
        and isinstance(transcription.get("segments"), list)
        and transcription["segments"]
    )

    from faster_whisper import WhisperModel

    if reusable_transcript:
        segments = transcription["segments"]
        detected_language = str(transcription.get("language") or "unknown")
        print(f"Reusing ASR checkpoint: {len(segments)} segments; audio_sha256={audio_sha}", flush=True)
    else:
        model = WhisperModel(a.model, device="cpu", compute_type="int8")
        detected, info = model.transcribe(
            str(audio), beam_size=1, vad_filter=True, word_timestamps=False
        )
        segments = []
        for item in detected:
            text = item.text.strip()
            if text:
                segments.append({
                    "index": len(segments),
                    "start": float(item.start),
                    "end": float(item.end),
                    "source": text,
                })
        if not segments:
            raise RuntimeError("ASR returned no speech segments; stopping without a dubbed file.")
        detected_language = str(info.language or "unknown")
        transcription = {
            "schema": SCHEMA_VERSION, "audio_sha256": audio_sha,
            "audio_duration_seconds": audio_duration, "model": a.model,
            "language": detected_language, "segments": segments,
        }
        atomic_json(transcript_path, transcription)
        print(f"ASR complete: {len(segments)} segments; language={detected_language}", flush=True)

    translator, translation_backend = create_translator(a.translation_backend, detected_language)
    voiced: list[dict[str, Any]] = []
    transcript_ar: list[dict[str, Any]] = []
    checkpoint_stats = {"translation_reused": 0, "tts_reused": 0, "translation_created": 0, "tts_created": 0}
    for pos, seg in enumerate(segments):
        idx = int(seg.get("index", pos))
        start = max(0.0, float(seg["start"]))
        end = min(audio_duration, max(start + 0.05, float(seg["end"])))
        source_text = re.sub(r"\s+", " ", str(seg.get("source", ""))).strip()
        if not source_text:
            continue
        checkpoint_path = checkpoints / f"segment_{idx:05d}.json"
        line_wav = checkpoints / f"segment_{idx:05d}.wav"
        state = load_json(checkpoint_path)
        matches = (
            isinstance(state, dict)
            and state.get("schema") == SCHEMA_VERSION
            and state.get("audio_sha256") == audio_sha
            and state.get("model") == a.model
            and state.get("voice") == a.voice
            and state.get("translation_backend") == a.translation_backend
            and float(state.get("max_rate", -1)) == float(a.max_rate)
            and state.get("source") == source_text
            and abs(float(state.get("start", -99)) - start) < 0.02
            and abs(float(state.get("end", -99)) - end) < 0.02
        )
        translated = state.get("arabic") if matches and isinstance(state.get("arabic"), str) else None
        if translated:
            checkpoint_stats["translation_reused"] += 1
        else:
            translated = translate_with_retry(translator, source_text, a.translation_retries)
            if not translated:
                raise RuntimeError(f"Empty Arabic translation for segment {idx}")
            state = {
                "schema": SCHEMA_VERSION, "audio_sha256": audio_sha,
                "model": a.model, "voice": a.voice,
                "translation_backend": a.translation_backend, "max_rate": a.max_rate, "index": idx,
                "start": start, "end": end, "source": source_text,
                "arabic": translated, "translation_status": "complete",
                "tts_status": "pending",
            }
            atomic_json(checkpoint_path, state)
            checkpoint_stats["translation_created"] += 1

        tts_reused = (
            matches and state.get("tts_status") == "complete"
            and line_wav.is_file() and line_wav.stat().st_size > 1000
            and state.get("tts_sha256") == sha256_file(line_wav)
        )
        if tts_reused:
            checkpoint_stats["tts_reused"] += 1
        else:
            mp3_path = checkpoints / f"segment_{idx:05d}.mp3"
            last_error: Exception | None = None
            for attempt in range(a.tts_retries):
                try:
                    asyncio.run(synthesize_once(translated, a.voice, "+0%", mp3_path))
                    if not mp3_path.is_file() or mp3_path.stat().st_size < 100:
                        raise RuntimeError("TTS returned an empty audio file")
                    break
                except Exception as exc:
                    last_error = exc
                    mp3_path.unlink(missing_ok=True)
                    if attempt + 1 < a.tts_retries:
                        time.sleep(min(20, 2 ** attempt))
            else:
                raise RuntimeError(f"TTS failed for segment {idx} after {a.tts_retries} attempts: {type(last_error).__name__}") from last_error

            # Fit the generated utterance toward the segment window without excessive speeding.
            next_start = float(segments[pos + 1]["start"]) if pos + 1 < len(segments) else audio_duration
            available = max(0.25, min(end, next_start, audio_duration) - start)
            generated_duration = media_duration(mp3_path)
            tempo = min(a.max_rate, max(1.0, generated_duration / available))
            tempo_filter = f"atempo={tempo:.4f}" if tempo > 1.0001 else "anull"
            run([
                "ffmpeg", "-y", "-v", "error", "-i", str(mp3_path),
                "-af", tempo_filter, "-ac", "1", "-ar", "24000",
                "-c:a", "pcm_s16le", str(line_wav),
            ], timeout=120)
            mp3_path.unlink(missing_ok=True)
            if not line_wav.is_file() or line_wav.stat().st_size < 1000:
                raise RuntimeError(f"TTS conversion produced an invalid WAV for segment {idx}")
            state = {
                "schema": SCHEMA_VERSION, "audio_sha256": audio_sha,
                "model": a.model, "voice": a.voice,
                "translation_backend": a.translation_backend, "max_rate": a.max_rate, "index": idx,
                "start": start, "end": end, "source": source_text,
                "arabic": translated, "translation_status": "complete",
                "tts_status": "complete", "tts_sha256": sha256_file(line_wav),
                "generated_duration_seconds": generated_duration,
                "atempo": tempo, "available_window_seconds": available,
            }
            atomic_json(checkpoint_path, state)
            checkpoint_stats["tts_created"] += 1

        current_state = load_json(checkpoint_path) or state
        transcript_ar.append({
            "index": idx, "start": start, "end": end, "source": source_text,
            "arabic": translated, "voice": a.voice,
            "tts_checkpoint": str(line_wav.relative_to(out)),
            "atempo": current_state.get("atempo", 1.0),
        })
        voiced.append({"index": idx, "start": start, "wav": line_wav})
        atomic_json(out / "transcript_ar.json", {
            "schema": SCHEMA_VERSION, "audio_sha256": audio_sha,
            "target_language": "ar", "segments": transcript_ar,
        })
        print(f"Segment {idx + 1}/{len(segments)} checkpointed", flush=True)

    if not voiced:
        raise RuntimeError("No translated/TTS segments were produced.")

    mix_file = out / "dub_ar.wav"
    inputs: list[str] = []
    filters: list[str] = []
    for i, record in enumerate(voiced):
        inputs.extend(["-i", str(record["wav"])])
        delay = max(0, int(float(record["start"]) * 1000))
        filters.append(f"[{i}:a]adelay={delay}|{delay},volume=0.90[a{i}]")
    labels = "".join(f"[a{i}]" for i in range(len(voiced)))
    filter_complex = ";".join(filters) + f";{labels}amix=inputs={len(voiced)}:duration=longest:normalize=0,alimiter=limit=0.95[out]"
    mix_cmd = ["ffmpeg", "-y", "-v", "error"] + inputs + [
        "-filter_complex", filter_complex, "-map", "[out]",
        "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(mix_file),
    ]
    run(mix_cmd, timeout=300)
    if not mix_file.is_file() or mix_file.stat().st_size < 1000:
        raise RuntimeError("Mixed Arabic WAV failed validation.")

    manifest = {
        "schema": SCHEMA_VERSION, "status": "audio_draft_created",
        "audio_sha256": audio_sha, "audio_duration_seconds": audio_duration,
        "translation_backend": translation_backend,
        "detected_source_language": detected_language, "segments": len(voiced),
        "model": a.model, "voice": a.voice, "target_language": "ar",
        "checkpoint_stats": checkpoint_stats,
        "limitations": [
            "single TTS voice for the entire chunk",
            "no speaker diarization",
            "no controllable emotion transfer",
            "no source-music/background separation; output is replacement dialogue audio",
            "no visual lip sync",
            "segment-start alignment only; limited atempo fitting, not word-level sync",
        ],
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    atomic_json(out / "draft_manifest.json", manifest)
    print(
        f"Draft created: {mix_file}; segments={len(voiced)}; language={detected_language}; "
        f"translation reused/new={checkpoint_stats['translation_reused']}/{checkpoint_stats['translation_created']}; "
        f"TTS reused/new={checkpoint_stats['tts_reused']}/{checkpoint_stats['tts_created']}",
        flush=True,
    )


if __name__ == "__main__":
    main()
