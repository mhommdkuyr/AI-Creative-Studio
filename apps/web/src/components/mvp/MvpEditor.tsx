import React, { useEffect, useMemo, useRef, useState } from 'react';

interface Asset { id:string; name:string; url:string; duration:number; }
interface Clip { id:string; assetId:string; name:string; startTime:number; endTime:number; trimStart:number; trimEnd:number; duration:number; }
interface Track { id:string; type:string; name:string; clips:Clip[]; }
interface Timeline { tracks:Track[]; duration:number; currentTime:number; }
interface Project { id:string; name:string; timeline:Timeline; assets:Asset[]; historyIndex:number; historyLength:number; }

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const api = (path:string) => `${API}${path}`;

export function MvpEditor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState('جاري تجهيز المحرر…');
  const [command, setCommand] = useState('');
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const videoTrack = useMemo(() => project?.timeline.tracks.find(t => t.type === 'video'), [project]);
  const clips = videoTrack?.clips || [];
  const selected = clips.find(c => c.id === selectedClip) || clips[0];
  const selectedAsset = project?.assets.find(a => a.id === selected?.assetId);

  useEffect(() => {
    (async () => {
      try {
        let id = projectId;
        if (id === 'new') {
          const created = await fetch(api('/api/projects'), { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ name:'AI Video Project' }) });
          id = (await created.json()).id;
          window.history.replaceState({}, '', `/project/${id}`);
        }
        const r = await fetch(api(`/api/projects/${id}`));
        if (!r.ok) throw new Error('project');
        setProject(await r.json());
        setStatus('جاهز للعمل');
      } catch { setStatus('تعذر الاتصال بالخادم المحلي'); }
    })();
  }, [projectId]);

  async function upload(files: FileList | null) {
    if (!files?.length || !project) return;
    setStatus('جاري استيراد الفيديو…');
    for (const file of Array.from(files)) {
      const form = new FormData(); form.append('file', file);
      const r = await fetch(api(`/api/projects/${project.id}/upload`), { method:'POST', body:form });
      if (!r.ok) { setStatus('فشل استيراد الملف'); return; }
      setProject(await r.json());
    }
    setStatus('تم استيراد الوسائط');
  }

  async function runCommand() {
    if (!project || !command.trim()) return;
    setStatus('جاري تنفيذ أمر AI…');
    const r = await fetch(api(`/api/projects/${project.id}/ai-command`), { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ text:command }) });
    if (!r.ok) { setStatus('فشل تنفيذ الأمر'); return; }
    const d = await r.json();
    setProject(p => p ? { ...p, timeline:d.timeline } : p);
    setStatus(`${d.command.message} • ${d.provider}`);
    setCommand('');
  }

  async function history(action:'undo'|'redo') {
    if (!project) return;
    const r = await fetch(api(`/api/projects/${project.id}/${action}`), { method:'POST' });
    if (r.ok) { setProject(await r.json()); setStatus(action === 'undo' ? 'تم التراجع' : 'تمت الإعادة'); }
  }

  async function render() {
    if (!project) return;
    setStatus('جاري تصدير MP4/H.264…');
    const r = await fetch(api(`/api/projects/${project.id}/render`), { method:'POST' });
    if (!r.ok) { setStatus('فشل التصدير'); return; }
    const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='ai-video-studio.mp4'; a.click(); URL.revokeObjectURL(url); setStatus('تم تصدير MP4 بنجاح');
  }

  function selectClip(clip:Clip) {
    setSelectedClip(clip.id);
    const asset = project?.assets.find(a=>a.id===clip.assetId);
    if (asset && videoRef.current) videoRef.current.src = api(asset.url);
  }

  useEffect(() => { if (selectedAsset && videoRef.current && !videoRef.current.src) videoRef.current.src=api(selectedAsset.url); }, [selectedAsset]);

  return <div className="h-full flex flex-col bg-canvas text-white">
    <div className="flex items-center gap-2 p-3 border-b border-border bg-surface-elevated flex-wrap">
      <button className="btn btn-primary" onClick={()=>inputRef.current?.click()}>استيراد فيديو</button>
      <input ref={inputRef} type="file" accept="video/*,audio/*" multiple className="hidden" onChange={e=>upload(e.target.files)} />
      <button className="btn" onClick={()=>history('undo')} disabled={!project || project.historyIndex<=0}>تراجع</button>
      <button className="btn" onClick={()=>history('redo')} disabled={!project || project.historyIndex>=project.historyLength-1}>إعادة</button>
      <button className="btn btn-primary" onClick={render} disabled={!selected}>تصدير MP4</button>
      <span className="text-xs text-white/50 ml-auto">{status}</span>
    </div>

    <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.4fr_.9fr] gap-3 p-3 min-h-0">
      <div className="min-h-0 flex flex-col gap-3">
        <div className="rounded-xl border border-border bg-black overflow-hidden flex-1 min-h-[280px] flex items-center justify-center">
          <video ref={videoRef} controls className="w-full h-full max-h-[58vh] object-contain bg-black" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} />
        </div>
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="p-3 flex items-center justify-between border-b border-border"><span className="font-semibold">Timeline</span><span className="text-xs text-white/40">{(project?.timeline.duration||0).toFixed(2)}s</span></div>
          <div className="p-3 space-y-2 max-h-[32vh] overflow-auto">
            {(project?.timeline.tracks||[]).map(track=><div key={track.id}>
              <div className="text-xs text-white/50 mb-1">{track.name}</div>
              <div className="relative h-10 rounded bg-[#090c12] border border-border">
                {track.clips.map(c=>{
                  const left=(project?.timeline.duration||1)>0?100*c.startTime/(project?.timeline.duration||1):0;
                  const width=(project?.timeline.duration||1)>0?100*c.duration/(project?.timeline.duration||1):0;
                  return <button key={c.id} onClick={()=>selectClip(c)} className={`absolute top-1 h-8 rounded px-2 text-left text-xs overflow-hidden ${c.id===selectedClip?'ring-2 ring-primary-400':'border border-white/10'} bg-primary-600/60`} style={{left:`${left}%`,width:`${Math.max(4,width)}%`}}>{c.name}</button>;
                })}
              </div>
            </div>)}
          </div>
        </div>
      </div>

      <aside className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-4 min-h-0">
        <div><div className="text-sm font-semibold mb-2">المساعد الذكي</div><div className="text-xs text-white/50">أوامر عربية مباشرة على الـTimeline. يعمل محليًا، ويمكن ربط OpenAI اختياريًا.</div></div>
        <div className="flex gap-2"><input className="flex-1 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm" value={command} onChange={e=>setCommand(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')runCommand()}} placeholder="مثال: قص أول 2 ثانية"/><button className="btn btn-primary" onClick={runCommand}>نفّذ</button></div>
        <div className="flex flex-wrap gap-2"><button className="btn text-xs" onClick={()=>setCommand('قسّم عند 2')}>Split عند 2s</button><button className="btn text-xs" onClick={()=>setCommand('احذف')}>Delete</button><button className="btn text-xs" onClick={()=>setCommand('حرّك إلى 3')}>Move إلى 3s</button><button className="btn text-xs" onClick={()=>setCommand('قص أول 1 ثانية')}>Trim 1s</button></div>
        <div className="mt-auto text-xs text-white/40">المشروع: {project?.name || '…'}<br/>المقاطع: {clips.length}<br/>حالة التشغيل: {playing?'تشغيل':'متوقف'}</div>
      </aside>
    </div>
  </div>;
}
