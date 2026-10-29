#!/usr/bin/env python3
"""Map diarized Chinese source segments to the existing Arabic script lines with one Gemini JSON call."""
from __future__ import annotations
import argparse, json, os, re, time, urllib.request, urllib.error
from pathlib import Path

TAG = re.compile(r"<[^<>]+>")
BRACKET = re.compile(r"\[[^\]]*\]")
SPLIT = re.compile(r"\s*\.\.\.\s*")

def utterances(speaker):
    out=[]
    for raw in SPLIT.split(speaker.get("text","")):
        text=TAG.sub(" ",BRACKET.sub(" ",raw)).strip()
        text=re.sub(r"\s+"," ",text)
        if text:
            out.append({"utterance_index":len(out)+1,"text":text})
    return out

def call_gemini(prompt, keys, model, max_output_tokens):
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
    for key in keys:
        req=urllib.request.Request(url,data=body,headers={
          "Content-Type":"application/json","x-goog-api-key":key
        },method="POST")
        try:
            with urllib.request.urlopen(req,timeout=600) as resp:
                data=json.loads(resp.read().decode("utf-8"))
            text=data["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except urllib.error.HTTPError as exc:
            detail=exc.read().decode("utf-8","replace")[:1200]
            errors.append(f"HTTP {exc.code}: {detail}")
            if exc.code not in (401,403,429,500,503): break
        except Exception as exc:
            errors.append(type(exc).__name__+": "+str(exc)[:500])
    raise RuntimeError("Gemini alignment failed: "+" | ".join(errors))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source-speakers",required=True)
    ap.add_argument("--speaker-scripts",required=True)
    ap.add_argument("--out",required=True)
    ap.add_argument("--model",default="gemini-3.8-flash")
    ap.add_argument("--max-output-tokens",type=int,default=16384)
    args=ap.parse_args()
    source=json.loads(Path(args.source_speakers).read_text(encoding="utf-8"))
    scripts=json.loads(Path(args.speaker_scripts).read_text(encoding="utf-8"))
    speakers=[]
    for s in scripts["speakers"]:
        speakers.append({
          "id":s["id"],"name":s.get("name"),"role":s.get("role"),
          "voice":s.get("voice"),"utterances":utterances(s)
        })
    source_segments=[
      {"index":int(s["index"]),"start":round(float(s["start"]),2),
       "end":round(float(s["end"]),2),"source_speaker_id":s.get("speaker_id","unknown"),
       "text":s.get("text","")}
      for s in source.get("segments",[])
    ]
    prompt = (
      "You are aligning an automatic Chinese transcript of a drama with its already-produced Arabic dub script. "
      "The Arabic lines are translations/adaptations of the spoken dialogue, not subtitles. "
      "For EACH Chinese source segment, choose the single most likely Arabic speaker script ID and 1-based utterance index. "
      "Use scene/dialogue meaning, chronology, role continuity, and the anonymous acoustic source speaker ID together. "
      "The same source acoustic speaker should normally map consistently to the same Arabic script voice; secondary characters may share a grouped secondary track. "
      "A Chinese segment may correspond to part of an Arabic utterance, so keep monotonic progression within each speaker. "
      "Do not invent lines or force a match: when uncertain, use speaker_script_id='unmatched', utterance_index=0, confidence=0. "
      "confidence must be between 0 and 1. Keep reason very short. Return exactly one assignment for each source segment index, in chronological order. "
      "Never use source names/roles from inference: only the supplied Arabic script IDs are valid.\\n\\n"
      "ARABIC SCRIPT UTTERANCES (voice IDs and 1-based utterance indexes):\\n"
      + json.dumps(speakers,ensure_ascii=False,separators=(",",":"))
      + "\\n\\nCHINESE SOURCE SEGMENTS (include anonymous speaker and seconds):\\n"
      + json.dumps(source_segments,ensure_ascii=False,separators=(",",":"))
    )
    keys=[os.environ.get("GEMINI_API_KEY",""),os.environ.get("GEMINI_API_KEY_2",""),os.environ.get("GEMINI_API_KEY_3","")]
    keys=[k for k in keys if k]
    if not keys: raise SystemExit("No Gemini API key is configured.")
    result=call_gemini(prompt,keys,args.model,args.max_output_tokens)
    assigned=result.get("assignments",[])
    valid_ids={s["id"] for s in speakers}
    by_index={int(s["index"]):s for s in source.get("segments",[])}
    normalized=[]; seen=set()
    for a in assigned:
        idx=int(a["source_segment_index"])
        if idx not in by_index or idx in seen: continue
        sid=a["speaker_script_id"]
        if sid not in valid_ids: sid="unmatched"
        ui=int(a["utterance_index"])
        if sid=="unmatched": ui=0
        normalized.append({
          "source_segment_index":idx,
          "source_start":float(by_index[idx]["start"]),
          "source_end":float(by_index[idx]["end"]),
          "source_speaker_id":by_index[idx].get("speaker_id"),
          "source_text":by_index[idx].get("text",""),
          "speaker_script_id":sid,
          "utterance_index":ui,
          "confidence":max(0.0,min(1.0,float(a.get("confidence",0)))),
          "reason":str(a.get("reason",""))[:180]
        })
        seen.add(idx)
    missing=sorted(set(by_index)-seen)
    out={
      "method":"Gemini semantic and chronological alignment of Chinese ASR segments to pre-generated Arabic utterances",
      "model":args.model,
      "source_segment_count":len(source_segments),
      "assignment_count":len(normalized),
      "unmatched_count":sum(1 for a in normalized if a["speaker_script_id"]=="unmatched"),
      "missing_segment_indices":missing,
      "assignments":normalized,
      "warning":"This is an automatic semantic alignment proposal; low-confidence or unmatched lines must not be treated as verified."
    }
    p=Path(args.out); p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_suffix(".tmp"); tmp.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8"); tmp.replace(p)
    print(json.dumps({k:out[k] for k in ("method","source_segment_count","assignment_count","unmatched_count","missing_segment_indices")},ensure_ascii=False))

if __name__=="__main__":
    main()
