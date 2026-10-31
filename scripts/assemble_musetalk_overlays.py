#!/usr/bin/env python3
"""Overlay completed MuseTalk clips onto the verified dubbed base video; preserve its audio."""
from __future__ import annotations
import argparse, json, subprocess, hashlib
from pathlib import Path


def build_filter_graph(clips):
    filters=[]
    prev='0:v'
    for i,c in enumerate(clips,1):
        start=float(c['source_start']); end=float(c['source_end'])
        filters.append(f"[{i}:v]setpts=PTS-STARTPTS+{start:.3f}/TB[c{i}]")
        out=f"v{i}"
        filters.append(f"[{prev}][c{i}]overlay=eof_action=pass:shortest=0:enable='between(t,{start:.3f},{end:.3f})'[{out}]")
        prev=f'[{out}]'
    return ';\n'.join(filters), prev


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--base-video',required=True)
    ap.add_argument('--plan',required=True)
    ap.add_argument('--clips-dir',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--allow-partial',action='store_true')
    args=ap.parse_args()
    plan=json.loads(Path(args.plan).read_text(encoding='utf-8'))
    clip_root=Path(args.clips_dir)
    done=[]; missing=[]
    for c in plan['clips']:
        p=clip_root/(c['clip_id']+'_lipsynced.mp4')
        if p.is_file() and p.stat().st_size>10000 and Path(str(p)+'.done').is_file():
            done.append((c,p))
        else: missing.append(c['clip_id'])
    if missing and not args.allow_partial:
        raise SystemExit(f"Refusing final assembly: {len(missing)} lip-sync clips are missing")
    if not done:
        raise SystemExit('No completed MuseTalk outputs found')
    graph, last=build_filter_graph([c for c,p in done])
    graph=graph+';\n'+last+'null[vout]'
    out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True)
    graph_path=out.with_suffix('.filter_complex.txt'); graph_path.write_text(graph,encoding='utf-8')
    cmd=['ffmpeg','-y','-i',args.base_video]
    for c,p in done: cmd += ['-i',str(p)]
    cmd += ['-filter_complex_script',str(graph_path),'-map','[vout]','-map','0:a?','-map','0:s?','-map_metadata','0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','copy','-c:s','copy','-shortest',str(out)]
    subprocess.run(cmd,check=True)
    coverage=sum(float(c['target_duration']) for c,p in done)
    total=float(plan.get('video_duration_seconds') or 0)
    report={'status':'PARTIAL_SAFE_LIPSYNC' if missing else 'ALL_SAFE_CANDIDATES_LIPSYNCED','output':str(out),'completed_clips':len(done),'planned_clips':len(plan['clips']),'missing_clips':missing,'lip_sync_seconds':round(coverage,3),'video_duration_seconds':total,'video_coverage_percent':round(100*coverage/total,2) if total else None,'audio_policy':'preserved original Arabic/music mix from base video; MuseTalk audio tracks were not muxed'}
    report_path=out.with_name(out.stem+'_manifest.json'); report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__': main()
