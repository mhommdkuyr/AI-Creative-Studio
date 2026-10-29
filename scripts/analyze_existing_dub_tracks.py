#!/usr/bin/env python3
"""Transcribe Chinese source and Arabic voice masters with word timestamps; cluster source speakers."""
from __future__ import annotations
import argparse, json, math, re, hashlib, time
from pathlib import Path
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()

def atomic_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)

def transcribe(model, path: Path, language: str, beam: int):
    t0=time.time()
    segments, info=model.transcribe(
        str(path), language=language, beam_size=beam, vad_filter=True,
        vad_parameters={"min_silence_duration_ms":350,"speech_pad_ms":180},
        word_timestamps=True, condition_on_previous_text=True
    )
    rows=[]
    for seg in segments:
        words=[]
        for w in (seg.words or []):
            words.append({
                "start":round(float(w.start),3),"end":round(float(w.end),3),
                "text":(w.word or "").strip(),"probability":round(float(w.probability),4)
            })
        text=re.sub(r"\s+"," ",(seg.text or "").strip())
        if text:
            rows.append({
                "index":len(rows),"start":round(float(seg.start),3),
                "end":round(float(seg.end),3),"text":text,"words":words
            })
        if len(rows)%100==0 and rows:
            print(f"{path.name}: {len(rows)} transcript segments",flush=True)
    return {
        "file":path.name,"sha256":sha256(path),"language_detected":getattr(info,"language",None),
        "language_probability":getattr(info,"language_probability",None),
        "duration_seconds":round(float(getattr(info,"duration",0) or 0),3),
        "elapsed_seconds":round(time.time()-t0,1),"segments":rows
    }

def estimate_pitch(x, sr=16000):
    x=np.asarray(x,dtype=np.float32).reshape(-1)
    if len(x)<int(sr*.25): return None
    frame=int(sr*.03)
    positions=np.linspace(0,max(0,len(x)-frame),num=min(12,max(1,len(x)//frame)),dtype=int)
    vals=[]
    for p in positions:
        z=x[p:p+frame]
        if len(z)!=frame or np.sqrt(np.mean(z*z))<.008: continue
        z=z-np.mean(z)
        ac=np.correlate(z,z,mode="full")[len(z)-1:]
        lo=max(1,int(sr/350)); hi=min(len(ac)-1,int(sr/70))
        if hi<=lo: continue
        f=sr/(lo+int(np.argmax(ac[lo:hi])))
        if 70<=f<=350: vals.append(f)
    return float(np.median(vals)) if vals else None

def diarize(audio_path: Path, transcript: dict, out: Path, max_speakers: int):
    import torch
    from speechbrain.inference.speaker import EncoderClassifier
    from sklearn.cluster import AgglomerativeClustering
    audio,sr=sf.read(str(audio_path),dtype="float32")
    if audio.ndim>1: audio=np.mean(audio,axis=1)
    if sr!=16000: raise RuntimeError(f"Expected 16kHz mono source audio, got {sr}")
    model_dir=out/"models"/"speechbrain-ecapa"
    model_dir.mkdir(parents=True,exist_ok=True)
    print("Loading SpeechBrain ECAPA speaker encoder",flush=True)
    encoder=EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(model_dir),run_opts={"device":"cpu"}
    )
    valid=[]; vectors=[]; acoustic={}
    segments=transcript["segments"]
    for i,s in enumerate(segments):
        a=max(0,int(s["start"]*sr)); b=min(len(audio),int(s["end"]*sr))
        crop=audio[a:b]
        pitch=estimate_pitch(crop,sr)
        acoustic[i]=pitch
        if len(crop)<int(sr*.85): continue
        wav=torch.from_numpy(crop.copy()).float().unsqueeze(0)
        with torch.no_grad():
            emb=encoder.encode_batch(wav).squeeze().detach().cpu().numpy().astype(np.float32)
        emb/=max(float(np.linalg.norm(emb)),1e-9)
        vectors.append(emb); valid.append(i)
        if len(valid)%50==0: print(f"Speaker embeddings: {len(valid)}",flush=True)
    if len(vectors)<2:
        raise RuntimeError("Insufficient source speech segments for speaker clustering.")
    matrix=np.stack(vectors)
    threshold=.36
    clusterer=AgglomerativeClustering(n_clusters=None,distance_threshold=threshold,metric="cosine",linkage="average")
    labels=clusterer.fit_predict(matrix) if len(matrix)>2 else np.arange(len(matrix))
    if len(set(labels))>max_speakers:
        labels=AgglomerativeClustering(n_clusters=max_speakers,metric="cosine",linkage="average").fit_predict(matrix)
    pos_to_label={p:int(l) for p,l in zip(valid,labels)}
    for i in range(len(segments)):
        if i not in pos_to_label:
            nearest=min(valid,key=lambda k:abs(segments[k]["start"]-segments[i]["start"]))
            pos_to_label[i]=pos_to_label[nearest]
    order=sorted(set(pos_to_label.values()),key=lambda lab:min(segments[i]["start"] for i,v in pos_to_label.items() if v==lab))
    norm={lab:f"source_speaker_{j+1:02d}" for j,lab in enumerate(order)}
    profiles={}; enriched=[]
    for i,s in enumerate(segments):
        sid=norm[pos_to_label[i]]
        rec={**s,"speaker_id":sid}
        enriched.append(rec)
        p=profiles.setdefault(sid,{"first_seen_seconds":s["start"],"turns":0,"pitch_samples_hz":[]})
        p["turns"]+=1
        if acoustic[i]: p["pitch_samples_hz"].append(acoustic[i])
    for sid,p in profiles.items():
        z=p.pop("pitch_samples_hz")
        p["median_f0_hz"]=round(float(np.median(z)),1) if z else None
        p["note"]="Acoustic cluster only; not yet identified as a named character."
    result={
        "method":"SpeechBrain ECAPA embeddings + cosine agglomerative clustering",
        "threshold":threshold,"speaker_count":len(profiles),
        "speaker_profiles":profiles,"segments":enriched,
        "limitations":["Clusters are anonymous and can split/merge speakers; mapping to character names requires dialogue/visual validation."]
    }
    atomic_json(out/"source_speakers.json",result)
    return result

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source-audio",required=True)
    ap.add_argument("--voice-dir",required=True)
    ap.add_argument("--speakers-json",required=True)
    ap.add_argument("--out-dir",required=True)
    ap.add_argument("--model",default="small",choices=["tiny","base","small"])
    ap.add_argument("--max-speakers",type=int,default=14)
    args=ap.parse_args()
    source=Path(args.source_audio); voices=Path(args.voice_dir); out=Path(args.out_dir)
    out.mkdir(parents=True,exist_ok=True)
    model=WhisperModel(args.model,device="cpu",compute_type="int8",cpu_threads=2,num_workers=1)
    print("Transcribing Chinese source audio",flush=True)
    src=transcribe(model,source,"zh",3)
    atomic_json(out/"source_transcript_words.json",src)
    print(f"Source language={src['language_detected']} segments={len(src['segments'])} duration={src['duration_seconds']}",flush=True)
    print("Transcribing Arabic character voice masters",flush=True)
    voice_results=[]
    for p in sorted(voices.glob("*.wav")):
        # only the ten numbered masters
        if not re.match(r"^(0[1-9]|10)_",p.name): continue
        v=transcribe(model,p,"ar",2)
        atomic_json(out/"voice_tracks"/(p.stem+".json"),v)
        voice_results.append({"file":p.name,"segments":len(v["segments"]),"duration_seconds":v["duration_seconds"],"sha256":v["sha256"]})
        print(f"VOICE {p.name}: {len(v['segments'])} ASR segments",flush=True)
    speakers=json.loads(Path(args.speakers_json).read_text(encoding="utf-8"))
    atomic_json(out/"speaker_scripts.json",speakers)
    print("Diarizing source speech",flush=True)
    spk=diarize(source,src,out,args.max_speakers)
    manifest={
        "status":"TRANSCRIPTION_AND_ANONYMOUS_DIARIZATION_COMPLETE",
        "source_duration_seconds":src["duration_seconds"],
        "source_language_detected":src["language_detected"],
        "source_asr_segments":len(src["segments"]),
        "anonymous_source_speakers":spk["speaker_count"],
        "voice_tracks":voice_results,
        "voice_track_asr_segments_total":sum(x["segments"] for x in voice_results),
        "character_identity_mapping":"pending",
        "utterance_to_source_alignment":"pending",
        "music_effects_separation":"not run",
        "final_video":"not rendered"
    }
    atomic_json(out/"analysis_manifest.json",manifest)
    print(json.dumps(manifest,ensure_ascii=False),flush=True)

if __name__=="__main__":
    main()
