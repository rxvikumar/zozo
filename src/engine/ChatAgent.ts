import { streamFromLLM } from './NetworkNode'
import { PipelineEventBus } from './PipelineEventBus'

export type ChatIntent = 'chat' | 'edit' | 'build'

const INTENT_SYSTEM = `You are an intent classifier for ZOZO, an AI coding assistant.
Given a user message, classify it into one of three categories:
- "chat": General conversation, greetings, questions, code explanations, debugging help, advice
- "edit": User wants to modify something specific in their EXISTING code (change color, fix bug, rename, update text)
- "build": User wants to BUILD or CREATE a brand new application, feature, or component from scratch

Respond with ONLY a single word: chat, edit, or build`

const CHAT_SYSTEM = `You are ZOZO, a highly intelligent AI coding assistant built into VS Code — similar to Cursor or GitHub Copilot but smarter.

You are talking to a developer. Be helpful, concise, and direct. 
- For coding questions: give clear answers with code examples where needed
- For greetings or small talk: be friendly and brief
- For debugging: analyze and explain clearly
- You have access to context about their workspace but are primarily a conversational assistant
- Format code with triple backticks and language name
- Keep responses focused and practical

You are NOT running a build pipeline. You are just chatting.`

const BUILD_PLAN_SYSTEM = `You are ZOZO, a world-class full-stack AI architect.
When a user wants to build something, you first present a clear implementation plan BEFORE writing any code.
Format your response as follows (use these exact section headers):

## What We'll Build
[1-2 sentence summary of what the app does]

## Tech Stack
[List the technologies, frameworks, and libraries we'll use and WHY]

## Features
[Bullet list of the key features that will be built]

## File Structure
[Show the key files/folders that will be created]

## Estimated Build Time
[How long the pipeline will take and what quality level is recommended]

End with: "**Ready to build? Type 'yes' or 'go' to start, or tell me what to change.**"

Be specific, practical, and impressive. This is a preview — no code yet.`

export class ChatAgent {
  /**
   * Classify intent of a user message
   */
  async classifyIntent(prompt: string, provider: string, apiKey: string): Promise<ChatIntent> {
    const p = prompt.toLowerCase().trim()

    // Fast keyword rules first (no LLM needed)
    const chatKeywords = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'what is', 'how do', 'explain', 'why does', 'what does', 'help me understand', 'can you', 'what are', 'how to', 'show me how']
    const buildKeywords = ['build', 'create', 'make me', 'generate', 'scaffold', 'from scratch', 'new app', 'new application', 'new project', 'build me', 'create me', 'write me a', 'develop']
    const editKeywords = ['change', 'update', 'fix', 'edit', 'modify', 'rename', 'replace', 'remove', 'delete the', 'make it', 'make the']

    if (chatKeywords.some(k => p.startsWith(k) || p === k)) return 'chat'
    if (buildKeywords.some(k => p.includes(k))) return 'build'
    if (editKeywords.some(k => p.startsWith(k))) return 'edit'

    // Word count heuristic: short prompts + no build signals = chat
    if (p.split(' ').length <= 4 && !buildKeywords.some(k => p.includes(k))) return 'chat'

    // Use LLM for ambiguous cases
    try {
      const result = await streamFromLLM(
        `User message: "${prompt}"`,
        provider,
        apiKey,
        INTENT_SYSTEM,
        { maxOutputTokens: 10 }
      )
      const trimmed = result.trim().toLowerCase()
      if (trimmed.includes('build')) return 'build'
      if (trimmed.includes('edit')) return 'edit'
      return 'chat'
    } catch {
      return 'chat'
    }
  }

  /**
   * Stream a conversational chat response via PipelineEventBus
   */
  async chat(
    prompt: string,
    provider: string,
    apiKey: string,
    workspaceContext?: string
  ): Promise<void> {
    const bus = PipelineEventBus.getInstance()
    const sessionId = 'chat-' + Date.now()

    bus.emit({ type: 'chat_start', sessionId })

    try {
      const contextNote = workspaceContext
        ? `\n\nWorkspace context: ${workspaceContext.slice(0, 500)}`
        : ''

      const response = await streamFromLLM(
        prompt + contextNote,
        provider,
        apiKey,
        CHAT_SYSTEM,
        { 
          maxOutputTokens: 2048,
          onChunk: (chunk) => bus.emit({ type: 'chat_chunk', sessionId, chunk })
        }
      )

      // NetworkNode now streams real chunks via PipelineEventBus,
      // so we just wait for the promise to resolve and then send the end event.
      bus.emit({ type: 'chat_end', sessionId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      bus.emit({ type: 'chat_system_message', sessionId, text: `❌ Error: ${msg}`, isError: true })
      bus.emit({ type: 'chat_end', sessionId })
    }
  }

  /**
   * Show an implementation plan for a build request (no code yet)
   */
  async showBuildPlan(
    prompt: string,
    provider: string,
    apiKey: string
  ): Promise<void> {
    const bus = PipelineEventBus.getInstance()
    const sessionId = 'plan-' + Date.now()

    // chat_start MUST come first — it creates the AI bubble in the webview
    bus.emit({ type: 'chat_start', sessionId })

    try {
      // Use real streaming via onChunk so content appears immediately (no silent wait)
      await streamFromLLM(
        `User wants to build: "${prompt}"\n\nCreate a detailed implementation plan.`,
        provider,
        apiKey,
        BUILD_PLAN_SYSTEM,
        {
          maxOutputTokens: 1500,
          onChunk: (chunk) => bus.emit({ type: 'chat_chunk', sessionId, chunk })
        }
      )

      bus.emit({ type: 'chat_end', sessionId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      bus.emit({ type: 'chat_chunk', sessionId, chunk: `\n\n❌ Error: ${msg}` })
      bus.emit({ type: 'chat_end', sessionId })
    }
  }
}

