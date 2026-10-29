#!/usr/bin/env python3
"""Align the already-generated Arabic WAV master words to their ordered script utterances."""
from __future__ import annotations
import argparse,difflib,json,re,unicodedata
from pathlib import Path

SEP=re.compile(r"\s*\.\.\.\s*")
TAG=re.compile(r"<[^<>]+>")
BRACKET=re.compile(r"\[[^\]]*\]")
TOKEN=re.compile(r"[\u0600-\u06FF]+|[0-9]+")

def clean_text(s:str)->str:
    s=TAG.sub(" ",s)
    s=BRACKET.sub(" ",s)
    s=s.replace("ـ","")
    s="".join(c for c in unicodedata.normalize("NFKD",s) if not unicodedata.combining(c))
    s=s.translate(str.maketrans({"أ":"ا","إ":"ا","آ":"ا","ٱ":"ا","ى":"ي","ؤ":"و","ئ":"ي","ة":"ه"}))
    return s

def tokens(s:str)->list[str]:
    return TOKEN.findall(clean_text(s))

def split_turns(speaker:dict)->list[str]:
    out=[]
    for raw in SEP.split(speaker.get("text","")):
        raw=raw.strip()
        if not raw: continue
        raw=BRACKET.sub(" ",raw)
        raw=TAG.sub(" ",raw)
        if tokens(raw): out.append(raw.strip())
    return out

def load_actual(path:Path):
    data=json.loads(path.read_text(encoding="utf-8"))
    words=[]
    for seg in data.get("segments",[]):
        for w in seg.get("words",[]):
            t=tokens(w.get("text",""))
            for token in t:
                words.append({"token":token,"start":w["start"],"end":w["end"],"probability":w.get("probability")})
    return data,words

def align_one(speaker,voice_data,voice_words):
    turns=split_turns(speaker)
    expected=[]; turn_ranges=[]
    for i,text in enumerate(turns):
        start=len(expected)
        expected.extend(tokens(text))
        turn_ranges.append((start,len(expected),text))
    e=[x for x in expected]
    a=[x["token"] for x in voice_words]
    matcher=difflib.SequenceMatcher(None,e,a,autojunk=False)
    mapping={}
    for block in matcher.get_matching_blocks():
        for j in range(block.size):
            mapping[block.a+j]=block.b+j
    rows=[]
    total_matched=0
    for i,(lo,hi,text) in enumerate(turn_ranges,1):
        mapped=[(k,mapping[k]) for k in range(lo,hi) if k in mapping]
        coverage=len(mapped)/max(1,hi-lo)
        if mapped:
            ai=[j for _,j in mapped]
            start=min(voice_words[j]["start"] for j in ai)
            end=max(voice_words[j]["end"] for j in ai)
            start_word=min(ai); end_word=max(ai)
        else:
            start=end=None; start_word=end_word=None
        missing=[e[k] for k in range(lo,hi) if k not in mapping]
        total_matched+=len(mapped)
        rows.append({
            "utterance_index":i,"text":text,
            "track_start_seconds":round(start,3) if start is not None else None,
            "track_end_seconds":round(end,3) if end is not None else None,
            "duration_seconds":round(end-start,3) if start is not None else None,
            "word_alignment_coverage":round(coverage,3),
            "first_asr_word_index":start_word,"last_asr_word_index":end_word,
            "unmatched_expected_words":missing[:20]
        })
    return {
        "speaker_id":speaker.get("id"),"speaker_name":speaker.get("name"),
        "role":speaker.get("role"),"voice":speaker.get("voice"),
        "track_file":voice_data.get("file"),
        "track_duration_seconds":voice_data.get("duration_seconds"),
        "track_asr_word_count":len(voice_words),
        "expected_utterance_count":len(turns),
        "expected_word_count":len(expected),
        "matched_word_count":total_matched,
        "overall_word_alignment_coverage":round(total_matched/max(1,len(expected)),3),
        "utterances":rows
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--speakers-json",required=True)
    ap.add_argument("--voice-asr-dir",required=True)
    ap.add_argument("--out",required=True)
    args=ap.parse_args()
    src=json.loads(Path(args.speakers_json).read_text(encoding="utf-8"))
    voice_dir=Path(args.voice_asr_dir)
    track_results=[]
    for n,speaker in enumerate(src["speakers"],1):
        matches=list(voice_dir.glob(f"{n:02d}_*.json"))
        if len(matches)!=1:
            track_results.append({"speaker":speaker.get("name"),"status":"missing_or_ambiguous_asr_file","candidates":[p.name for p in matches]})
            continue
        v,words=load_actual(matches[0])
        track_results.append(align_one(speaker,v,words))
    out={"method":"Whisper word timestamps + monotonic sequence matching against the supplied Arabic speaker script",
         "tracks":track_results,
         "warning":"This aligns words inside the Arabic WAV masters only. It does not assign them to Chinese source timecodes or validate character identity in the video."}
    Path(args.out).parent.mkdir(parents=True,exist_ok=True)
    Path(args.out).write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"output":args.out,"tracks":len(track_results),
        "overall_coverage":[{"speaker":x.get("speaker_name"),"coverage":x.get("overall_word_alignment_coverage")} for x in track_results]},ensure_ascii=False))

if __name__=="__main__": main()
