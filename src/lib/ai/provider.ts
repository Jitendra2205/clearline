import Anthropic from '@anthropic-ai/sdk';

/**
 * The one place the application talks to a model.
 *
 * Two providers behind one interface. The three AI loops call `runTool` and
 * `runToolLoop` and know nothing about which vendor is answering — swapping
 * models touches this file and nothing else, which was the claim and is now
 * the test.
 *
 * The interface is deliberately narrow: fill one schema, or run one tool loop.
 * Neither shape lets a model return a ranking, because nothing downstream would
 * read one.
 */

export type Provider = 'gemini' | 'anthropic';

export function provider(): Provider {
  const p = (process.env.CLEARLINE_PROVIDER ?? '').toLowerCase();
  if (p === 'anthropic') return 'anthropic';
  if (p === 'gemini') return 'gemini';
  // Infer from whichever key is present, so a single env var is enough.
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'anthropic';
}

const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: 'gemini-3.6-flash',
  anthropic: 'claude-opus-5',
};

export function model(): string {
  return process.env.CLEARLINE_MODEL ?? DEFAULT_MODEL[provider()];
}

/** Bumped whenever a prompt changes. Stamped onto every extraction for audit. */
export const PROMPT_VERSION = 'clearline-prompts-v5';

export function modelVersion(): string {
  return `${provider()}/${model()}/${PROMPT_VERSION}`;
}

export class ModelUnavailableError extends Error {}
export class ModelRefusedError extends Error {}

function requireKey(): string {
  const p = provider();
  const key = p === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new ModelUnavailableError(
      p === 'gemini'
        ? 'GEMINI_API_KEY is not set. The AI loops are real and will not run without it.'
        : 'ANTHROPIC_API_KEY is not set. The AI loops are real and will not run without it.',
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'file'; mime: string; base64: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema. Written once, translated per provider below. */
  schema: JsonSchema;
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  additionalProperties?: boolean;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Schema translation
// ---------------------------------------------------------------------------

/**
 * Gemini's function-declaration schema is a subset of JSON Schema. The gap that
 * matters here is nullability: this codebase leans on `type: ["string","null"]`
 * to say "absent in the source", and Gemini rejects the union — it wants
 * `nullable: true`. Getting this wrong would not error; it would quietly stop
 * the model being able to say "not stated", which is the single most important
 * thing it can say.
 */
export function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== 'null');
    out.type = (types[0] ?? 'string').toUpperCase();
    if (s.type.includes('null')) out.nullable = true;
  } else if (typeof s.type === 'string') {
    out.type = s.type.toUpperCase();
  }

  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum.map(String);

  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  if (s.required) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);

  // additionalProperties is not part of Gemini's dialect; dropping it is safe
  // because the response is re-validated with zod on ingest either way.
  return out;
}

function toAnthropicTool(t: ToolSpec): Anthropic.Tool {
  return {
    name: t.name,
    description: t.description,
    strict: true,
    input_schema: t.schema as Anthropic.Tool['input_schema'],
  };
}

// ---------------------------------------------------------------------------
// Single forced tool call — Loops 1, 2 and the semantic matcher
// ---------------------------------------------------------------------------

export interface ToolRun {
  input: unknown;
  usage: Usage;
  ms: number;
}

export async function runTool(opts: {
  system: string;
  parts: Part[];
  tool: ToolSpec;
  maxOutputTokens?: number;
}): Promise<ToolRun> {
  const started = Date.now();
  const run = provider() === 'gemini' ? geminiRunTool : anthropicRunTool;
  const r = await run(opts);
  return { ...r, ms: Date.now() - started };
}

async function geminiRunTool(opts: {
  system: string;
  parts: Part[];
  tool: ToolSpec;
  maxOutputTokens?: number;
}): Promise<Omit<ToolRun, 'ms'>> {
  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: opts.parts.map(toGeminiPart) }],
    tools: [{
      function_declarations: [{
        name: opts.tool.name,
        description: opts.tool.description,
        parameters: toGeminiSchema(opts.tool.schema),
      }],
    }],
    tool_config: {
      function_calling_config: { mode: 'ANY', allowed_function_names: [opts.tool.name] },
    },
    generationConfig: { temperature: 0, maxOutputTokens: opts.maxOutputTokens ?? 16000 },
  };

  const json = await geminiFetch(body);
  const cand = (json.candidates as GeminiCandidate[] | undefined)?.[0];

  if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') {
    throw new ModelRefusedError(
      'The model declined to process this document. It may contain content that tripped a safety filter — review the file by hand.',
    );
  }

  const call = (cand?.content?.parts ?? []).map((p) => p.functionCall).find(Boolean);
  if (!call) {
    throw new ModelUnavailableError(
      `Model returned no ${opts.tool.name} call${cand?.finishReason ? ` (finish: ${cand.finishReason})` : ''}.`,
    );
  }

  return { input: call.args, usage: geminiUsage(json) };
}

async function anthropicRunTool(opts: {
  system: string;
  parts: Part[];
  tool: ToolSpec;
  maxOutputTokens?: number;
}): Promise<Omit<ToolRun, 'ms'>> {
  const client = new Anthropic({ apiKey: requireKey(), maxRetries: 3 });

  const msg = (await client.beta.messages.create({
    model: model(),
    max_tokens: opts.maxOutputTokens ?? 16000,
    system: opts.system,
    thinking: { type: 'adaptive' },
    tools: [toAnthropicTool(opts.tool)],
    tool_choice: { type: 'tool', name: opts.tool.name },
    messages: [{ role: 'user', content: opts.parts.map(toAnthropicPart) }],
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  })) as unknown as Anthropic.Message;

  if (msg.stop_reason === 'refusal') {
    throw new ModelRefusedError('The model declined to process this document.');
  }

  const use = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.tool.name,
  );
  if (!use) throw new ModelUnavailableError(`Model returned no ${opts.tool.name} call.`);

  return {
    input: use.input,
    usage: {
      inputTokens: msg.usage?.input_tokens ?? 0,
      outputTokens: msg.usage?.output_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool loop — Loop 3, the analyst conversation
// ---------------------------------------------------------------------------

export interface LoopTurn {
  text: string;
  calls: { id: string; name: string; input: Record<string, unknown> }[];
}

export interface ToolLoop {
  /** One model turn. Returns narration and any tool calls it wants run. */
  next(): Promise<LoopTurn>;
  /** Feed results back and continue. */
  push(results: { id: string; name: string; output: unknown }[]): void;
}

export function startToolLoop(opts: {
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  tools: ToolSpec[];
}): ToolLoop {
  return provider() === 'gemini' ? geminiLoop(opts) : anthropicLoop(opts);
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /**
   * Gemini 3 attaches an opaque signature to each function call and rejects the
   * next turn if it is not echoed back. Reconstructing the model's turn from
   * name and args therefore fails the whole loop — the original part has to be
   * replayed verbatim, signature and all.
   */
  thoughtSignature?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

function geminiLoop(opts: {
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  tools: ToolSpec[];
}): ToolLoop {
  const contents: { role: string; parts: GeminiPart[] }[] = [
    ...opts.history.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })),
    { role: 'user', parts: [{ text: opts.question }] },
  ];

  let pendingCalls: { id: string; name: string }[] = [];

  return {
    async next(): Promise<LoopTurn> {
      const json = await geminiFetch({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents,
        tools: [{
          function_declarations: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: toGeminiSchema(t.schema),
          })),
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      });

      const cand = (json.candidates as GeminiCandidate[] | undefined)?.[0];
      const parts = cand?.content?.parts ?? [];

      const text = parts.map((p) => p.text ?? '').join('').trim();
      const calls = parts
        .map((p) => p.functionCall)
        .filter((c): c is NonNullable<GeminiPart['functionCall']> => Boolean(c))
        .map((c, i) => ({ id: `${c.name}-${i}`, name: c.name, input: c.args ?? {} }));

      if (calls.length > 0) {
        // Replay the model's own parts unchanged so each call keeps its
        // thoughtSignature. Rebuilding them from name and args loses it and the
        // next request is rejected outright.
        contents.push({ role: 'model', parts });
        pendingCalls = calls.map((c) => ({ id: c.id, name: c.name }));
      }

      return { text, calls };
    },

    push(results) {
      // Gemini expects one functionResponse per call, in a single user turn.
      contents.push({
        role: 'user',
        parts: results.map((r) => ({
          functionResponse: {
            name: r.name,
            response: { result: r.output },
          },
        })),
      });
      pendingCalls = [];
      void pendingCalls;
    },
  };
}

function anthropicLoop(opts: {
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  tools: ToolSpec[];
}): ToolLoop {
  const client = new Anthropic({ apiKey: requireKey(), maxRetries: 3 });
  const messages: Anthropic.MessageParam[] = [
    ...opts.history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
    { role: 'user', content: opts.question },
  ];
  let lastCallIds: string[] = [];

  return {
    async next(): Promise<LoopTurn> {
      const msg = (await client.beta.messages.create({
        model: model(),
        max_tokens: 16000,
        system: opts.system,
        thinking: { type: 'adaptive' },
        tools: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.schema as Anthropic.Tool['input_schema'],
        })),
        messages,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })) as unknown as Anthropic.Message;

      if (msg.stop_reason === 'refusal') {
        throw new ModelRefusedError('The model declined to answer this question.');
      }

      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      const uses = msg.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (uses.length > 0) messages.push({ role: 'assistant', content: msg.content });
      lastCallIds = uses.map((u) => u.id);

      return {
        text,
        calls: uses.map((u) => ({ id: u.id, name: u.name, input: u.input as Record<string, unknown> })),
      };
    },

    push(results) {
      // All results go back in ONE user message, per the parallel tool contract.
      messages.push({
        role: 'user',
        content: results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.id,
          content: JSON.stringify(r.output),
        })),
      });
      void lastCallIds;
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini transport
// ---------------------------------------------------------------------------

function toGeminiPart(p: Part): GeminiPart {
  return p.kind === 'text'
    ? { text: p.text }
    : { inline_data: { mime_type: p.mime, data: p.base64 } };
}

function toAnthropicPart(p: Part): Anthropic.ContentBlockParam {
  if (p.kind === 'text') return { type: 'text', text: p.text };
  if (p.mime === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: p.base64 },
    };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: p.mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
      data: p.base64,
    },
  };
}

function geminiUsage(json: Record<string, unknown>): Usage {
  const u = (json.usageMetadata ?? {}) as Record<string, number>;
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
  };
}

/** Retries on the transient failures that actually happen: 429 and 5xx. */
async function geminiFetch(body: unknown, attempt = 0): Promise<Record<string, unknown>> {
  const key = requireKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${key}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (attempt < 3) return backoff(body, attempt);
    throw new ModelUnavailableError(`Network error calling Gemini: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) return backoff(body, attempt);
    const detail = await res.text();
    throw new ModelUnavailableError(
      res.status === 429
        ? `Gemini rate limit or quota exhausted after ${attempt + 1} attempts. Free-tier quota resets daily; ${detail.slice(0, 160)}`
        : `Gemini returned ${res.status}: ${detail.slice(0, 160)}`,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (json.error) {
    const err = json.error as { message?: string; status?: string };
    throw new ModelUnavailableError(`Gemini error ${err.status ?? ''}: ${err.message ?? 'unknown'}`);
  }
  return json;
}

async function backoff(body: unknown, attempt: number): Promise<Record<string, unknown>> {
  const waitMs = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
  await new Promise((r) => setTimeout(r, waitMs));
  return geminiFetch(body, attempt + 1);
}
