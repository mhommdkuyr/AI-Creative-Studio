#!/usr/bin/env python3
"""Budget-limited Arabic dubbing draft: Whisper timestamps + Arabic neural TTS.
This is intentionally a draft pipeline; it does not claim speaker diarization,
emotion transfer, background separation, or visual lip-sync.
"""
from __future__ import annotations
import argparse, asyncio, json, os, re, subprocess, sys, time
from pathlib import Path

def run(cmd):
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="small")
    p.add_argument("--voice", default="ar-SA-HamedNeural")
    a=p.parse_args()
    out=Path(a.out); out.mkdir(parents=True, exist_ok=True)
    from faster_whisper import WhisperModel
    from deep_translator import GoogleTranslator
    import edge_tts
    # CPU only: no GPU instance and no paid model API.
    model=WhisperModel(a.model, device="cpu", compute_type="int8")
    segs, info=model.transcribe(a.audio, beam_size=1, vad_filter=True, word_timestamps=False)
    segments=[]
    for s in segs:
        text=s.text.strip()
        if text:
            segments.append({"start":float(s.start),"end":float(s.end),"source":text})
    (out/"transcript_source.json").write_text(json.dumps({"language":info.language,"segments":segments},ensure_ascii=False,indent=2),encoding="utf-8")
    if not segments:
        raise RuntimeError("ASR returned no speech segments")
    translator=GoogleTranslator(source="auto", target="ar")
    for s in segments:
        try:
            s["arabic"]=translator.translate(s["source"]) or s["source"]
        except Exception:
            s["arabic"]=s["source"]
    (out/"transcript_ar.json").write_text(json.dumps(segments,ensure_ascii=False,indent=2),encoding="utf-8")
    # TTS each utterance, then place it on its original timeline with FFmpeg.
    # A single Arabic voice is used as a safe fallback; no false claim of diarization.
    clips=[]
    for i,s in enumerate(segments):
        txt=re.sub(r"\s+"," ",s["arabic"]).strip()
        if not txt: continue
        mp3=out/f"line_{i:05d}.mp3"
        wav=out/f"line_{i:05d}.wav"
        asyncio.run(edge_tts.Communicate(txt, a.voice, rate="+0%").save(str(mp3)))
        run(["ffmpeg","-y","-i",str(mp3),"-ac","1","-ar","24000",str(wav)])
        clips.append((s,wav))
    # Build one mono track with utterances placed at source timestamps.
    # Delay is used rather than concatenation, preserving original timing.
    inputs=[]; filters=[]
    for i,(s,wav) in enumerate(clips):
        inputs += ["-i",str(wav)]
        delay=max(0,int(s["start"]*1000))
        filters.append(f"[{i}:a]adelay={delay}|{delay},volume=1.0[a{i}]")
    mix="".join(f"[a{i}]" for i in range(len(clips)))
    filter_complex=";".join(filters)+f";{mix}amix=inputs={len(clips)}:normalize=0,alimiter=limit=0.95[out]"
    cmd=["ffmpeg","-y"]
    # Input files must precede filter_complex.
    cmd += inputs + ["-filter_complex",filter_complex,"-map","[out]","-ac","2","-ar","48000",str(out/"dub_ar.wav")]
    run(cmd)
    (out/"draft_manifest.json").write_text(json.dumps({
        "status":"audio_draft_created","detected_source_language":info.language,
        "segments":len(segments),"voice":a.voice,"target_language":"ar",
        "limitations":["single TTS voice","no speaker diarization","no emotion transfer",
                       "no music/background separation","no visual lip sync",
                       "timing is segment-start aligned, not word-level lip sync"],
        "generated_at_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
    },ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Draft created: {out/'dub_ar.wav'}; segments={len(segments)}; detected={info.language}")

if __name__=="__main__":
    main()
