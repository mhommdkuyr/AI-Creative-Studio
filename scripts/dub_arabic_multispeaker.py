#!/usr/bin/env python3
"""Resumable Arabic dubbing with global speaker clustering and expressive synthetic voices.

Uses:
- faster-whisper for source transcription and timestamps
- SpeechBrain ECAPA embeddings + agglomerative clustering for speaker turns
- Argos Translate by default
- Audar-TTS-V1-Flash (GGUF) with six publisher-provided synthetic voice profiles
- FFmpeg for time fitting, mixing, muxing and verification

The six Audar profiles are synthetic and do not clone the actors in the source video.
Speaker gender/presentation is a low-confidence acoustic heuristic, not a demographic fact.
The Flash model supports a limited set of expression tags; not every emotion is controllable.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
AUDAR_DIR = REPO_ROOT / "third_party" / "Audar-TTS-V1"
if AUDAR_DIR.exists():
    sys.path.insert(0, str(AUDAR_DIR))

from dub_arabic_cpu import atomic_json, create_translator, load_json, media_duration, sha256_file, translate_with_retry

SCHEMA = 1
SAMPLE_RATE = 16000
OUT_SR = 24000
CHUNK_SECONDS = 300
MODEL_ID = "audarai/Audar-TTS-V1-Flash"
GGUF_NAME = "Audar-TTS-V1-Flash-Q4_K_M.gguf"

VOICE_PROFILES: dict[str, dict[str, str]] = {
    "demo_male_1": {
        "gender": "male", "style": "warm, confident",
        "ref_url": "https://huggingface.co/audarai/Audar-TTS-V1-Flash/resolve/main/samples/demo_male_1_ar.wav",
        "ref_text": "لا يمكنني الانتظار لأخبرك — [excited] لقد أنجزنا المشروع أخيراً بعد كلّ هذا التعب، [laughs] وصدّقني، إنه أجمل شعورٍ على الإطلاق!",
    },
    "demo_male_2": {
        "gender": "male", "style": "soft, intimate",
        "ref_url": "https://huggingface.co/audarai/Audar-TTS-V1-Flash/resolve/main/samples/demo_male_2_ar.wav",
        "ref_text": "تعال، اقترب قليلاً — [whispers] لقد خطّطتُ لمفاجأةٍ رائعة طوال الأسبوع، [mischievously] وأنا واثقٌ تماماً أنّها ستُدهشك حقاً!",
    },
    "demo_male_3": {
        "gender": "male", "style": "bright, curious",
        "ref_url": "https://huggingface.co/audarai/Audar-TTS-V1-Flash/resolve/main/samples/demo_male_3_ar.wav",
        "ref_text": "لحظة، حقاً؟ [curious] بنيتَ كلّ هذا بنفسك؟ [excited] هذا مذهلٌ — احكِ لي التفاصيل!",
    },
    "demo_female_1": {
        "gender": "female", "style": "vibrant, joyful",
        "ref_url": "https://huggingface.co/audarai/Audar-TTS-V1-Flash/resolve/main/samples/demo_female_1_ar.wav",
        "ref_text": "خمّن ماذا وصل — [excited] رسالة القبول! [laughs] صرختُ من شدّة الفرح!",
    },
    "demo_female_2": {
        "gender": "female", "style": "velvety, playful",
        "ref_url": "https://huggingface.co/audarai/Audar-TTS-V1-Flash/resolve/main/samples/demo_female_2_ar.wav",
        "ref_text": "اقتربي قليلاً — [whispers] وجدتُ مقهىً رائعاً، [mischievously] سيكون مكاننا السرّي!",
    },
    "demo_female_3": {
        "gender": "female", "style": "airy, dreamy",
        "ref_url": "https://huggingface.co/audarai/Audar-TTS-V1-Flash/resolve/main/samples/demo_female_3_ar.wav",
        "ref_text": "لن تصدّقي المنظر — [excited] المدينة تتلألأ عند الغروب، [laughs] كأنّها حلمٌ جميل!",
    },
}

ARABIC_EMOTION_RULES = [
    ("laughs", r"(يضحك|تضحك|ضحك|قهقه|هههه|هاها)"),
    ("whispers", r"(بصوت منخفض|همس|لا يسمعنا أحد|بيننا سر|لا تخبر أحد|لا تخبري أحد|سراً)"),
    ("sighs", r"(آسف|آسفة|حزين|حزينة|اشتقت|وداعاً|فقدت|مات|ماتت|لم أعد أستطيع)"),
    ("sarcastic", r"(يا له من|يا لها من|طبعاً،|بالتأكيد،|حقاً؟|سخيف|مثير للسخرية|مضحك جداً)"),
    ("mischievously", r"(لدي خطة|لديّ خطة|مفاجأة|انتظر حتى|انتظري حتى|لن تتوقع|لن تتوقعي)"),
    ("excited", r"(رائع|مذهل|نجحنا|فزنا|أخيراً|مستحيل|يا إلهي|لا أصدق|خبر رائع|!)"),
]

def run(cmd: list[str], timeout: int = 300) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    except subprocess.CalledProcessError as exc:
        tail = (exc.stderr or exc.stdout or "")[-2500:]
        raise RuntimeError(f"Command failed ({cmd[0]}), exit={exc.returncode}: {tail}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Command timed out after {timeout}s: {cmd[0]}") from exc

def download(url: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size > 10_000:
        return
    tmp = path.with_suffix(path.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "ArabicDubbingPipeline/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, tmp.open("wb") as dest:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                dest.write(block)
        if not tmp.is_file() or tmp.stat().st_size <= 10_000:
            raise RuntimeError(f"Reference voice download was empty: {path.name}")
        os.replace(tmp, path)
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Could not download synthetic Audar voice reference {path.name}: {type(exc).__name__}") from exc

def estimate_pitch_and_energy(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> tuple[float | None, float]:
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if len(x) < int(sample_rate * 0.25):
        return None, float(np.sqrt(np.mean(x * x))) if len(x) else 0.0
    rms = float(np.sqrt(np.mean(x * x)))
    # Subsample a few 20-ms frames for a fast, approximate F0 estimate.
    frame_len = int(sample_rate * 0.025)
    starts = np.linspace(0, max(0, len(x) - frame_len), num=min(18, max(1, len(x) // max(1, frame_len))), dtype=int)
    f0s: list[float] = []
    for start in starts:
        frame = x[start:start + frame_len]
        if len(frame) != frame_len or float(np.sqrt(np.mean(frame * frame))) < 0.008:
            continue
        frame = frame - np.mean(frame)
        corr = np.correlate(frame, frame, mode="full")[len(frame) - 1:]
        lo = max(1, int(sample_rate / 350))
        hi = min(len(corr) - 1, int(sample_rate / 70))
        if hi <= lo:
            continue
        lag = lo + int(np.argmax(corr[lo:hi]))
        hz = sample_rate / lag
        if 70 <= hz <= 350:
            f0s.append(float(hz))
    return (float(np.median(f0s)) if f0s else None), rms

def transcribe_audio(audio_path: Path, out_dir: Path, model_name: str) -> tuple[list[dict[str, Any]], str, float]:
    audio_hash = sha256_file(audio_path)
    cache_path = out_dir / "transcript_source.json"
    cached = load_json(cache_path)
    duration = media_duration(audio_path)
    if (
        isinstance(cached, dict)
        and cached.get("schema") == SCHEMA
        and cached.get("audio_sha256") == audio_hash
        and cached.get("asr_model") == model_name
        and isinstance(cached.get("segments"), list)
        and cached["segments"]
    ):
        print(f"Reusing ASR checkpoint: {len(cached['segments'])} segments", flush=True)
        return cached["segments"], str(cached.get("source_language") or "unknown"), duration

    from faster_whisper import WhisperModel
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    detected_segments, info = model.transcribe(
        str(audio_path), beam_size=3, vad_filter=True,
        word_timestamps=False, condition_on_previous_text=True
    )
    segments: list[dict[str, Any]] = []
    for raw in detected_segments:
        text = re.sub(r"\s+", " ", raw.text or "").strip()
        if text:
            segments.append({
                "index": len(segments),
                "start": max(0.0, float(raw.start)),
                "end": min(duration, max(float(raw.end), float(raw.start) + 0.08)),
                "source": text,
            })
            if len(segments) % 50 == 0:
                print(f"ASR: {len(segments)} segments recognized", flush=True)
    if not segments:
        raise RuntimeError("Speech recognition returned no segments; refusing to create a falsely complete dub.")
    source_language = str(getattr(info, "language", "") or "unknown")
    atomic_json(cache_path, {
        "schema": SCHEMA, "audio_sha256": audio_hash, "asr_model": model_name,
        "source_language": source_language, "duration_seconds": duration,
        "segments": segments,
    })
    return segments, source_language, duration

def diarize_segments(audio: np.ndarray, segments: list[dict[str, Any]], out_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    cache_path = out_dir / "speaker_profiles.json"
    audio_hash = hashlib.sha256(np.asarray(audio, dtype=np.float32).tobytes()).hexdigest()
    cached = load_json(cache_path)
    if (
        isinstance(cached, dict)
        and cached.get("schema") == SCHEMA
        and cached.get("audio_sha256") == audio_hash
        and isinstance(cached.get("segments"), list)
        and len(cached["segments"]) == len(segments)
    ):
        print(f"Reusing speaker-clustering checkpoint: {cached.get('speaker_count', 0)} speakers", flush=True)
        return cached["segments"], cached

    try:
        import torch
        from speechbrain.inference.speaker import EncoderClassifier
        from sklearn.cluster import AgglomerativeClustering
    except Exception as exc:
        raise RuntimeError(f"Speaker diarization dependencies failed to import ({type(exc).__name__}).") from exc

    model_dir = out_dir / "models" / "speechbrain-ecapa"
    model_dir.mkdir(parents=True, exist_ok=True)
    print("Loading public SpeechBrain ECAPA speaker-embedding model (CPU)", flush=True)
    encoder = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(model_dir),
        run_opts={"device": "cpu"},
    )

    valid_positions: list[int] = []
    embeddings: list[np.ndarray] = []
    acoustics: dict[int, tuple[float | None, float]] = {}
    for pos, seg in enumerate(segments):
        start = max(0, int(float(seg["start"]) * SAMPLE_RATE))
        end = min(len(audio), int(float(seg["end"]) * SAMPLE_RATE))
        crop = np.asarray(audio[start:end], dtype=np.float32)
        pitch, energy = estimate_pitch_and_energy(crop)
        acoustics[pos] = (pitch, energy)
        if len(crop) < int(SAMPLE_RATE * 0.9):
            continue
        if pos % 25 == 0:
            print(f"Speaker embeddings: {pos + 1}/{len(segments)} segments scanned", flush=True)
        wav = torch.from_numpy(crop.copy()).float().unsqueeze(0)
        with torch.no_grad():
            vector = encoder.encode_batch(wav).squeeze().detach().cpu().numpy().astype(np.float32)
        vector /= max(float(np.linalg.norm(vector)), 1e-9)
        embeddings.append(vector)
        valid_positions.append(pos)

    if len(embeddings) < 2:
        raise RuntimeError("Not enough speech segments (>=0.9 s) to establish reliable speaker identities.")
    matrix = np.stack(embeddings)
    distance_threshold = 0.36
    if len(matrix) == 2:
        labels = np.array([0, 1], dtype=int)
    else:
        clusterer = AgglomerativeClustering(
            n_clusters=None, distance_threshold=distance_threshold,
            metric="cosine", linkage="average",
        )
        labels = clusterer.fit_predict(matrix)
        if len(set(labels.tolist())) > 10:
            labels = AgglomerativeClustering(n_clusters=10, metric="cosine", linkage="average").fit_predict(matrix)

    position_to_cluster = {pos: int(label) for pos, label in zip(valid_positions, labels)}
    # Assign short ASR fragments to their closest turn in time; this is explicitly approximate.
    for pos in range(len(segments)):
        if pos in position_to_cluster:
            continue
        nearest = min(valid_positions, key=lambda k: abs(float(segments[k]["start"]) - float(segments[pos]["start"])))
        position_to_cluster[pos] = position_to_cluster[nearest]

    clusters = sorted(
        set(position_to_cluster.values()),
        key=lambda cluster: min(float(segments[p]["start"]) for p, lab in position_to_cluster.items() if lab == cluster),
    )
    normalized_label = {old: f"speaker_{i + 1:02d}" for i, old in enumerate(clusters)}
    profiles: dict[str, Any] = {}
    enriched_segments: list[dict[str, Any]] = []
    for pos, seg in enumerate(segments):
        label = normalized_label[position_to_cluster[pos]]
        pitch, energy = acoustics[pos]
        record = dict(seg)
        record["speaker_id"] = label
        record["estimated_f0_hz"] = round(pitch, 1) if pitch else None
        record["rms_energy"] = round(energy, 6)
        enriched_segments.append(record)
        entry = profiles.setdefault(label, {
            "first_seen_seconds": float(seg["start"]),
            "pitch_samples_hz": [], "energy_samples": [], "turns": 0,
        })
        if pitch:
            entry["pitch_samples_hz"].append(pitch)
        entry["energy_samples"].append(energy)
        entry["turns"] += 1

    male_pool = ["demo_male_1", "demo_male_2", "demo_male_3"]
    female_pool = ["demo_female_1", "demo_female_2", "demo_female_3"]
    counts = {"male": 0, "female": 0}
    for label in sorted(profiles, key=lambda s: profiles[s]["first_seen_seconds"]):
        p = profiles[label]
        pitches = p.pop("pitch_samples_hz")
        energies = p.pop("energy_samples")
        median_f0 = float(np.median(pitches)) if pitches else None
        p["median_f0_hz"] = round(median_f0, 1) if median_f0 else None
        p["median_rms_energy"] = round(float(np.median(energies)), 6) if energies else None
        if median_f0 is not None and median_f0 >= 175:
            gender = "probable_female"
            pool = female_pool
            family = "female"
        elif median_f0 is not None and median_f0 <= 150:
            gender = "probable_male"
            pool = male_pool
            family = "male"
        else:
            # A low-confidence midpoint is assigned to the less-used pool; it is not a certainty.
            family = "female" if counts["female"] < counts["male"] else "male"
            pool = female_pool if family == "female" else male_pool
            gender = "uncertain_acoustic_pitch"
        voice_id = pool[counts[family] % len(pool)]
        counts[family] += 1
        p["gender_presentation_guess"] = gender
        p["voice_profile_id"] = voice_id
        p["voice_profile_style"] = VOICE_PROFILES[voice_id]["style"]
        p["age_presentation_hint"] = (
            "youthful/bright register (low-confidence acoustic impression)"
            if median_f0 is not None and median_f0 >= 205
            else "lower/steadier register; actual age cannot be inferred reliably from voice alone"
        )
        p["confidence_note"] = "Heuristic only; review this profile if pitch does not match the visible character."
    # Copy stable profile properties onto segments.
    for seg in enriched_segments:
        p = profiles[seg["speaker_id"]]
        seg["voice_profile_id"] = p["voice_profile_id"]
        seg["gender_presentation_guess"] = p["gender_presentation_guess"]

    manifest = {
        "schema": SCHEMA,
        "audio_sha256": audio_hash,
        "speaker_count": len(profiles),
        "diarization_method": "SpeechBrain ECAPA embeddings + cosine agglomerative clustering",
        "distance_threshold": distance_threshold,
        "speaker_profiles": profiles,
        "segments": enriched_segments,
        "limitations": [
            "speaker clustering can split or merge characters, especially when turns are short or overlap",
            "gender and age presentation are approximate audio heuristics, not reliable demographic identification",
            "up to three synthetic profiles per estimated voice family; extra same-family speakers reuse a profile",
        ],
    }
    atomic_json(cache_path, manifest)
    atomic_json(out_dir / "transcript_source_with_speakers.json", {
        "schema": SCHEMA, "audio_sha256": audio_hash, "segments": enriched_segments,
    })
    return enriched_segments, manifest

def emotion_tag(text: str, source_text: str, rms: float, speaker_baseline_rms: float | None) -> str | None:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    source_lower = (source_text or "").lower()
    for tag, pattern in ARABIC_EMOTION_RULES:
        if re.search(pattern, normalized):
            return f"[{tag}]"
    if re.search(r"(ha ha|haha|laughter|laughing|giggle)", source_lower):
        return "[laughs]"
    if ("?" in normalized or "؟" in normalized) and len(normalized) > 5:
        return "[curious]"
    if normalized.count("!") >= 1 and len(normalized) < 100:
        return "[excited]"
    if speaker_baseline_rms and rms > speaker_baseline_rms * 1.8 and len(normalized) < 140:
        return "[excited]"
    if speaker_baseline_rms and rms < speaker_baseline_rms * 0.55 and len(normalized) < 120:
        return "[whispers]"
    return None

def synthesize_audar(text: str, voice_id: str, refs: dict[str, tuple[Path, str]], llm: Any, codec: Any, torch: Any, out_path: Path, max_tokens: int = 1500) -> None:
    from audar_tts import build_prompt, encode_reference
    ref_path, ref_text = refs[voice_id]
    cache_key = voice_id
    if cache_key not in synthesize_audar.ref_codes:
        synthesize_audar.ref_codes[cache_key] = encode_reference(codec, str(ref_path))
    prompt = build_prompt(text, ref_text, synthesize_audar.ref_codes[cache_key])
    end_token = llm.tokenize(b"<|TARGET_CODES_END|>", add_bos=False, special=True)[0]
    token_ids = llm.tokenize(prompt.encode("utf-8"), add_bos=False, special=True)
    speech_tokens: list[int] = []
    for token in llm.generate(
        token_ids, temp=0.85, top_k=40, top_p=0.9, repeat_penalty=1.1
    ):
        if token == end_token or len(speech_tokens) >= max_tokens:
            break
        speech_tokens.append(token)
    result = "".join(llm.detokenize([tid], special=True).decode("utf-8", "ignore") for tid in speech_tokens)
    codes = [int(x) for x in re.findall(r"<\|speech_(\d+)\|>", result)]
    if not codes:
        raise RuntimeError(f"Audar-TTS returned no speech tokens for {voice_id}; refusing to substitute fake audio.")
    audio = codec.decode_code(torch.tensor(codes)[None, None, :]).detach().cpu().numpy()[0, 0, :]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out_path, audio, OUT_SR, subtype="PCM_16")

synthesize_audar.ref_codes = {}

def prepare_refs(out_dir: Path) -> dict[str, tuple[Path, str]]:
    refs_dir = out_dir / "voice_refs"
    refs: dict[str, tuple[Path, str]] = {}
    for voice_id, metadata in VOICE_PROFILES.items():
        ref_path = refs_dir / f"{voice_id}.wav"
        download(metadata["ref_url"], ref_path)
        refs[voice_id] = (ref_path, metadata["ref_text"])
    return refs

def fit_segment(source_wav: Path, fitted_wav: Path, duration_limit: float, max_atempo: float = 1.45) -> tuple[float, float]:
    generated = media_duration(source_wav)
    available = max(0.25, duration_limit)
    atempo = min(max_atempo, max(1.0, generated / available))
    if atempo > 1.001:
        run(["ffmpeg", "-y", "-v", "error", "-i", str(source_wav), "-af", f"atempo={atempo:.4f}",
             "-ac", "2", "-ar", str(OUT_SR), "-c:a", "pcm_s16le", str(fitted_wav)], timeout=180)
    else:
        run(["ffmpeg", "-y", "-v", "error", "-i", str(source_wav), "-ac", "2", "-ar", str(OUT_SR),
             "-c:a", "pcm_s16le", str(fitted_wav)], timeout=180)
    final_duration = media_duration(fitted_wav)
    if final_duration <= 0 or fitted_wav.stat().st_size < 1000:
        raise RuntimeError(f"Invalid fitted speech file {fitted_wav.name}")
    return final_duration, atempo

def mix_audio_chunks(segments: list[dict[str, Any]], audio_duration: float, chunks_dir: Path, out_audio: Path) -> None:
    chunks_dir.mkdir(parents=True, exist_ok=True)
    chunk_count = max(1, math.ceil(audio_duration / CHUNK_SECONDS))
    concat_list = chunks_dir / "concat.txt"
    files: list[Path] = []
    # Each output chunk includes any utterance whose fitted waveform crosses its boundary.
    for chunk_index in range(chunk_count):
        chunk_start = chunk_index * CHUNK_SECONDS
        chunk_duration = min(CHUNK_SECONDS, max(0.1, audio_duration - chunk_start))
        chunk_end = chunk_start + chunk_duration
        relevant: list[tuple[dict[str, Any], float]] = []
        for seg in segments:
            wav_path = Path(seg["fitted_wav"])
            if not wav_path.is_file():
                continue
            seg_start = float(seg["start"])
            seg_end = seg_start + float(seg.get("fitted_duration_seconds") or media_duration(wav_path))
            if seg_start < chunk_end and seg_end > chunk_start:
                offset = max(0.0, chunk_start - seg_start)
                relevant.append((seg, offset))
        out_chunk = chunks_dir / f"dub_chunk_{chunk_index:04d}.wav"
        cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-t", f"{chunk_duration:.6f}",
               "-i", f"anullsrc=r={OUT_SR}:cl=stereo"]
        for seg, _offset in relevant:
            cmd.extend(["-i", str(seg["fitted_wav"])])
        filters: list[str] = []
        mix_inputs = ["[0:a]"]
        for input_index, (seg, offset) in enumerate(relevant, start=1):
            seg_start = float(seg["start"])
            local_start = max(0.0, seg_start - chunk_start)
            # Drop the already-emitted portion of any utterance crossing from the previous chunk.
            filters.append(
                f"[{input_index}:a]atrim=start={offset:.6f},asetpts=PTS-STARTPTS,"
                f"adelay={int(local_start*1000)}|{int(local_start*1000)},volume=0.92[s{input_index}]"
            )
            mix_inputs.append(f"[s{input_index}]")
        filters.append("".join(mix_inputs) + f"amix=inputs={len(mix_inputs)}:duration=first:normalize=0,"
                       f"alimiter=limit=0.95,atrim=duration={chunk_duration:.6f}[out]")
        cmd.extend(["-filter_complex", ";".join(filters), "-map", "[out]", "-ar", str(OUT_SR),
                    "-ac", "2", "-c:a", "pcm_s16le", str(out_chunk)])
        run(cmd, timeout=900)
        if not out_chunk.is_file() or out_chunk.stat().st_size < 1000:
            raise RuntimeError(f"Failed to build audio timeline chunk {chunk_index}")
        files.append(out_chunk)
        print(f"Timeline mix chunk {chunk_index+1}/{chunk_count} verified", flush=True)
    concat_list.write_text("".join(f"file '{p.resolve()}'\n" for p in files), encoding="utf-8")
    out_audio.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat_list),
         "-ar", str(OUT_SR), "-ac", "2", "-c:a", "pcm_s16le", str(out_audio)], timeout=1200)
    if not out_audio.is_file() or out_audio.stat().st_size < 1000:
        raise RuntimeError("Final continuous Arabic audio could not be assembled.")

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True, help="16 kHz mono WAV extracted from the authorized source.")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--asr-model", default="small", choices=["tiny", "base", "small"])
    ap.add_argument("--translation-backend", choices=["argos", "google"], default="argos")
    ap.add_argument("--max-atempo", type=float, default=1.45)
    ap.add_argument("--source-sha256", default="")
    args = ap.parse_args()

    if not (1.0 <= args.max_atempo <= 1.6):
        raise SystemExit("--max-atempo must be between 1.0 and 1.6")
    audio_path = Path(args.audio).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    if not audio_path.is_file() or audio_path.stat().st_size < 1000:
        raise SystemExit(f"Audio input missing or too small: {audio_path}")
    audio, sr = sf.read(str(audio_path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    if sr != SAMPLE_RATE:
        raise RuntimeError(f"Expected {SAMPLE_RATE} Hz mono input, got {sr} Hz.")
    audio_duration = len(audio) / sr
    audio_hash = sha256_file(audio_path)
    start_time = time.time()

    raw_segments, source_language, _ = transcribe_audio(audio_path, out_dir, args.asr_model)
    diarized_segments, speaker_manifest = diarize_segments(audio, raw_segments, out_dir)

    translator, translation_backend_name = create_translator(args.translation_backend, source_language)
    speaker_baseline: dict[str, float] = {}
    for seg in diarized_segments:
        speaker_baseline.setdefault(seg["speaker_id"], []).append(float(seg.get("rms_energy") or 0))
    speaker_baseline = {k: float(np.median(v)) for k, v in speaker_baseline.items()}

    refs = prepare_refs(out_dir)
    print("Loading Audar-TTS-V1-Flash Q4_K_M and NeuCodec (CPU)", flush=True)
    from huggingface_hub import hf_hub_download
    from llama_cpp import Llama
    from neucodec import NeuCodec
    import torch

    gguf_path = hf_hub_download(
        repo_id=MODEL_ID, filename=GGUF_NAME,
        local_dir=str(out_dir / "models" / "audar-flash"),
    )
    llm = Llama(model_path=gguf_path, n_ctx=4096, n_gpu_layers=0, verbose=False)
    codec = NeuCodec.from_pretrained("neuphonic/neucodec").eval()

    final_segments: list[dict[str, Any]] = []
    translated_segments_path = out_dir / "translated_segments.json"
    prior = load_json(translated_segments_path)
    prior_by_index: dict[int, dict[str, Any]] = {}
    if isinstance(prior, dict) and prior.get("audio_sha256") == audio_hash and prior.get("tts_engine") == "Audar-TTS-V1-Flash-Q4_K_M":
        prior_by_index = {int(s["index"]): s for s in prior.get("segments", []) if "index" in s}

    segment_dir = out_dir / "segments"
    segment_dir.mkdir(parents=True, exist_ok=True)
    for i, seg in enumerate(diarized_segments):
        segment_index = int(seg.get("index", i))
        source_text = str(seg.get("source", "")).strip()
        if not source_text:
            continue
        speaker_id = str(seg["speaker_id"])
        profile = speaker_manifest["speaker_profiles"][speaker_id]
        voice_id = str(profile["voice_profile_id"])
        checkpoint = prior_by_index.get(segment_index, {})
        wav_raw = segment_dir / f"line_{segment_index:05d}_{voice_id}.wav"
        wav_fit = segment_dir / f"line_{segment_index:05d}_{voice_id}_fit.wav"
        valid_checkpoint = (
            checkpoint.get("source") == source_text
            and checkpoint.get("voice_profile_id") == voice_id
            and checkpoint.get("tts_engine") == "Audar-TTS-V1-Flash-Q4_K_M"
            and checkpoint.get("translation_backend") == args.translation_backend
            and checkpoint.get("arabic")
            and wav_raw.is_file() and wav_raw.stat().st_size > 1000
            and checkpoint.get("raw_sha256") == sha256_file(wav_raw)
        )
        if valid_checkpoint:
            arabic = str(checkpoint["arabic"])
            tag = checkpoint.get("emotion_tag")
            print(f"Reusing translated/TTS checkpoint for segment {segment_index}", flush=True)
        else:
            arabic = translate_with_retry(translator, source_text, 4)
            tag = emotion_tag(arabic, source_text, float(seg.get("rms_energy") or 0), speaker_baseline.get(speaker_id))
            tagged_text = f"{tag} {arabic}" if tag else arabic
            synthesize_audar(tagged_text, voice_id, refs, llm, codec, torch, wav_raw)
            checkpoint = {
                "index": segment_index, "source": source_text, "arabic": arabic,
                "speaker_id": speaker_id, "voice_profile_id": voice_id, "emotion_tag": tag,
                "translation_backend": args.translation_backend,
                "tts_engine": "Audar-TTS-V1-Flash-Q4_K_M", "raw_sha256": sha256_file(wav_raw),
                "status": "synthesized",
            }
            prior_by_index[segment_index] = checkpoint
            atomic_json(translated_segments_path, {
                "schema": SCHEMA, "audio_sha256": audio_hash,
                "source_language": source_language, "target_language": "ar",
                "translation_backend": translation_backend_name,
                "tts_engine": "Audar-TTS-V1-Flash-Q4_K_M",
                "segments": [prior_by_index[k] for k in sorted(prior_by_index)],
            })

        start = float(seg["start"])
        end = min(audio_duration, max(start + 0.08, float(seg["end"])))
        next_starts = [float(x["start"]) for x in diarized_segments if float(x["start"]) > start + 0.02]
        next_start = min(next_starts) if next_starts else audio_duration
        # Do not truncate words: fit naturally first, then use at most the configured speech-rate increase.
        window = max(0.30, min(end, next_start, audio_duration) - start)
        if not wav_fit.is_file() or wav_fit.stat().st_size < 1000 or checkpoint.get("fit_window_seconds") != round(window, 3):
            fitted_duration, atempo = fit_segment(wav_raw, wav_fit, window, args.max_atempo)
        else:
            fitted_duration = media_duration(wav_fit)
            atempo = float(checkpoint.get("atempo", 1.0))
        updated = {
            **seg,
            "arabic": arabic,
            "emotion_tag": tag,
            "voice_profile_id": voice_id,
            "voice_profile_style": VOICE_PROFILES[voice_id]["style"],
            "start": start,
            "end": end,
            "fitted_wav": str(wav_fit),
            "fitted_duration_seconds": round(fitted_duration, 3),
            "target_window_seconds": round(window, 3),
            "atempo": round(atempo, 3),
            "timing_overrun": bool(fitted_duration > window + 0.12),
        }
        final_segments.append(updated)
        checkpoint = prior_by_index.get(segment_index, checkpoint)
        checkpoint.update({"fit_window_seconds": round(window, 3), "atempo": round(atempo, 3), "fitted_sha256": sha256_file(wav_fit)})
        prior_by_index[segment_index] = checkpoint
        # Persist each completed segment so an interrupted run can resume without re-synthesizing it.
        atomic_json(translated_segments_path, {
            "schema": SCHEMA, "audio_sha256": audio_hash,
            "source_language": source_language, "target_language": "ar",
            "translation_backend": translation_backend_name,
            "tts_engine": "Audar-TTS-V1-Flash-Q4_K_M",
            "segments": [prior_by_index[k] for k in sorted(prior_by_index)],
        })
        if (i + 1) % 10 == 0:
            print(f"Synthesis: {i+1}/{len(diarized_segments)} segments processed", flush=True)

    atomic_json(translated_segments_path, {
        "schema": SCHEMA, "audio_sha256": audio_hash,
        "source_language": source_language, "target_language": "ar",
        "translation_backend": translation_backend_name,
        "tts_engine": "Audar-TTS-V1-Flash-Q4_K_M",
        "segments": [prior_by_index[k] for k in sorted(prior_by_index)],
    })
    atomic_json(out_dir / "transcript_ar.json", {
        "schema": SCHEMA,
        "audio_sha256": audio_hash,
        "target_language": "ar",
        "segments": [{k: v for k, v in seg.items() if k not in {"fitted_wav"}} for seg in final_segments],
    })

    mix_audio_chunks(final_segments, audio_duration, out_dir / "timeline_chunks", out_dir / "dub_ar.wav")
    dub_duration = media_duration(out_dir / "dub_ar.wav")
    overrun_count = sum(1 for seg in final_segments if seg.get("timing_overrun"))
    report = {
        "status": "AUDIO_DUB_CREATED",
        "source_sha256": args.source_sha256 or audio_hash,
        "audio_sha256": audio_hash,
        "source_language": source_language,
        "target_language": "ar",
        "source_duration_seconds": round(audio_duration, 3),
        "dub_audio_duration_seconds": round(dub_duration, 3),
        "segment_count": len(final_segments),
        "speaker_count": speaker_manifest.get("speaker_count"),
        "speaker_profiles": speaker_manifest.get("speaker_profiles"),
        "tts_engine": "Audar-TTS-V1-Flash-Q4_K_M (CPU GGUF)",
        "translation_backend": translation_backend_name,
        "expressive_tags": {tag: sum(1 for seg in final_segments if seg.get("emotion_tag") == tag) for tag in sorted({str(s.get("emotion_tag")) for s in final_segments if s.get("emotion_tag")})},
        "timing_overrun_segments": overrun_count,
        "duration_delta_seconds": round(dub_duration - audio_duration, 3),
        "elapsed_seconds": round(time.time() - start_time, 1),
        "limitations": [
            "Speaker identities are clustered acoustically; clusters need spot review for merges/splits.",
            "Gender/presentation is a low-confidence pitch heuristic; age is not reliably inferable from audio alone.",
            "Audar Flash offers eight tags; anger, crying, and panic are not directly controllable in this tier.",
            "Background dialogue/music separation is not performed here; final mux keeps source ambience at a low level, so source dialogue may remain faintly audible.",
            "No visual lip-sync is performed; speech segments are fitted to audio timestamps, not mouth motion.",
            "A timing-overrun count above zero indicates lines that may overlap adjacent dialogue.",
        ],
    }
    atomic_json(out_dir / "run_manifest.json", report)
    with (out_dir / "run_manifest.json").open("r", encoding="utf-8") as handle:
        print(json.dumps(json.load(handle), ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"::error::{type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)
