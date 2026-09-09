import { EDITING_OPERATION_NAMES, type EditPlan, type EditingOperation } from './editingEngine.js';

const DEFAULT_PLAN: EditPlan = {
  version: 1,
  summary: 'لم يتم تنفيذ أي تعديل.',
  operations: [{ op: 'noop', reason: 'No editing instruction could be compiled.' }],
};

const operationProperties = {
  op: { type: 'string', enum: EDITING_OPERATION_NAMES },
  args: { type: 'object', additionalProperties: true },
  clipId: { type: ['string', 'null'] },
  trackId: { type: ['string', 'null'] },
  time: { type: ['number', 'null'] },
  startTime: { type: ['number', 'null'] },
  offset: { type: ['number', 'null'] },
  trimStart: { type: ['number', 'null'] },
  trimEnd: { type: ['number', 'null'] },
  speed: { type: ['number', 'null'] },
  volume: { type: ['number', 'null'] },
  muted: { type: ['boolean', 'null'] },
  opacity: { type: ['number', 'null'] },
  x: { type: ['number', 'null'] },
  y: { type: ['number', 'null'] },
  scaleX: { type: ['number', 'null'] },
  scaleY: { type: ['number', 'null'] },
  rotation: { type: ['number', 'null'] },
  anchorX: { type: ['number', 'null'] },
  anchorY: { type: ['number', 'null'] },
  left: { type: ['number', 'null'] },
  top: { type: ['number', 'null'] },
  right: { type: ['number', 'null'] },
  bottom: { type: ['number', 'null'] },
  mode: { type: ['string', 'null'] },
  text: { type: ['string', 'null'] },
  duration: { type: ['number', 'null'] },
  style: { type: ['object', 'null'] },
  label: { type: ['string', 'null'] },
  color: { type: ['string', 'null'] },
  effect: { type: ['string', 'null'] },
  params: { type: ['object', 'null'] },
  property: { type: ['string', 'null'] },
  value: {},
  fromClipId: { type: ['string', 'null'] },
  toClipId: { type: ['string', 'null'] },
  transitionType: { type: ['string', 'null'] },
  fps: { type: ['number', 'null'] },
  width: { type: ['number', 'null'] },
  height: { type: ['number', 'null'] },
  aspectRatio: { type: ['string', 'null'] },
  order: { type: ['number', 'null'] },
  name: { type: ['string', 'null'] },
  locked: { type: ['boolean', 'null'] },
  visible: { type: ['boolean', 'null'] },
  reason: { type: ['string', 'null'] },
  enabled: { type: ['boolean', 'null'] },
  count: { type: ['number', 'null'] },
};

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
        items: { type: 'object', additionalProperties: false, required: ['op'], properties: operationProperties },
      },
    },
  },
  strict: true,
};

const geminiTool = {
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
};

const SYSTEM_PROMPT = 'You are the deterministic editing director for a professional nonlinear video editor. Convert each user request into an ordered executable plan. Handle arbitrarily compound instructions by decomposing them into explicit supported operations. Preserve intent, use exact asset/clip/track IDs from the supplied timeline, prefer args for operation-specific parameters, and never invent media IDs. When a capability requires asynchronous analysis or rendering, emit its dedicated operation so the job system can execute it; never silently replace a requested capability with noop.';

function activeClips(timeline: any) {
  return (timeline?.tracks || []).flatMap((track: any) =>
    (track.clips || []).map((clip: any) => ({
      id: clip.id, type: clip.type || track.type, name: clip.name, startTime: clip.startTime, endTime: clip.endTime,
      duration: clip.duration, trimStart: clip.trimStart, trimEnd: clip.trimEnd, speed: clip.speed, volume: clip.volume,
      text: clip.text, trackId: track.id, trackType: track.type,
    })),
  );
}

function timelineContext(timeline: any) {
  return JSON.stringify({
    duration: timeline?.duration || 0,
    fps: timeline?.fps,
    width: timeline?.width,
    height: timeline?.height,
    tracks: activeClips(timeline),
  });
}

function firstLocalPlan(text: string, timeline: any): EditPlan {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const clips = activeClips(timeline);
  const clip = clips.find((c: any) => c.type === 'video') || clips[0];
  if (!clip) return { ...DEFAULT_PLAN, summary: 'أضف وسائط أولًا.' };
  const num = s.match(/(\d+(?:[.,]\d+)?)/)?.[1];
  const value = num ? Number(num.replace(',', '.')) : undefined;
  if (/قسّم|قسم|split/.test(s) && value !== undefined) return { version: 1, summary: `تقسيم المقطع عند ${value} ثانية`, operations: [{ op: 'split', clipId: clip.id, time: value }] };
  if (/احذف|حذف|remove|delete/.test(s)) return { version: 1, summary: 'حذف المقطع المحدد', operations: [{ op: 'delete_clip', clipId: clip.id }] };
  if (/حرّك|حرك|move/.test(s) && value !== undefined) return { version: 1, summary: `نقل المقطع إلى ${value} ثانية`, operations: [{ op: 'move_clip', clipId: clip.id, startTime: value }] };
  if (/سرعة|speed/.test(s) && value !== undefined) return { version: 1, summary: `تغيير السرعة إلى ${value}x`, operations: [{ op: 'set_speed', clipId: clip.id, speed: value }] };
  if (/قص|اقطع|trim/.test(s) && value !== undefined) return { version: 1, summary: `قص بداية المقطع بمقدار ${value} ثانية`, operations: [{ op: 'trim_clip', clipId: clip.id, trimStart: value }] };
  return DEFAULT_PLAN;
}

function cleanPlan(raw: any, timeline: any): EditPlan {
  const clips = activeClips(timeline);
  const defaultClip = clips.find((c: any) => c.type === 'video') || clips[0];
  const operations: EditingOperation[] = Array.isArray(raw?.operations)
    ? raw.operations.map((operation: any) => ({ ...operation, clipId: operation.clipId || defaultClip?.id }))
    : [];
  return {
    version: 1,
    summary: String(raw?.summary || 'تم بناء خطة المونتاج.'),
    operations: operations.length ? operations : [{ op: 'noop', reason: 'The model returned no operations.' }],
  } as EditPlan;
}

async function planWithGemini(text: string, timeline: any): Promise<EditPlan | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `TIMELINE=${timelineContext(timeline)}\nREQUEST=${text}` }] }],
        tools: [{ functionDeclarations: [geminiTool] }],
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [geminiTool.name] } },
        generationConfig: { temperature: 0 },
      }),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const call = parts.find((part: any) => part?.functionCall?.name === geminiTool.name);
    if (!call?.functionCall?.args) return null;
    return cleanPlan(call.functionCall.args, timeline);
  } catch {
    return null;
  }
}

async function planWithOpenAIProvider(text: string, timeline: any): Promise<EditPlan | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
          { role: 'user', content: [{ type: 'input_text', text: `TIMELINE=${timelineContext(timeline)}\nREQUEST=${text}` }] },
        ],
        tools: [tool],
        tool_choice: { type: 'function', name: tool.name },
      }),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const call = (data.output || []).find((item: any) => item.type === 'function_call' && item.name === tool.name);
    if (!call) return null;
    return cleanPlan(JSON.parse(call.arguments || '{}'), timeline);
  } catch {
    return null;
  }
}

export async function planWithAI(text: string, timeline: any): Promise<{ plan: EditPlan; provider: 'gemini' | 'openai' | 'local' }> {
  const gemini = await planWithGemini(text, timeline);
  if (gemini) return { plan: gemini, provider: 'gemini' };
  const openai = await planWithOpenAIProvider(text, timeline);
  if (openai) return { plan: openai, provider: 'openai' };
  return { plan: firstLocalPlan(text, timeline), provider: 'local' };
}

export async function planWithOpenAI(text: string, timeline: any): Promise<EditPlan> {
  return (await planWithAI(text, timeline)).plan;
}

export async function parseWithOpenAI(text: string, timeline: any, fallback: any) {
  const plan = await planWithOpenAI(text, timeline);
  const first = plan.operations.find(operation => operation.op !== 'noop');
  if (!first) return fallback;
  if (first.op === 'trim_clip' && typeof first.trimStart === 'number' && first.trimEnd == null) {
    return { type: 'trim_start', time: first.trimStart, clipId: first.clipId, message: 'تم تفسير أمر القص المتوافق.' };
  }
  return first;
}
