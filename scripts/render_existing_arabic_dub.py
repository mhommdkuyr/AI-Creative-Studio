#!/usr/bin/env python3
"""Build a dubbed timeline from the user's ten pre-generated Arabic WAV masters."""
from __future__ import annotations
import argparse, json, math, os, re, subprocess, hashlib
from pathlib import Path

OUT_SR=24000
CHUNK_SECONDS=300

def run(cmd, timeout=900):
    try:
        return subprocess.run(cmd,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
    except subprocess.CalledProcessError as exc:
        tail=(exc.stderr or exc.stdout or "")[-3500:]
        raise RuntimeError(f"Command failed {cmd[0]}: {tail}") from exc

def duration(path):
    raw=run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(path)],timeout=120).stdout.strip()
    return float(raw)

def sha256(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()

def atomic_json(path,data):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)

def make_clip(source, start, end, dest, target_duration=None, max_atempo=1.45):
    raw_dur=max(0.08,float(end)-float(start))
    if target_duration is None: target_duration=raw_dur
    target_duration=max(0.25,float(target_duration))
    speed=raw_dur/target_duration
    atempo=max(0.75,min(max_atempo,speed))
    filters=[]
    if abs(atempo-1.0)>0.015: filters.append(f"atempo={atempo:.5f}")
    filters += [f"apad=pad_dur={max(0.0,target_duration-raw_dur/atempo):.3f}"]
    filt=",".join(filters)
    run(["ffmpeg","-y","-v","error","-ss",f"{float(start):.4f}","-t",f"{raw_dur:.4f}","-i",str(source),
         "-af",filt,"-ac","2","-ar",str(OUT_SR),
         "-c:a","pcm_s16le",str(dest)],timeout=240)
    actual=duration(dest)
    return actual,atempo

def mix_voice_timeline(segments, audio_duration, chunks_dir, out_audio):
    chunks_dir=Path(chunks_dir); chunks_dir.mkdir(parents=True,exist_ok=True)
    chunk_count=max(1,math.ceil(audio_duration/CHUNK_SECONDS))
    chunk_files=[]
    for ci in range(chunk_count):
        cstart=ci*CHUNK_SECONDS
        cdur=min(CHUNK_SECONDS,max(0.1,audio_duration-cstart))
        cend=cstart+cdur
        relevant=[]
        for seg in segments:
            if float(seg["start"]) < cend and float(seg["start"])+float(seg["duration"]) > cstart:
                relevant.append(seg)
        output=chunks_dir/f"dub_chunk_{ci:04d}.wav"
        cmd=["ffmpeg","-y","-v","error","-f","lavfi","-t",f"{cdur:.6f}",
             "-i",f"anullsrc=r={OUT_SR}:cl=stereo"]
        filters=[]; labels=["[0:a]"]
        for n,seg in enumerate(relevant,1):
            cmd += ["-i",str(seg["wav"])]
            offset=max(0.0,cstart-float(seg["start"]))
            local=max(0.0,float(seg["start"])-cstart)
            delay=int(local*1000)
            filters.append(f"[{n}:a]atrim=start={offset:.6f},asetpts=PTS-STARTPTS,"
                           f"adelay={delay}|{delay},volume=0.96[a{n}]")
            labels.append(f"[a{n}]")
        filters.append("".join(labels)+f"amix=inputs={len(labels)}:duration=first:normalize=0,"
                       f"alimiter=limit=0.95,atrim=duration={cdur:.6f}[out]")
        cmd += ["-filter_complex",";".join(filters),"-map","[out]","-ar",str(OUT_SR),
                "-ac","2","-c:a","pcm_s16le",str(output)]
        run(cmd,timeout=1200)
        if output.stat().st_size<1000: raise RuntimeError(f"Empty dub chunk {ci}")
        chunk_files.append(output)
        print(f"Arabic timeline chunk {ci+1}/{chunk_count} complete",flush=True)
    concat=chunks_dir/"concat.txt"
    concat.write_text("".join(f"file '{p.resolve()}'\n" for p in chunk_files),encoding="utf-8")
    run(["ffmpeg","-y","-v","error","-f","concat","-safe","0","-i",str(concat),
         "-ar",str(OUT_SR),"-ac","2","-c:a","pcm_s16le",str(out_audio)],timeout=1800)

def make_srt(selected_lines, timing_lookup, out_path):
    """Write one subtitle cue per rendered speaker utterance, not per ASR fragment."""
    def ts(v):
        ms=max(0,int(round(float(v)*1000)))
        h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); sec,ms=divmod(ms,1000)
        return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"
    rows=[]
    for (sid,ui),assignment in selected_lines.items():
        if (sid,ui) not in timing_lookup:
            continue
        start=float(assignment.get("source_start",0))
        end=float(assignment.get("source_end",0))
        if not (math.isfinite(start) and math.isfinite(end)) or end<=start:
            continue
        text=str(timing_lookup[(sid,ui)].get("text","")).strip()
        if not text:
            continue
        rows.append((start,end,text))
    rows.sort(key=lambda x:(x[0],x[1],x[2]))
    out=[]
    for i,(st,en,text) in enumerate(rows,1):
        out.extend([str(i),f"{ts(st)} --> {ts(max(st+0.2,en))}",text,""])
    Path(out_path).write_text("\n".join(out),encoding="utf-8")
    return len(rows)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--video",required=True)
    ap.add_argument("--voices-dir",required=True)
    ap.add_argument("--bed-audio",required=True,help="Demucs no_vocals/background stem")
    ap.add_argument("--voice-line-timing",required=True)
    ap.add_argument("--source-map",required=True)
    ap.add_argument("--speakers-json",required=True)
    ap.add_argument("--out-dir",required=True)
    ap.add_argument("--min-confidence",type=float,default=0.55)
    ap.add_argument("--max-atempo",type=float,default=1.45)
    args=ap.parse_args()
    video=Path(args.video); voices=Path(args.voices_dir); bed=Path(args.bed_audio); out=Path(args.out_dir)
    out.mkdir(parents=True,exist_ok=True)
    timing=json.loads(Path(args.voice_line_timing).read_text(encoding="utf-8"))
    source_map=json.loads(Path(args.source_map).read_text(encoding="utf-8"))
    scripts=json.loads(Path(args.speakers_json).read_text(encoding="utf-8"))
    video_duration=duration(video)
    # One source WAV per line ID, using the actual ASR word timestamps in the already generated master.
    lines={}
    for track in timing["tracks"]:
        sid=track["speaker_id"]
        candidates=list(voices.glob(f"{int(sid[:2]):02d}_*.wav")) if re.match(r"^\d{2}_",sid or "") else []
        voice_path=candidates[0] if candidates else None
        # Script IDs may not correspond to track file names: match the track_file instead.
        if not voice_path:
            voice_path=voices/track["track_file"]
        if not voice_path.is_file(): raise RuntimeError(f"Missing audio master for {sid}: {track.get('track_file')}")
        for u in track["utterances"]:
            if u.get("track_start_seconds") is None or u.get("track_end_seconds") is None: continue
            lines[(sid,int(u["utterance_index"]))]={**u,"voice_path":voice_path,"text":u["text"]}
    assignments=source_map.get("assignments",[])
    # Merge neighboring ASR fragments that Gemini mapped to the same spoken Arabic utterance.
    grouped={}
    for a in assignments:
        sid=a.get("speaker_script_id","unmatched"); ui=int(a.get("utterance_index",0) or 0)
        conf=float(a.get("confidence",0) or 0)
        if sid=="unmatched" or conf<args.min_confidence or (sid,ui) not in lines: continue
        grouped.setdefault((sid,ui),[]).append(a)
    selected={}
    for key,items in grouped.items():
        items=sorted(items,key=lambda x:float(x["source_start"]))
        runs=[]
        for item in items:
            if not runs or float(item["source_start"])-float(runs[-1][-1]["source_end"])>6.0:
                runs.append([item])
            else:
                runs[-1].append(item)
        best=max(runs,key=lambda run:(sum(float(x.get("confidence",0)) for x in run),float(run[-1]["source_end"])-float(run[0]["source_start"])))
        representative=max(best,key=lambda x:float(x.get("confidence",0))).copy()
        representative["source_start"]=min(float(x["source_start"]) for x in best)
        representative["source_end"]=max(float(x["source_end"]) for x in best)
        representative["merged_source_segment_indices"]=[int(x["source_segment_index"]) for x in best]
        selected[key]=representative
    clips_dir=out/"arabic_line_clips"; clips_dir.mkdir(parents=True,exist_ok=True)
    segments=[]; report=[]; rendered_selected={}
    for n,(key,a) in enumerate(sorted(selected.items(),key=lambda kv:float(kv[1]["source_start"]))):
        sid,ui=key; line=lines[key]
        word_coverage=float(line.get("word_alignment_coverage",0) or 0)
        if word_coverage < 0.45:
            continue
        src_start=float(a["source_start"]); src_end=float(a["source_end"])
        # Give the line the larger of the detected source segment and 350 ms, but never extend beyond the video.
        target=max(0.35,min(video_duration,src_end)-src_start)
        raw_start=float(line["track_start_seconds"]); raw_end=float(line["track_end_seconds"])
        raw_duration=raw_end-raw_start
        if raw_duration<=0.08: continue
        clip=clips_dir/f"{n:05d}_{sid}_{ui:03d}.wav"
        fitted_duration,atempo=make_clip(line["voice_path"],raw_start,raw_end,clip,target,args.max_atempo)
        segments.append({"wav":clip,"start":src_start,"duration":fitted_duration})
        rendered_selected[key]=a
        report.append({
          "source_segment_index":a["source_segment_index"],"source_start":src_start,"source_end":src_end,
          "speaker_script_id":sid,"utterance_index":ui,"confidence":float(a["confidence"]),
          "voice_master":Path(line["voice_path"]).name,"voice_start":raw_start,"voice_end":raw_end,
          "arabic_word_alignment_coverage":round(word_coverage,3),
          "voice_duration":raw_duration,"fitted_duration":round(fitted_duration,3),"target_duration":round(target,3),
          "atempo":round(atempo,3),"timing_overrun":fitted_duration>target+0.12
        })
        if (n+1)%25==0: print(f"Prepared {n+1}/{len(selected)} Arabic lines",flush=True)
    if not segments: raise RuntimeError("No source-to-Arabic line matches passed confidence and timing checks.")
    dub_only=out/"arabic_dialogue_timeline.wav"
    mix_voice_timeline(segments,video_duration,out/"voice_mix_chunks",dub_only)
    # Mix Arabic dialogue over the separated music/effects stem only; original source vocal stem is not used.
    bed24=out/"background_24k.wav"
    run(["ffmpeg","-y","-v","error","-i",str(bed),"-t",f"{video_duration:.3f}",
         "-ac","2","-ar",str(OUT_SR),"-c:a","pcm_s16le",str(bed24)],timeout=1200)
    finalmix=out/"arabic_dialogue_plus_music.wav"
    run(["ffmpeg","-y","-v","error","-i",str(bed24),"-i",str(dub_only),
         "-filter_complex","[0:a]volume=0.95[bed];[1:a]volume=1.0[dub];[bed][dub]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.96[out]",
         "-map","[out]","-t",f"{video_duration:.3f}","-ar","48000","-ac","2","-c:a","pcm_s16le",str(finalmix)],timeout=1800)
    final_video=out/"الحلقة_مدبلجة_بالعربية.mkv"
    run(["ffmpeg","-y","-v","error","-i",str(video),"-i",str(finalmix),
         "-map","0:v:0","-map","1:a:0","-map_metadata","0",
         "-c:v","copy","-c:a","aac","-b:a","256k","-ar","48000",
         "-metadata:s:a:0","language=ara","-metadata:s:a:0","title=Arabic Dub",
         "-shortest",str(final_video)],timeout=2400)
    final_duration=duration(final_video)
    if abs(final_duration-video_duration)>1.0: raise RuntimeError(f"Final duration changed unexpectedly: {final_duration} vs {video_duration}")
    # Verify required streams and audio signal with ffprobe/ffmpeg.
    probe=json.loads(run(["ffprobe","-v","error","-show_format","-show_streams","-of","json",str(final_video)],timeout=120).stdout)
    if not any(s.get("codec_type")=="video" for s in probe.get("streams",[])): raise RuntimeError("Final file has no video stream")
    if not any(s.get("codec_type")=="audio" for s in probe.get("streams",[])): raise RuntimeError("Final file has no audio stream")
    vol=run(["ffmpeg","-hide_banner","-i",str(final_video),"-map","0:a:0","-vn","-af","volumedetect","-f","null","-"],timeout=1800).stderr
    m=re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?) dB",vol)
    if not m or float(m.group(1))<-55: raise RuntimeError("Final mix is silent or invalid")
    subtitle_cue_count=make_srt(rendered_selected,lines,out/"الحلقة_مدبلجة_ترجمة_مرجعية.srt")
    timing_overrun_count=sum(1 for x in report if x["timing_overrun"])
    expected_utterance_count=sum(int(track.get("expected_utterance_count",len(track.get("utterances",[])))) for track in timing.get("tracks",[]))
    sync_review_required=(timing_overrun_count>0 or len(segments)<expected_utterance_count)
    manifest={
      "status":"DUBBED_VIDEO_RENDERED_AND_VERIFIED",
      "video_file":final_video.name,"video_bytes":final_video.stat().st_size,
      "video_sha256":sha256(final_video),"video_duration_seconds":round(final_duration,3),
      "source_video_sha256":sha256(video),"matched_line_count":len(segments),
      "source_assignments_count":len(assignments),"unmatched_assignments":source_map.get("unmatched_count"),
      "low_confidence_assignments":source_map.get("low_confidence_count"),
      "expected_utterance_count":expected_utterance_count,
      "rendered_utterance_count":len(segments),
      "subtitle_cue_count":subtitle_cue_count,
      "timing_overrun_count":timing_overrun_count,
      "sync_quality_status":"review_required" if sync_review_required else "no_timing_overruns_detected",
      "visual_lip_sync_status":"not_performed_video_stream_copied",
      "background_method":"Demucs two-stem separation; original vocals excluded; no_vocals bed retained",
      "video_codec":"original video stream copied losslessly; audio replaced with Arabic+background AAC",
      "audio_peak_db":float(m.group(1)),
      "lines":report
    }
    atomic_json(out/"render_manifest.json",manifest)
    print(json.dumps({k:v for k,v in manifest.items() if k!="lines"},ensure_ascii=False))

if __name__=="__main__":
    main()
