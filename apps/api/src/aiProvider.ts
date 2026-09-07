export type EditCommand = {
  type: 'split' | 'delete' | 'move' | 'trim_start' | 'trim_end' | 'noop';
  time?: number;
  startTime?: number;
  clipId?: string;
  message?: string;
};

const EXPERIENTIAL_BASE_URL = 'https://api.experientiallabs.ai/v1';
const DEFAULT_MODEL = 'claude-fable-5.1';
const REQUEST_TIMEOUT_MS = 30_000;

function localCommand(text: string, clip: any): EditCommand {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const num = s.match(/(\d+(?:[.,]\d+)?)/)?.[1];
  if (!clip) return { type: 'noop', message: 'أضف فيديو أولًا حتى أستطيع تعديل الـTimeline.' };
  if (/split|قسّم|قسم/.test(s) && num) return { type: 'split', time: Number(num.replace(',', '.')), clipId: clip.id, message: `قسّمت المقطع عند ${num} ثانية.` };
  if (/delete|remove|احذف|حذف/.test(s)) return { type: 'delete', clipId: clip.id, message: 'حذفت المقطع المحدد.' };
  if (/move|حرّك|حرك/.test(s) && num) return { type: 'move', startTime: Number(num.replace(',', '.')), clipId: clip.id, message: `نقلت المقطع إلى ${num} ثانية.` };
  if (/trim|قص|اقطع|أول/.test(s) && num) return { type: 'trim_start', time: Number(num.replace(',', '.')), clipId: clip.id, message: `قصصت بداية المقطع إلى ${num} ثانية.` };
  return { type: 'noop', message: 'لم أفهم الأمر بعد.' };
}

function configuredApiKey() {
  return process.env.EXPLABS_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
}

function configuredBaseUrl() {
  return (process.env.EXPLABS_BASE_URL?.trim() || EXPERIENTIAL_BASE_URL).replace(/\/$/, '');
}

function configuredModel() {
  return process.env.EXPLABS_MODEL?.trim() || DEFAULT_MODEL;
}

export function getAIProviderConfig() {
  const key = configuredApiKey();
  return {
    provider: process.env.EXPLABS_API_KEY ? 'experiential-labs' : process.env.OPENAI_API_KEY ? 'openai-compat' : 'local',
    configured: Boolean(key),
    baseUrl: configuredBaseUrl(),
    model: configuredModel(),
  };
}

export async function parseWithOpenAI(text: string, timeline: any, fallback: EditCommand): Promise<EditCommand> {
  const clip = timeline?.tracks?.find((t: any) => t.type === 'video')?.clips?.[0];
  const local = localCommand(text, clip);
  const key = configuredApiKey();
  if (!key) return local.type === 'noop' ? fallback : local;

  const model = configuredModel();
  const tool = {
    type: 'function',
    name: 'edit_timeline',
    description: 'Change the active video timeline clip.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['split', 'delete', 'move', 'trim_start', 'trim_end', 'noop'] },
        time: { type: 'number', minimum: 0 },
        startTime: { type: 'number', minimum: 0 },
        clipId: { type: 'string' },
      },
      required: ['type'],
      additionalProperties: false,
    },
    strict: true,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${configuredBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'You control a video editor. Use the edit_timeline tool to translate the user request into one precise timeline command. Return only tool arguments.',
          },
          {
            role: 'user',
            content: `Active clip: ${JSON.stringify(clip || {})}\nUser request: ${text}`,
          },
        ],
        tools: [tool],
        tool_choice: { type: 'function', function: { name: 'edit_timeline' } },
      }),
      signal: controller.signal,
    });

    if (!response.ok) return local.type === 'noop' ? fallback : local;

    const data: any = await response.json();
    const call = (data.choices?.[0]?.message?.tool_calls || []).find(
      (item: any) => item.type === 'function' && item.function?.name === 'edit_timeline',
    );
    if (!call) return local.type === 'noop' ? fallback : local;

    const args = JSON.parse(call.function?.arguments || '{}');
    return {
      ...args,
      clipId: args.clipId || clip?.id,
      message: 'تم تفسير الأمر عبر نموذج الذكاء الاصطناعي.',
    } as EditCommand;
  } catch {
    return local.type === 'noop' ? fallback : local;
  } finally {
    clearTimeout(timeout);
  }
}
