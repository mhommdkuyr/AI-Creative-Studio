import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { parseWithOpenAI } from './aiProvider.js';

export function registerAIRoute(app:Express, db:Database.Database){
  app.post('/api/projects/:id/ai-command', async (req,res)=>{
    const p:any=db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if(!p) return res.status(404).json({error:'Project not found'});
    const timeline=JSON.parse(p.timeline_json);
    const clips=timeline.tracks.find((t:any)=>t.type==='video')?.clips||[];
    const clip=clips[0];
    const fallback={type:'noop',message:'لم أفهم الأمر بعد.'};
    const command:any=await parseWithOpenAI(String(req.body?.text||''),timeline,fallback);
    if(command.type==='noop') return res.json({provider:'local',command,timeline});
    const out=structuredClone(timeline);
    const track=out.tracks.find((t:any)=>t.type==='video');
    const target=track?.clips?.find((c:any)=>c.id===command.clipId)||track?.clips?.[0];
    if(!target) return res.json({provider:'openai',command,timeline});
    if(command.type==='split'){ const t=Number(command.time); if(t>target.startTime&&t<target.endTime){ const second=structuredClone(target); second.id=crypto.randomUUID(); second.startTime=t; second.endTime=target.endTime; second.duration=second.endTime-second.startTime; target.endTime=t; target.duration=t-target.startTime; track.clips.splice(track.clips.indexOf(target),1,target,second); } }
    else if(command.type==='delete'){ track.clips=track.clips.filter((c:any)=>c.id!==target.id); }
    else if(command.type==='move'){ const s=Math.max(0,Number(command.startTime||0)); target.startTime=s; target.endTime=s+target.duration; }
    else if(command.type==='trim_start'){ const s=Math.max(0,Number(command.time||0)); if(s<target.trimEnd){ const d=s-target.trimStart; target.trimStart=s; target.startTime=Math.max(0,target.startTime+d); target.duration=target.endTime-target.startTime; } }
    else if(command.type==='trim_end'){ const e=Math.max(target.trimStart+.01,Number(command.time||target.trimEnd)); target.trimEnd=Math.min(e,target.trimEnd); target.endTime=target.startTime+(target.trimEnd-target.trimStart); target.duration=target.endTime-target.startTime; }
    out.duration=Math.max(0,...out.tracks.flatMap((t:any)=>t.clips.map((c:any)=>c.endTime)));
    const history=JSON.parse(p.history_json).slice(0,Number(p.history_index)+1); history.push(out); const bounded=history.slice(-100);
    db.prepare('UPDATE projects SET timeline_json=?,history_json=?,history_index=?,updated_at=? WHERE id=?').run(JSON.stringify(out),JSON.stringify(bounded),bounded.length-1,new Date().toISOString(),req.params.id);
    res.json({provider:process.env.OPENAI_API_KEY?'openai':'local',command,timeline:out});
  });
}
