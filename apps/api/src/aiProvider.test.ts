import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAIProviderConfig, parseWithOpenAI } from './aiProvider.js';

const previousKey = process.env.EXPLABS_API_KEY;
const previousModel = process.env.EXPLABS_MODEL;
const previousBase = process.env.EXPLABS_BASE_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (previousKey === undefined) delete process.env.EXPLABS_API_KEY;
  else process.env.EXPLABS_API_KEY = previousKey;
  if (previousModel === undefined) delete process.env.EXPLABS_MODEL;
  else process.env.EXPLABS_MODEL = previousModel;
  if (previousBase === undefined) delete process.env.EXPLABS_BASE_URL;
  else process.env.EXPLABS_BASE_URL = previousBase;
});

describe('Experiential Labs AI provider', () => {
  it('uses the gateway defaults and model slug from environment configuration', () => {
    process.env.EXPLABS_API_KEY = 'xpl_test_key';
    process.env.EXPLABS_MODEL = 'claude-fable-5.1';
    delete process.env.EXPLABS_BASE_URL;

    expect(getAIProviderConfig()).toEqual({
      provider: 'experiential-labs',
      configured: true,
      baseUrl: 'https://api.experientiallabs.ai/v1',
      model: 'claude-fable-5.1',
    });
  });

  it('sends an OpenAI-compatible chat completion and parses edit_timeline tool calls', async () => {
    process.env.EXPLABS_API_KEY = 'xpl_test_key';
    process.env.EXPLABS_MODEL = 'claude-fable-5.1';
    delete process.env.EXPLABS_BASE_URL;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              type: 'function',
              function: {
                name: 'edit_timeline',
                arguments: JSON.stringify({ type: 'move', startTime: 3, clipId: 'clip-1' }),
              },
            }],
          },
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

    const timeline = {
      tracks: [{ type: 'video', clips: [{ id: 'clip-1', startTime: 0, endTime: 5, duration: 5 }] }],
    };

    const result = await parseWithOpenAI('حرّك المقطع إلى 3', timeline, { type: 'noop' });

    expect(result).toMatchObject({ type: 'move', startTime: 3, clipId: 'clip-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.experientiallabs.ai/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer xpl_test_key');

    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('claude-fable-5.1');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'edit_timeline' } });
  });

  it('falls back to deterministic local parsing when the gateway fails', async () => {
    process.env.EXPLABS_API_KEY = 'xpl_test_key';
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('gateway unavailable'));

    const timeline = {
      tracks: [{ type: 'video', clips: [{ id: 'clip-1', startTime: 0, endTime: 5, duration: 5 }] }],
    };

    const result = await parseWithOpenAI('قص أول 1 ثانية', timeline, { type: 'noop' });
    expect(result.type).toBe('trim_start');
    expect(result.time).toBe(1);
    expect(result.clipId).toBe('clip-1');
  });
});
