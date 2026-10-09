#!/usr/bin/env python3
"""Generate a custom instrumental score and time-coded Arabic synthetic dialogue for the episode."""
import json, math, random, subprocess, wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"output"; OUT.mkdir(exist_ok=True)
data=json.loads((OUT/"episode-script.json").read_text(encoding="utf-8"))
SR=24000
DURATION=60
N=SR*DURATION
MUSIC=OUT/"anime-score.wav"
random.seed(2301)
notes=[146.83,174.61,196.00,220.00,261.63,220.00,196.00,164.81,
       130.81,164.81,196.00,246.94,293.66,246.94,196.00,174.61]
events=[7.7,8.5,9.3,10.0,11.5,12.2,13.2,14.0,15.2,16.0,18.3,19.1,21.0,21.8,24.0,24.8,27.4,28.2,30.4,31.2,34.1,35.0,37.4,38.2,40.5,41.4,44.0,44.9,47.1,48.0,50.0,50.9,53.3,54.1,57.8,58.5,59.5]
hit_samples=[int(t*SR) for t in events]
print(f"Generating {DURATION}s stereo score at {SR} Hz...")
with wave.open(str(MUSIC),"wb") as wf:
    wf.setnchannels(2);wf.setsampwidth(2);wf.setframerate(SR)
    buf=bytearray()
    for i in range(N):
        t=i/SR
        beat=t%0.5
        chord=55.0 if int(t/4)%2==0 else 65.41
        drone=.11*math.sin(2*math.pi*chord*t)+.045*math.sin(2*math.pi*(chord*1.5)*t)
        note=notes[int(t*2.0)%len(notes)]
        note_env=.5+.5*math.sin(2*math.pi*.17*t)
        melody=.075*note_env*math.sin(2*math.pi*note*t)+.026*math.sin(2*math.pi*(note*2.01)*t)
        kick=.0
        if beat<.13:
            kick=.22*math.exp(-beat*28)*math.sin(2*math.pi*(48+20*math.exp(-beat*12))*t)
        snare=.0
        if .245<beat<.32:
            dt=beat-.245
            noise=math.sin(i*12.9898)*math.sin(i*78.233)
            snare=.065*math.exp(-dt*65)*noise
        impact=0.0
        # Short low-frequency hit and bright transient around each choreographed contact.
        for hs in hit_samples:
            d=(i-hs)/SR
            if 0<=d<.22:
                impact=max(impact,.2*math.exp(-d*24)*math.sin(2*math.pi*(72-20*d)*d))
                if d<.06: impact += .09*(1-d/.06)*math.sin(2*math.pi*980*d)
        shimmer=.018*math.sin(2*math.pi*(440+110*math.sin(2*math.pi*.07*t))*t)
        base=drone+melody+kick+snare+impact+shimmer
        l=max(-.92,min(.92,base*(.95+.05*math.sin(2*math.pi*.23*t))))
        r=max(-.92,min(.92,base*(.93+.07*math.sin(2*math.pi*.19*t+.4))))
        buf.extend(int(l*32767).to_bytes(2,"little",signed=True))
        buf.extend(int(r*32767).to_bytes(2,"little",signed=True))
        if len(buf)>=262144:
            wf.writeframesraw(buf);buf.clear()
    if buf:wf.writeframesraw(buf)

voice_dir=OUT/"dialogue";voice_dir.mkdir(exist_ok=True)
audio_inputs=[str(MUSIC)]
filters=[]
for idx,line in enumerate(data["dialogue"],1):
    start=float(line["start"])
    speaker=line["speaker"]
    text=line["text"]
    # Distinct synthetic character delivery through pitch and speed; this is not a claim of human recording.
    pitch={"GIRL":58,"DARK":42,"BLOND":52}.get(speaker,50)
    speed={"GIRL":158,"DARK":142,"BLOND":166}.get(speaker,155)
    clip=voice_dir/f"dialogue_{idx:02d}.wav"
    cmd=["espeak-ng","-v","ar","-s",str(speed),"-p",str(pitch),"-a","160","-w",str(clip),text]
    subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    audio_inputs += ["-i",str(clip)]
    inp=idx
    delay=round(start*1000)
    filters.append(f"[{inp}:a]aformat=channel_layouts=stereo,adelay={delay}|{delay},volume=1.45[d{idx}]")
labels="".join(f"[d{i}]" for i in range(1,len(data["dialogue"])+1))
filter_complex=";".join(filters)+f";[0:a]{labels}amix=inputs={len(data['dialogue'])+1}:duration=first:normalize=0,alimiter=limit=0.92[mix]"
MIX=OUT/"anime-episode-3d-audio.wav"
cmd=["ffmpeg","-hide_banner","-y","-i",str(MUSIC)]
cmd += audio_inputs[1:]
cmd += ["-filter_complex",filter_complex,"-map","[mix]","-t","60","-ar",str(SR),"-ac","2","-c:a","pcm_s16le",str(MIX)]
subprocess.run(cmd,check=True)
print(json.dumps({"score":str(MUSIC),"final_audio":str(MIX),"dialogue_lines":len(data["dialogue"]),"duration_seconds":60,"sample_rate":SR,"channels":2},ensure_ascii=False))
