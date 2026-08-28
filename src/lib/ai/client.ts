import Anthropic from '@anthropic-ai/sdk';

/**
 * Every model call in the product goes through this module.
 *
 * Swapping models, changing effort, or moving to a different provider touches
 * this file and nothing else — which is the only reason the three AI loops can
 * be reasoned about independently.
 */

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ModelUnavailableError(
        'ANTHROPIC_API_KEY is not set. Add it to .env.local — the AI loops are real and will not run without it.',
      );
    }
    _client = new Anthropic({ maxRetries: 3 });
  }
  return _client;
}

export class ModelUnavailableError extends Error {}

/**
 * Default is Opus 5. Set CLEARLINE_MODEL=claude-sonnet-5 for a cheaper run —
 * the eval harness reports accuracy per model, so the tradeoff is measurable
 * rather than assumed.
 */
export const MODEL = process.env.CLEARLINE_MODEL ?? 'claude-opus-5';

/** Bumped whenever a prompt changes. Stamped onto every extraction for audit. */
export const PROMPT_VERSION = 'clearline-prompts-v3';

export function modelVersion(): string {
  return `${MODEL}/${PROMPT_VERSION}`;
}

/**
 * Opus 5 can decline a request outright (stop_reason "refusal"). Server-side
 * fallbacks route those to another model rather than returning nothing —
 * relevant here because vendor documents are untrusted input and an injected
 * document could plausibly trip a classifier.
 */
export const FALLBACK_OPTS: {
  betas: Anthropic.Beta.AnthropicBeta[];
  fallbacks: Anthropic.Beta.Messages.BetaFallbacksParam;
} = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
};

export function isRefusal(msg: { stop_reason?: string | null }): boolean {
  return msg.stop_reason === 'refusal';
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export function usageOf(msg: {
  usage?: { input_tokens?: number; output_tokens?: number };
}): Usage {
  return {
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
  };
}
