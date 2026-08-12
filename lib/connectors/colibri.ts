/**
 * Colibri connector — local GLM-5.2 inference over Colibri's OpenAI-compatible
 * API (`coli serve` exposes /health, /v1/models and /v1/chat/completions).
 *
 * This is deliberately built on `fetch` rather than the AI SDK: the gateway
 * provider needs `ai`'s model registry, but a plain OpenAI-compatible endpoint
 * does not, and adding an extra provider package for one localhost URL is not
 * worth the dependency. Tool calling uses the standard OpenAI `tools` wire
 * format, which Colibri implements.
 */
import type { z } from 'zod';
import type { ConnectorStatus } from '@/lib/connectors/types';
import type { LlmChatResult, LlmProvider, LlmToolCall, LlmToolSpec } from '@/lib/connectors/llm';

export const COLIBRI_BASE_URL = () => process.env.COLIBRI_BASE_URL ?? 'http://127.0.0.1:8000/v1';
export const COLIBRI_MODEL = () => process.env.COLIBRI_MODEL ?? 'glm-5.2-colibri';
const COLIBRI_API_KEY = () => process.env.COLIBRI_API_KEY ?? '';

/** Max tool-call round trips, mirroring the gateway provider's stepCountIs(6). */
const MAX_STEPS = 6;

type JsonSchema = Record<string, unknown>;

/**
 * Minimal zod -> JSON Schema conversion, covering the shapes FounderOS actually
 * uses for tool parameters (flat objects of described scalars). Anything more
 * exotic degrades to a permissive object rather than throwing, so an unusual
 * tool loses its schema hints but never breaks the chat loop.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const typeName = def?.typeName as string | undefined;
  const description = (schema as unknown as { description?: string }).description;
  const withDesc = (s: JsonSchema): JsonSchema => (description ? { ...s, description } : s);

  switch (typeName) {
    case 'ZodString':
      return withDesc({ type: 'string' });
    case 'ZodNumber':
      return withDesc({ type: 'number' });
    case 'ZodBoolean':
      return withDesc({ type: 'boolean' });
    case 'ZodEnum':
      return withDesc({ type: 'string', enum: def?.values as string[] });
    case 'ZodArray':
      return withDesc({ type: 'array', items: zodToJsonSchema(def?.type as z.ZodTypeAny) });
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return zodToJsonSchema((def?.innerType as z.ZodTypeAny) ?? (schema as z.ZodTypeAny));
    case 'ZodObject': {
      const shapeFn = def?.shape as (() => Record<string, z.ZodTypeAny>) | undefined;
      const shape = typeof shapeFn === 'function' ? shapeFn() : {};
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        const inner = (value as unknown as { isOptional?: () => boolean }).isOptional;
        if (typeof inner !== 'function' || !inner.call(value)) required.push(key);
      }
      return withDesc({ type: 'object', properties, ...(required.length ? { required } : {}) });
    }
    default:
      return withDesc({ type: 'object', additionalProperties: true });
  }
}

type WireMessage = {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

async function post(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = COLIBRI_API_KEY();
  // coli enforces COLI_API_KEY when it is set, so always present it when we have one.
  if (key) headers.Authorization = `Bearer ${key}`;
  return fetch(`${COLIBRI_BASE_URL().replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function createColibriProvider(model: string = COLIBRI_MODEL()): LlmProvider {
  return {
    name: 'colibri',
    async chat(req): Promise<LlmChatResult> {
      const toolsByName = new Map((req.tools ?? []).map((t: LlmToolSpec) => [t.name, t]));
      const wireTools = (req.tools ?? []).map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: zodToJsonSchema(t.parameters),
        },
      }));

      const messages: WireMessage[] = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      for (const m of req.messages) {
        if (m.role === 'tool') continue;
        messages.push({ role: m.role, content: m.content });
      }

      const toolCalls: LlmToolCall[] = [];
      let text = '';

      for (let step = 0; step < MAX_STEPS; step++) {
        // A 744B MoE on local hardware is slow on first token — allow minutes,
        // not the seconds a hosted gateway would need.
        const res = await post(
          '/chat/completions',
          {
            model: req.model ?? model,
            messages,
            ...(wireTools.length ? { tools: wireTools, tool_choice: 'auto' } : {}),
          },
          300_000,
        );

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(
            `Colibri returned ${res.status} from ${COLIBRI_BASE_URL()}/chat/completions${
              detail ? ` — ${detail.slice(0, 300)}` : ''
            }`,
          );
        }

        const json = (await res.json()) as {
          choices?: { message?: WireMessage; finish_reason?: string }[];
        };
        const message = json.choices?.[0]?.message;
        if (!message) throw new Error('Colibri returned no choices.');

        text = message.content ?? '';
        const calls = message.tool_calls ?? [];
        if (calls.length === 0) return { text, toolCalls };

        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });

        for (const call of calls) {
          const spec = toolsByName.get(call.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            args = {};
          }
          let result: unknown;
          if (!spec) {
            result = { error: `unknown tool: ${call.function.name}` };
          } else {
            try {
              result = await spec.execute(args);
            } catch (err) {
              // Report the failure back to the model instead of aborting the
              // whole turn — the same latitude the SDK path gets.
              result = { error: err instanceof Error ? err.message : String(err) };
            }
          }
          toolCalls.push({ name: call.function.name, args, result });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: typeof result === 'string' ? result : JSON.stringify(result ?? null),
          });
        }
      }

      return { text, toolCalls };
    },
  };
}

export async function colibriStatus(): Promise<ConnectorStatus> {
  const base = { id: 'colibri', name: 'Colibri (local GLM-5.2)', kind: 'orchestration' } as const;
  const root = COLIBRI_BASE_URL().replace(/\/v1\/?$/, '');
  try {
    const health = await fetch(`${root}/health`, { signal: AbortSignal.timeout(2500) });
    if (!health.ok) {
      return { ...base, state: 'error', detail: `Colibri /health returned ${health.status}` };
    }
    const headers: Record<string, string> = {};
    const key = COLIBRI_API_KEY();
    if (key) headers.Authorization = `Bearer ${key}`;
    const models = await fetch(`${COLIBRI_BASE_URL().replace(/\/$/, '')}/models`, {
      headers,
      signal: AbortSignal.timeout(2500),
    });
    if (models.status === 401 || models.status === 403) {
      return {
        ...base,
        state: 'error',
        detail: 'Colibri is up but rejected COLIBRI_API_KEY — check the value in .env.local against stack.env.',
      };
    }
    const body = (await models.json().catch(() => null)) as { data?: { id: string }[] } | null;
    const ids = (body?.data ?? []).map((m) => m.id);
    return {
      ...base,
      state: 'connected',
      detail: `serving ${COLIBRI_MODEL()} at ${COLIBRI_BASE_URL()}`,
      meta: { models: ids.join(', ') || COLIBRI_MODEL() },
    };
  } catch {
    return {
      ...base,
      state: 'not_configured',
      detail: `No Colibri at ${root}. Start it with: launchctl kickstart -k gui/$(id -u)/com.jay.colibri`,
    };
  }
}
