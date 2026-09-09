import { EDITING_OPERATION_NAMES, type EditPlan, type EditingOperation } from './editingEngine.js';

const DEFAULT_PLAN: EditPlan = { version: 1, summary: 'لم يتم تنفيذ أي تعديل.', operations: [{ op: 'noop', reason: 'No editing instruction could be compiled.' }] };

const tool = {
  type: 'function',
  name: 'apply_edit_operations',
  description: 'Compile the user request into one deterministic ordered professional video-editing plan. Use multiple operations for compound requests. Every requested edit must be represented explicitly; never silently omit an operation.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'summary', 'operations'],
    properties: {
      version: { type: 'integer', enum: [1] },
      summary: { type: 'string' },
      operations: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object', additionalProperties: false, required: ['op'],
          properties: {
            op: { type: 'string', enum: EDITING_OPERATION_NAMES },
            args: { type: 'object', additionalProperties: true },
            clipId: { type: ['string','null'] }, trackId: { type: ['string','null'] }, time: { type: ['number','null'] }, startTime: { type: ['number','null'] }, offset: { type: ['number','null'] },
            trimStart: { type: ['number','null'] }, trimEnd: { type: ['number','null'] }, speed: { type: ['number','null'] }, volume: { type: ['number','null'] }, muted: { type: ['boolean','null'] }, opacity: { type: ['number','null'] },
            x: { type: ['number','null'] }, y: { type: ['number','null'] }, scaleX: { type: ['number','null'] }, scaleY: { type: ['number','null'] }, rotation: { type: ['number','null'] }, anchorX: { type: ['number','null'] }, anchorY: { type: ['number','null'] },
            left: { type: ['number','null'] }, top: { type: ['number','null'] }, right: { type: ['number','null'] }, bottom: { type: ['number','null'] }, mode: { type: ['string','null'] }, text: { type: ['string','null'] }, duration: { type: ['number','null'] },
            style: { type: ['object','null'] }, label: { type: ['string','null'] }, color: { type: ['string','null'] }, effect: { type: ['string','null'] }, params: { type: ['object','null'] }, property: { type: ['string','null'] }, value: {},
            fromClipId: { type: ['string','null'] }, toClipId: { type: ['string','null'] }, transitionType: { type: ['string','null'] }, fps: { type: ['number','null'] }, width: { type: ['number','null'] }, height: { type: ['number','null'] }, aspectRatio: { type: ['string','null'] }, order: { type: ['number','null'] }, name: { type: ['string','null'] }, locked: { type: ['boolean','null'] }, visible: { type: ['boolean','null'] }, reason: { type: ['string','null'] }
          }
        }
      }
    }
  }, strict: true
};

function activeClips(timeline: any) {
  return (timeline?.tracks || []).flatMap((track: any) => (track.clips || []).map((clip: any) => ({ id: clip.id, type: clip.type || track.type, name: clip.name, startTime: clip.startTime, endTime: clip.endTime, duration: clip.duration, trimStart: clip.trimStart, trimEnd: clip.trimEnd, speed: clip.speed, volume: clip.volume, text: clip.text, trackId: track.id, trackType: track.type })));
}

function firstLocalPlan(text: string, timeline: any): EditPlan {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const clips = activeClips(timeline); const clip = clips.find((c: any) => c.type === 'video') || clips[0];
  if (!clip) return { ...DEFAULT_PLAN, summary: 'أضف وسائط أولًا.' };
  const num = s.match(/(\d+(?:[.,]\d+)?)/)?.[1]; const value = num ? Number(num.replace(',', '.')) : undefined;
  if (/قسّم|قسم|split/.test(s) && value !== undefined) return { version: 1, summary: `تقسيم المقطع عند ${value} ثانية`, operations: [{ op: 'split', clipId: clip.id, time: value }] };
  if (/احذف|حذف|remove|delete/.test(s)) return { version: 1, summary: 'حذف المقطع المحدد', operations: [{ op: 'delete_clip', clipId: clip.id }] };
  if (/حرّك|حرك|move/.test(s) && value !== undefined) return { version: 1, summary: `نقل المقطع إلى ${value} ثانية`, operations: [{ op: 'move_clip', clipId: clip.id, startTime: value }] };
  if (/سرعة|speed/.test(s) && value !== undefined) return { version: 1, summary: `تغيير السرعة إلى ${value}x`, operations: [{ op: 'set_speed', clipId: clip.id, speed: value }] };
  if (/قص|اقطع|trim/.test(s) && value !== undefined) return { version: 1, summary: `قص بداية المقطع بمقدار ${value} ثانية`, operations: [{ op: 'trim_clip', clipId: clip.id, trimStart: value }] };
  return DEFAULT_PLAN;
}

function cleanPlan(raw: any, timeline: any): EditPlan {
  const clips = activeClips(timeline); const defaultClip = clips.find((c: any) => c.type === 'video') || clips[0];
  const operations: EditingOperation[] = Array.isArray(raw?.operations) ? raw.operations.map((operation: any) => ({ ...operation, clipId: operation.clipId || defaultClip?.id })) : [];
  return { version: 1, summary: String(raw?.summary || 'تم بناء خطة المونتاج.'), operations: operations.length ? operations : [{ op: 'noop', reason: 'The model returned no operations.' }] } as EditPlan;
}

export async function planWithOpenAI(text: string, timeline: any): Promise<EditPlan> {
  const local = firstLocalPlan(text, timeline); const key = process.env.OPENAI_API_KEY; if (!key) return local;
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, input: [
      { role: 'system', content: [{ type: 'input_text', text: 'You are the deterministic editing director for a professional nonlinear video editor. Convert each user request into an ordered executable plan. Handle arbitrarily compound instructions by decomposing them into explicit supported operations. Preserve intent, use exact asset/clip/track IDs from the supplied timeline, prefer args for operation-specific parameters, and never invent media IDs. When a capability requires asynchronous analysis/rendering, emit its dedicated operation so the job system can execute it; never silently replace it with noop.' }] },
      { role: 'user', content: [{ type: 'input_text', text: `TIMELINE=${JSON.stringify({ duration: timeline?.duration || 0, fps: timeline?.fps, width: timeline?.width, height: timeline?.height, tracks: activeClips(timeline) })}\nREQUEST=${text}` }] }
    ], tools: [tool], tool_choice: { type: 'function', name: 'apply_edit_operations' } }) });
    if (!response.ok) return local;
    const data: any = await response.json(); const call = (data.output || []).find((item: any) => item.type === 'function_call' && item.name === 'apply_edit_operations');
    if (!call) return local; return cleanPlan(JSON.parse(call.arguments || '{}'), timeline);
  } catch { return local; }
}

export async function parseWithOpenAI(text: string, timeline: any, fallback: any) {
  const plan = await planWithOpenAI(text, timeline); const first = plan.operations.find(operation => operation.op !== 'noop'); return first ? first : fallback;
}
