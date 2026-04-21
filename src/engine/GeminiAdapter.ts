import type {
  LLMAdapter,
  LLMChatOptions,
  LLMStreamOptions,
  LLMMessage,
  LLMResponse,
  StreamEvent,
  ContentBlock,
  TextBlock,
} from '../lib/multi-agent/types'
import { streamFromLLM, type GeminiModel, GEMINI_MODELS } from './NetworkNode'

/**
 * GeminiAdapter
 *
 * Bridges ZOZO's existing Gemini infrastructure (NetworkNode.ts)
 * to the open-multi-agent LLMAdapter interface.
 *
 * Usage:
 *   const adapter = new GeminiAdapter(apiKey, GEMINI_MODELS.FLASH_FREE)
 *   const agent = new Agent({ name: 'planner', ... })
 */
export class GeminiAdapter implements LLMAdapter {
  private apiKey: string
  private defaultModel: GeminiModel
  readonly name = 'gemini'

  constructor(apiKey: string, model: GeminiModel = GEMINI_MODELS.FLASH_FREE) {
    this.apiKey = apiKey
    this.defaultModel = model
  }

  async chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse> {
    // Extract the last user message as the prompt
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    const prompt = lastUser
      ? this.extractText(lastUser.content)
      : ''

    const systemPrompt = options.systemPrompt ?? ''

    const text = await streamFromLLM(prompt, 'gemini', this.apiKey, systemPrompt, {
      geminiModel: this.defaultModel,
      maxOutputTokens: options.maxTokens ?? 8192,
    })

    // Gemini doesn't return token counts from the streamFromLLM wrapper
    // Estimate: ~4 chars per token
    const estimatedInput  = Math.round((prompt.length + systemPrompt.length) / 4)
    const estimatedOutput = Math.round(text.length / 4)

    return {
      id: `gemini-${Date.now()}`,
      content: [{ type: 'text' as const, text }],
      model: options.model ?? this.defaultModel,
      stop_reason: 'end_turn',
      usage: {
        input_tokens: estimatedInput,
        output_tokens: estimatedOutput,
      },
    }
  }

  async *stream(messages: LLMMessage[], options: LLMStreamOptions): AsyncIterable<StreamEvent> {
    // Falls back to non-streaming — yields the complete result as a single event
    const response = await this.chat(messages, options)
    const text = this.extractText(response.content)

    yield { type: 'text' as const, data: text }
    yield { type: 'done' as const, data: response }
  }

  /** Extract text from ContentBlock[] */
  private extractText(blocks: readonly ContentBlock[]): string {
    return blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
  }
}
