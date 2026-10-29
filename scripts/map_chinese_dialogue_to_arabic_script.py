#!/usr/bin/env python3
"""Map diarized Chinese source segments to existing Arabic script utterances using resumable Gemini batches."""
from __future__ import annotations
import argparse, hashlib, json, os, re, time, urllib.request, urllib.error
from pathlib import Path

TAG=re.compile(r"<[^<>]+>")
BRACKET=re.compile(r"\\[[^\\]]*\\]")
SPLIT=re.compile(r"\\s*\\.\\.\\.\\s*")

def utterances(speaker):
    out=[]
    for raw in SPLIT.split(speaker.get("text","")):
        text=re.sub(r"\\s+"," ",TAG.sub(" ",BRACKET.sub(" ",raw)).strip())
        if text: out.append({"utterance_index":len(out)+1,"text":text})
    return out

def sha(obj):
    return hashlib.sha256(json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()

def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)

def call_gemini(prompt,keys,model,max_output_tokens):
    url=f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload={
      "contents":[{"role":"user","parts":[{"text":prompt}]}],
      "generationConfig":{
        "responseMimeType":"application/json",
        "responseSchema":{
          "type":"OBJECT",
          "properties":{"assignments":{"type":"ARRAY","items":{
            "type":"OBJECT",
            "properties":{
              "source_segment_index":{"type":"INTEGER"},
              "speaker_script_id":{"type":"STRING"},
              "utterance_index":{"type":"INTEGER"},
              "confidence":{"type":"NUMBER"},
              "reason":{"type":"STRING"}
            },
            "required":["source_segment_index","speaker_script_id","utterance_index","confidence","reason"]
          }}},
          "required":["assignments"]
        },
        "maxOutputTokens":max_output_tokens,
        "temperature":0.1
      }
    }
    body=json.dumps(payload,ensure_ascii=False).encode("utf-8")
    errors=[]
    retryable_codes={408,429,500,502,503,504}
    # Gemini occasionally returns transient 503 UNAVAILABLE responses during demand spikes.
    # Retry across both configured keys with bounded exponential backoff before failing the batch.
    for attempt in range(7):
        retryable=False
        attempt_errors=[]
        for key in keys:
            req=urllib.request.Request(url,data=body,headers={"Content-Type":"application/json","x-goog-api-key":key},method="POST")
            try:
                with urllib.request.urlopen(req,timeout=600) as resp:
                    data=json.loads(resp.read().decode("utf-8"))
                text=data["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text)
            except urllib.error.HTTPError as exc:
                detail=exc.read().decode("utf-8","replace")[:900]
                message=f"HTTP {exc.code}: {detail}"
                errors.append(message)
                attempt_errors.append(message)
                if exc.code in retryable_codes:
                    retryable=True
                    continue
                if exc.code in (401,403):
                    continue
                raise RuntimeError("Gemini alignment failed: "+" | ".join(errors))
            except (TimeoutError, urllib.error.URLError) as exc:
                message=type(exc).__name__+": "+str(exc)[:400]
                errors.append(message)
                attempt_errors.append(message)
                retryable=True
            except Exception as exc:
                message=type(exc).__name__+": "+str(exc)[:400]
                errors.append(message)
                attempt_errors.append(message)
                retryable=True
        if not retryable:
            break
        if attempt < 6:
            delay=min(60,8*(2**attempt))
            print(f"Gemini temporary error; retry {attempt+2}/7 in {delay}s: {' | '.join(attempt_errors)[:500]}",flush=True)
            time.sleep(delay)
    raise RuntimeError("Gemini alignment failed after retries: "+" | ".join(errors[-14:]))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source-speakers",required=True)
    ap.add_argument("--speaker-scripts",required=True)
    ap.add_argument("--out",required=True)
    ap.add_argument("--model",default="gemini-3.8-flash")
    ap.add_argument("--batch-size",type=int,default=300)
    ap.add_argument("--max-output-tokens",type=int,default=16384)
    args=ap.parse_args()
    source=json.loads(Path(args.source_speakers).read_text(encoding="utf-8"))
    scripts=json.loads(Path(args.speaker_scripts).read_text(encoding="utf-8"))
    speakers=[{"id":s["id"],"name":s.get("name"),"role":s.get("role"),"voice":s.get("voice"),"utterances":utterances(s)} for s in scripts["speakers"]]
    source_segments=[
      {"index":int(s["index"]),"start":round(float(s["start"]),2),"end":round(float(s["end"]),2),
       "source_speaker_id":s.get("speaker_id","unknown"),"text":s.get("text","")}
      for s in source.get("segments",[])
    ]
    input_hash=sha({"source":source_segments,"scripts":speakers})
    checkpoint=Path(args.out+".partial.json")
    done={}
    if checkpoint.is_file():
        old=json.loads(checkpoint.read_text(encoding="utf-8"))
        if old.get("input_sha256")==input_hash:
            done={int(x["source_segment_index"]):x for x in old.get("assignments",[])}
    keys=[os.environ.get("GEMINI_API_KEY",""),os.environ.get("GEMINI_API_KEY_2",""),os.environ.get("GEMINI_API_KEY_3","")]
    keys=[k for k in keys if k]
    if not keys: raise SystemExit("No Gemini API key is configured.")
    valid_ids={s["id"] for s in speakers}
    for off in range(0,len(source_segments),args.batch_size):
        batch=source_segments[off:off+args.batch_size]
        todo=[s for s in batch if int(s["index"]) not in done]
        if not todo: continue
        prompt=(
          "Align each Chinese source transcript segment to one exact utterance in the existing Arabic dubbing script. "
          "The Arabic text is an adaptation/translation of the spoken Chinese. Use meaning, chronological order, "
          "anonymous acoustic-speaker continuity, and the script's role descriptions. Script utterance indexes are 1-based "
          "within each speaker. Choose exactly one supplied speaker ID and utterance index for each source segment. "
          "Do not assume the anonymous source_speaker IDs correspond in number to the script roles. "
          "Reuse a consistent script ID for the same source voice where evidence supports it. Minor side characters may map "
          "to the grouped secondary female or male voice. If a line is music/noise/ambiguous or no script line fits, use "
          "speaker_script_id='unmatched', utterance_index=0, confidence=0. Confidence is 0..1; reason must be short. "
          "Return one assignment per source_segment_index in the supplied batch, with no missing or duplicate indexes.\\n\\n"
          "ARABIC SCRIPT CANDIDATES:\\n"+json.dumps(speakers,ensure_ascii=False,separators=(",",":"))+
          "\\n\\nCHINESE SOURCE SEGMENTS IN CHRONOLOGICAL ORDER:\\n"+json.dumps(todo,ensure_ascii=False,separators=(",",":"))
        )
        result=call_gemini(prompt,keys,args.model,args.max_output_tokens)
        returned=result.get("assignments",[])
        for a in returned:
            try: idx=int(a["source_segment_index"])
            except Exception: continue
            if idx not in {int(s["index"]) for s in todo}: continue
            sid=a.get("speaker_script_id","unmatched")
            if sid not in valid_ids: sid="unmatched"
            ui=int(a.get("utterance_index",0) or 0)
            if sid=="unmatched": ui=0
            done[idx]={
              "source_segment_index":idx,
              "speaker_script_id":sid,
              "utterance_index":ui,
              "confidence":max(0.0,min(1.0,float(a.get("confidence",0)))),
              "reason":str(a.get("reason",""))[:180]
            }
        # Persist after each Gemini request so a retry resumes after successful batches.
        atomic(checkpoint,{"input_sha256":input_hash,"model":args.model,"batch_size":args.batch_size,
                           "completed_batches":min(len(done),len(source_segments)),"assignments":[done[k] for k in sorted(done)]})
        missing={int(s["index"]) for s in todo}-set(done)
        if missing: raise RuntimeError(f"Gemini omitted {len(missing)} source segments in batch beginning at {off}.")
        print(f"Mapped {len(done)}/{len(source_segments)} source segments",flush=True)
    by_index={int(s["index"]):s for s in source.get("segments",[])}
    normalized=[]
    for idx,a in sorted(done.items()):
        src=by_index[idx]
        normalized.append({
          **a,
          "source_start":float(src["start"]),"source_end":float(src["end"]),
          "source_speaker_id":src.get("speaker_id"),"source_text":src.get("text","")
        })
    out={
      "method":"Gemini semantic and chronological alignment of Chinese ASR segments to pre-generated Arabic script utterances",
      "model":args.model,"source_segment_count":len(source_segments),
      "assignment_count":len(normalized),
      "unmatched_count":sum(1 for a in normalized if a["speaker_script_id"]=="unmatched"),
      "low_confidence_count":sum(1 for a in normalized if a["confidence"]<0.65),
      "input_sha256":input_hash,"assignments":normalized,
      "warning":"Automatic alignment proposal; low-confidence and unmatched lines require review."
    }
    atomic(Path(args.out),out)
    print(json.dumps({k:out[k] for k in ("source_segment_count","assignment_count","unmatched_count","low_confidence_count")},ensure_ascii=False))

if __name__=="__main__":
    main()
