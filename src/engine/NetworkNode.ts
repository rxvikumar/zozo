// ─── ZOZO NetworkNode ─────────────────────────────────────────────────────────
// Handles all LLM communication: Gemini, OpenAI, Anthropic
// Model strings verified from ai.google.dev/gemini-api/docs/pricing (2026-03-26)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = `You are ZOZO, a deterministic VS Code orchestrator. You MUST output your code exclusively using this exact XML format: <zozo_action type="write" path="filepath.ts">CODE</zozo_action>. Do not write explanations outside the XML.`;

// ─── Gemini Model Registry ────────────────────────────────────────────────────
// FREE TIER  → Available with any free API key from aistudio.google.com
// PAID ONLY  → Requires billing enabled on Google AI Studio account
//
// Gemini 2.5 family = FREE  (default — works for everyone)
// Gemini 3.x family = PAID  (opt-in for users with billing enabled)

export const GEMINI_MODELS = {
  // ── FREE TIER (Normal mode — no billing required) ─────────────────────
  /** [FREE] gemini-1.5-flash — default for Normal mode. 1M ctx, fast, stable. */
  FLASH_FREE:      'gemini-1.5-flash',
  /** [FREE] gemini-1.5-flash-8b — fastest, cost-efficient */
  FLASH_LITE_FREE: 'gemini-1.5-flash-8b',
  /** [FREE] gemini-1.5-pro — best quality */
  PRO_FREE:        'gemini-1.5-pro',

  // ── PAID / FRONTIER TIER ──────
  PRO_ULTRA:            'gemini-1.5-pro',
  FLASH_ULTRA:          'gemini-2.0-flash',
  FLASH_LITE_ULTRA:     'gemini-1.5-flash-8b',
  PRO_CUSTOMTOOLS_ULTRA:'gemini-1.5-pro',
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

/**
 * Default model: gemini-2.5-flash
 * FREE tier — works with any API key from aistudio.google.com
 * Has 1M context window + thinking support. Ideal for ZOZO's pipeline.
 */
const DEFAULT_GEMINI_MODEL: GeminiModel = GEMINI_MODELS.FLASH_FREE;

// Module-level overrides — set by Orchestrator based on BuildProfile.selectedModel
let _geminiModelOverride: string | null = null;
let _anthropicModelOverride: string | null = null;
let _openaiModelOverride: string | null = null;

/** Set model overrides for all providers. Called by Orchestrator at pipeline start/end. */
export function setModelOverrides(gemini: string | null, anthropic: string | null, openai: string | null): void {
  _geminiModelOverride = gemini;
  _anthropicModelOverride = anthropic;
  _openaiModelOverride = openai;
}

/** @deprecated Use setModelOverrides instead. Kept for backward compat. */
export function setGeminiModelOverride(model: string | null): void {
  _geminiModelOverride = model;
}

/** Get the current effective Gemini model. */
export function getEffectiveGeminiModel(): string {
  return _geminiModelOverride ?? DEFAULT_GEMINI_MODEL;
}

export function getExplicitGeminiOverride(): string | null { return _geminiModelOverride; }
export function getExplicitAnthropicOverride(): string | null { return _anthropicModelOverride; }
export function getExplicitOpenaiOverride(): string | null { return _openaiModelOverride; }

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface LLMOptions {
  maxOutputTokens?: number;
  /** Force a specific Gemini model (e.g. flash-lite for fast structured planning) */
  geminiModel?: string;
  onChunk?: (chunk: string) => void;
  /** Enable extended thinking — lets the LLM reason before generating code */
  thinking?: boolean;
  /** Token budget for thinking (default: 4096). Higher = deeper reasoning, more cost. */
  thinkingBudget?: number;
}

// ─── Rate Limit Retry ─────────────────────────────────────────────────────────

/**
 * Retry with exponential backoff for rate limit errors.
 * RATE_LIMIT errors get 3 retries: 5s, 15s, 45s.
 * Other errors are rethrown immediately.
 */
async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> {
  const delays = [5_000, 15_000, 45_000]
  let lastError: unknown

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      const isRateLimit = msg.startsWith('RATE_LIMIT') ||
                          msg.includes('429') ||
                          msg.includes('503') ||
                          msg.includes('overloaded') ||
                          msg.includes('Service Unavailable') ||
                          msg.includes('RESOURCE_EXHAUSTED') ||
                          msg.includes('quota')

      if (!isRateLimit || attempt >= delays.length) throw err

      const waitMs = delays[attempt]!
      const waitSec = Math.round(waitMs / 1000)

      // Emit rate limit event through bus so UI can show feedback
      const { PipelineEventBus } = await import('./PipelineEventBus')
      const bus = PipelineEventBus.getInstance()
      const sid = bus.getCurrentSessionId()
      if (sid) {
        bus.emit({
          type: 'step_failed',
          sessionId: sid,
          stepName: label,
          error: `Rate limited \u2014 retrying in ${waitSec}s (attempt ${attempt + 1}/${delays.length})`,
        })
      }

      await new Promise(r => setTimeout(r, waitMs))
    }
  }

  throw lastError
}

// ─── Main LLM Router ─────────────────────────────────────────────────────────

export async function streamFromLLM(
  prompt: string,
  provider: string,
  apiKey: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  options: LLMOptions = {}
): Promise<string> {
  const maxTokens = options.maxOutputTokens ?? 8192;

  switch (provider.toLowerCase()) {

    // ── Gemini 3.x ───────────────────────────────────────────────────────────
    case "gemini": {
      return withRateLimitRetry(async () => {
        const model = options.geminiModel ?? _geminiModelOverride ?? DEFAULT_GEMINI_MODEL;
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

        // Extended thinking: Gemini 2.5 Flash/Pro support thinkingConfig natively
        const thinkingEnabled = options.thinking ?? false;
        const thinkingBudget = options.thinkingBudget ?? 4096;

        const generationConfig: Record<string, unknown> = {
          maxOutputTokens: maxTokens,
        };
        if (thinkingEnabled) {
          generationConfig.thinkingConfig = { thinkingBudget };
        }

        const body = {
          contents: [
            {
              parts: [{ text: `${systemPrompt}\n\n${prompt}` }],
            },
          ],
          generationConfig,
        };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 429 || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quota')) {
            throw new Error(`RATE_LIMIT: Gemini (${res.status}): ${errText.slice(0, 100)}`);
          }
          throw new Error(`Gemini API error (HTTP ${res.status}) [${model}]: ${errText}`);
        }

        if (!res.body) {
          throw new Error('Gemini returned no body');
        }

        // Stream tokens via PipelineEventBus
        const { PipelineEventBus } = await import('./PipelineEventBus')
        const bus = PipelineEventBus.getInstance()
        const sessionId = bus.getCurrentSessionId()

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''

        while (true) {
          if (bus.isCancelled()) {
            reader.cancel()
            throw new Error('Build cancelled by user')
          }
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          const lines = text.split('\n').filter(l => l.startsWith('data: '))

          for (const line of lines) {
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              // Gemini returns thinking in separate 'thought: true' parts — skip those
              const parts = parsed?.candidates?.[0]?.content?.parts ?? []
              for (const part of parts) {
                if (part.thought) continue;  // Skip thinking output
                const chunk = part.text ?? ''
                if (chunk) {
                  accumulated += chunk
                  if (options.onChunk) {
                    options.onChunk(chunk);
                  }
                  if (sessionId) {
                    bus.emit({ type: 'llm_chunk', sessionId, chunk, agentName: 'gemini' })
                  }
                }
              }
            } catch (err) {
              // Ignore JSON parse errors on incomplete chunks
            }
          }
        }

        return accumulated;
      }, 'gemini')
    }

    // ── OpenAI ───────────────────────────────────────────────────────────────
    case "openai": {
      return withRateLimitRetry(async () => {
        const openaiModel = _openaiModelOverride ?? 'gpt-4o-mini';
        const endpoint = "https://api.openai.com/v1/chat/completions";
        const body = {
          model: openaiModel,
          max_tokens: maxTokens,
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 429 || errText.includes('rate_limit') || errText.includes('quota')) {
            throw new Error(`RATE_LIMIT: OpenAI (${res.status}): ${errText.slice(0, 100)}`);
          }
          throw new Error(`OpenAI API error (HTTP ${res.status}): ${errText}`);
        }
        if (!res.body) {
          throw new Error('OpenAI returned no body');
        }

        const { PipelineEventBus } = await import('./PipelineEventBus')
        const bus = PipelineEventBus.getInstance()
        const sessionId = bus.getCurrentSessionId()

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''

        while (true) {
          if (bus.isCancelled()) {
            reader.cancel()
            throw new Error('Build cancelled by user')
          }
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          const lines = text.split('\n').filter(l => l.startsWith('data: '))

          for (const line of lines) {
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              const chunk = parsed?.choices?.[0]?.delta?.content ?? ''
              if (chunk) {
                accumulated += chunk
                if (options.onChunk) {
                  options.onChunk(chunk);
                }
                if (sessionId) {
                  bus.emit({ type: 'llm_chunk', sessionId, chunk, agentName: 'openai' })
                }
              }
            } catch (err) {
              // Ignore JSON parse errors on incomplete chunks
            }
          }
        }

        return accumulated;
      }, 'openai')
    }

    // ── Anthropic (SSE streaming) ────────────────────────────────────────────
    case "anthropic": {
      return withRateLimitRetry(async () => {
        const anthropicModel = _anthropicModelOverride ?? 'claude-3-5-sonnet-20241022';
        const endpoint = 'https://api.anthropic.com/v1/messages'

        // Extended thinking: Anthropic supports thinking blocks on Claude 3.5+ / Claude 4
        const thinkingEnabled = options.thinking ?? false;
        const thinkingBudget = options.thinkingBudget ?? 4096;

        const body: Record<string, unknown> = {
          model: anthropicModel,
          max_tokens: thinkingEnabled ? maxTokens + thinkingBudget : maxTokens,
          stream: true,
          system: [
            {
              type: 'text' as const,
              text: systemPrompt,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
          messages: [{ role: 'user' as const, content: prompt }],
        }

        if (thinkingEnabled) {
          body.thinking = {
            type: 'enabled',
            budget_tokens: thinkingBudget,
          };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': thinkingEnabled ? '2025-04-15' : '2023-06-01',
          },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const errText = await res.text()
          if (res.status === 429 || errText.includes('rate_limit') || errText.includes('RESOURCE_EXHAUSTED')) {
            throw new Error(`RATE_LIMIT: Anthropic (${res.status}): ${errText.slice(0, 100)}`)
          }
          throw new Error(`Anthropic API error (HTTP ${res.status}): ${errText}`)
        }

        if (!res.body) {
          throw new Error('Anthropic returned no body')
        }

        // Stream tokens via PipelineEventBus
        const { PipelineEventBus } = await import('./PipelineEventBus')
        const bus = PipelineEventBus.getInstance()
        const sessionId = bus.getCurrentSessionId()

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''

        while (true) {
          if (bus.isCancelled()) {
            reader.cancel()
            throw new Error('Build cancelled by user')
          }
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          const lines = text.split('\n').filter(l => l.startsWith('data: '))

          for (const line of lines) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              // Skip thinking content blocks — only accumulate text output
              if (parsed?.type === 'content_block_start' && parsed?.content_block?.type === 'thinking') continue;
              if (parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'thinking_delta') continue;
              const chunk: string = parsed?.delta?.text ?? ''
              if (chunk) {
                accumulated += chunk
                if (options.onChunk) {
                  options.onChunk(chunk);
                }
                if (sessionId) {
                  bus.emit({ type: 'llm_chunk', sessionId, chunk, agentName: 'anthropic' })
                }
              }
            } catch {}
          }
        }

        return accumulated
      }, 'anthropic')
    }

    default:
      throw new Error(
        `Unknown provider: "${provider}". Must be 'gemini', 'openai', or 'anthropic'.`
      );
  }
}

// ─── Structured JSON Output (tool_use enforced) ──────────────────────────────
// Uses Anthropic tool_use to FORCE schema compliance.
// The API physically cannot return arrays larger than maxItems.
// For Gemini/OpenAI, falls back to text + JSON parsing.

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export async function streamStructuredJSON<T>(
  prompt: string,
  provider: string,
  apiKey: string,
  systemPrompt: string,
  tool: ToolSchema,
): Promise<T> {
  const providerLower = provider.toLowerCase();

  if (providerLower === 'anthropic') {
    // ── Anthropic: tool_use forces structured JSON ──────────────────────
    return withRateLimitRetry(async () => {
      const anthropicModel = _anthropicModelOverride ?? 'claude-sonnet-5';
      const endpoint = 'https://api.anthropic.com/v1/messages';

      const body = {
        model: anthropicModel,
        max_tokens: 4096,
        system: systemPrompt,
        tools: [
          {
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
          },
        ],
        tool_choice: { type: 'tool' as const, name: tool.name },
        messages: [{ role: 'user' as const, content: prompt }],
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429 || errText.includes('rate_limit')) {
          throw new Error(`RATE_LIMIT: Anthropic structured (${res.status}): ${errText.slice(0, 100)}`);
        }
        throw new Error(`Anthropic structured API error (HTTP ${res.status}): ${errText}`);
      }

      const data = await res.json() as {
        content?: Array<{
          type: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
      };

      // Find the tool_use content block
      const toolBlock = data.content?.find(
        (b) => b.type === 'tool_use' && b.name === tool.name
      );

      if (!toolBlock?.input) {
        throw new Error('Anthropic returned no tool_use block');
      }

      return toolBlock.input as T;
    }, 'anthropic');
  }

  // ── Gemini/OpenAI: fallback to text + JSON parse ──────────────────────
  const raw = await streamFromLLM(prompt, provider, apiKey, systemPrompt);

  // Strip fences and extract JSON
  let clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1) clean = clean.substring(start, end + 1);

  return JSON.parse(clean) as T;
}

// ─── Convenience Wrappers ─────────────────────────────────────────────────────
// FREE TIER wrappers (work with any API key from aistudio.google.com)

/** [FREE] gemini-2.5-flash — DEFAULT. 1M ctx, thinking, fast. Best for ZOZO. */
export async function streamFromGeminiFlash(
  prompt: string,
  apiKey: string,
  systemPrompt?: string
): Promise<string> {
  return streamFromLLM(prompt, "gemini", apiKey, systemPrompt, {
    geminiModel: GEMINI_MODELS.FLASH_FREE,
  });
}

/** [FREE] gemini-2.5-flash-lite — fastest/cheapest free model, high-volume tasks */
export async function streamFromGeminiFlashLite(
  prompt: string,
  apiKey: string,
  systemPrompt?: string
): Promise<string> {
  return streamFromLLM(prompt, "gemini", apiKey, systemPrompt, {
    geminiModel: GEMINI_MODELS.FLASH_LITE_FREE,
  });
}

/** [FREE] gemini-2.5-pro — most capable free model, deep reasoning + coding */
export async function streamFromGeminiPro(
  prompt: string,
  apiKey: string,
  systemPrompt?: string
): Promise<string> {
  return streamFromLLM(prompt, "gemini", apiKey, systemPrompt, {
    geminiModel: GEMINI_MODELS.PRO_FREE,
  });
}

// ─── PAID TIER wrappers (requires billing enabled in Google AI Studio) ────────

/** [PAID] gemini-3.1-pro-preview — flagship 3.x, best reasoning, 1M ctx, 65K out */
export async function streamFromGeminiProPaid(
  prompt: string,
  apiKey: string,
  systemPrompt?: string
): Promise<string> {
  return streamFromLLM(prompt, "gemini", apiKey, systemPrompt, {
    geminiModel: GEMINI_MODELS.PRO_ULTRA,
  });
}

/** [PAID] gemini-3-flash-preview — frontier 3.x speed model */
export async function streamFromGeminiFlashPaid(
  prompt: string,
  apiKey: string,
  systemPrompt?: string
): Promise<string> {
  return streamFromLLM(prompt, "gemini", apiKey, systemPrompt, {
    geminiModel: GEMINI_MODELS.FLASH_ULTRA,
  });
}

/** [PAID] gemini-3.1-pro-preview-customtools — Pro optimized for custom tool calls */
export async function streamFromGeminiProCustomTools(
  prompt: string,
  apiKey: string,
  systemPrompt?: string
): Promise<string> {
  return streamFromLLM(prompt, "gemini", apiKey, systemPrompt, {
    geminiModel: GEMINI_MODELS.PRO_CUSTOMTOOLS_ULTRA,
  });
}
