import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { chat, llmStatus } from '@/lib/connectors/llm';
import { colibriStatus, createColibriProvider, zodToJsonSchema } from '@/lib/connectors/colibri';

const ENV_KEYS = ['LLM_PROVIDER', 'COLIBRI_BASE_URL', 'COLIBRI_MODEL', 'COLIBRI_API_KEY'] as const;
const prev: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) prev[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
  vi.restoreAllMocks();
});

/** Build a fetch mock that returns the given chat-completion payloads in order. */
function mockCompletions(...payloads: unknown[]) {
  let i = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'glm-5.2-colibri' }] }), { status: 200 });
    }
    const body = payloads[Math.min(i, payloads.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe('zodToJsonSchema — tool parameter conversion', () => {
  test('converts a flat object of described strings', () => {
    const schema = zodToJsonSchema(
      z.object({
        webinarId: z.string().describe('WebinarJam webinar_id'),
        scheduleId: z.string().describe('schedule_id'),
      }),
    );
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        webinarId: { type: 'string', description: 'WebinarJam webinar_id' },
        scheduleId: { type: 'string', description: 'schedule_id' },
      },
    });
    expect(schema.required).toEqual(['webinarId', 'scheduleId']);
  });

  test('optional fields are omitted from required', () => {
    const schema = zodToJsonSchema(z.object({ a: z.string(), b: z.number().optional() }));
    expect(schema.required).toEqual(['a']);
    expect((schema.properties as Record<string, unknown>).b).toMatchObject({ type: 'number' });
  });

  test('unknown zod types degrade to a permissive object rather than throwing', () => {
    expect(() => zodToJsonSchema(z.map(z.string(), z.string()))).not.toThrow();
    expect(zodToJsonSchema(z.map(z.string(), z.string()))).toMatchObject({ type: 'object' });
  });
});

describe('colibri provider — OpenAI-compatible wire format', () => {
  test('returns assistant text and sends the bearer key', async () => {
    process.env.COLIBRI_BASE_URL = 'http://127.0.0.1:8000/v1';
    process.env.COLIBRI_API_KEY = 'test-key';
    const spy = mockCompletions({ choices: [{ message: { role: 'assistant', content: 'STACK_OK' } }] });

    const res = await createColibriProvider('glm-5.2-colibri').chat({
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(res.text).toBe('STACK_OK');
    expect(res.toolCalls).toEqual([]);
    const [, init] = spy.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  test('executes a tool call and feeds the result back for a second turn', async () => {
    process.env.COLIBRI_BASE_URL = 'http://127.0.0.1:8000/v1';
    mockCompletions(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"x"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { role: 'assistant', content: 'found it' } }] },
    );

    let received: unknown = 'NOT_CALLED';
    const res = await createColibriProvider().chat({
      messages: [{ role: 'user', content: 'look up x' }],
      tools: [
        {
          name: 'lookup',
          description: 'look something up',
          parameters: z.object({ query: z.string() }),
          execute: async (args) => {
            received = args;
            return { ok: true };
          },
        },
      ],
    });

    expect(received).toEqual({ query: 'x' });
    expect(res.toolCalls.map((c) => c.name)).toEqual(['lookup']);
    expect(res.text).toBe('found it');
  });

  test('a throwing tool is reported to the model instead of aborting the turn', async () => {
    mockCompletions(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'boom', arguments: '{}' } }],
            },
          },
        ],
      },
      { choices: [{ message: { role: 'assistant', content: 'recovered' } }] },
    );

    const res = await createColibriProvider().chat({
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          name: 'boom',
          description: 'always fails',
          parameters: z.object({}),
          execute: async () => {
            throw new Error('nope');
          },
        },
      ],
    });

    expect(res.text).toBe('recovered');
    expect(res.toolCalls[0].result).toMatchObject({ error: 'nope' });
  });

  test('a non-2xx response surfaces the endpoint and status', async () => {
    process.env.COLIBRI_BASE_URL = 'http://127.0.0.1:8000/v1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(
      createColibriProvider().chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/401/);
  });
});

describe('provider selection and status', () => {
  test('LLM_PROVIDER=colibri routes chat at Colibri, not the gateway', async () => {
    process.env.LLM_PROVIDER = 'colibri';
    process.env.COLIBRI_BASE_URL = 'http://127.0.0.1:8000/v1';
    const spy = mockCompletions({ choices: [{ message: { role: 'assistant', content: 'local' } }] });

    const res = await chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(res.text).toBe('local');
    expect(String(spy.mock.calls[0][0])).toContain('127.0.0.1:8000');
  });

  test('llmStatus reports the Colibri endpoint when colibri is selected', async () => {
    process.env.LLM_PROVIDER = 'colibri';
    process.env.COLIBRI_BASE_URL = 'http://127.0.0.1:8000/v1';
    mockCompletions();
    const status = await llmStatus();
    expect(status.id).toBe('llm');
    expect(status.name).toBe('LLM (Colibri)');
    expect(status.state).toBe('connected');
  });

  test('colibriStatus is not_configured when nothing is listening', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const status = await colibriStatus();
    expect(status.state).toBe('not_configured');
    expect(status.id).toBe('colibri');
  });

  test('colibriStatus flags a rejected API key distinctly from being down', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/health')) return new Response('{"status":"ok"}', { status: 200 });
      return new Response('forbidden', { status: 401 });
    });
    const status = await colibriStatus();
    expect(status.state).toBe('error');
    expect(status.detail).toMatch(/COLIBRI_API_KEY/);
  });
});
