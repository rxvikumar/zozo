/**
 * IntentResolver — Phase 2 Follow-up Intelligence
 *
 * Classifies every user message with full context:
 *   - conversation history (last N turns)
 *   - current project files
 *   - active decision ledger
 *
 * Output is a structured ResolvedIntent that routes:
 * NEW_BUILD | ADD_FEATURE | MODIFY_STYLE | MODIFY_LOGIC | FIX_BUG | EXPLAIN | UNDO | CHAT
 */

import { streamFromLLM } from './NetworkNode'

export type IntentOperation =
  | 'NEW_BUILD'
  | 'ADD_FEATURE'
  | 'MODIFY_STYLE'
  | 'MODIFY_LOGIC'
  | 'FIX_BUG'
  | 'EXPLAIN'
  | 'UNDO'
  | 'CHAT'

export interface ResolvedIntent {
  operation: IntentOperation
  description: string
  targetFiles: string[]
  preserve: string[]
  needsClarification: boolean
  clarificationQuestion: string
  confidence: number
  scope: 'file' | 'component' | 'feature' | 'project'
  resolvesPendingQuestion: string | null
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface Decision {
  key: string
  value: string
  timestamp: number
  supersedes?: string
}

export interface PendingQuestion {
  id: string
  question: string
  expectedAnswerKey: string
  options?: string[]
  createdAt: number
}

const RESOLVER_SYSTEM = `You are an intent resolver for ZOZO, a VS Code AI coding assistant.

Given a user message + conversation history + project context, classify into structured JSON.

OPERATIONS:
- NEW_BUILD: Build something new from scratch
- ADD_FEATURE: Add a feature/component to existing project
- MODIFY_STYLE: Visual/style change only (colors, fonts, spacing, animations)
- MODIFY_LOGIC: Logic/functionality change
- FIX_BUG: Fix a specific error or broken behavior
- EXPLAIN: User wants explanation, not code changes
- UNDO: Revert something
- CHAT: General question or conversation

REFERENCE RESOLUTION:
- "it", "that", "the app" = the most recently discussed component/project
- "make it more attractive" = MODIFY_STYLE on most recent subject
- "add a calendar too" = ADD_FEATURE, preserve everything else
- "keep the sidebar as it is" = add sidebar to preserve list
- "actually use light mode" = MODIFY_STYLE, supersedes previous theme

CLARIFICATION POLICY — only ask if BOTH are true:
1. Two very different interpretations would produce substantially different code
2. The impact of wrong choice is high and not easily reversible
Do NOT ask if a sensible default exists and the change is easy to undo.

Return ONLY valid JSON — no other text:
{
  "operation": "NEW_BUILD|ADD_FEATURE|MODIFY_STYLE|MODIFY_LOGIC|FIX_BUG|EXPLAIN|UNDO|CHAT",
  "description": "One sentence describing what to do",
  "targetFiles": [],
  "preserve": [],
  "needsClarification": false,
  "clarificationQuestion": "",
  "confidence": 85,
  "scope": "file|component|feature|project",
  "resolvesPendingQuestion": null
}`

export class IntentResolver {

  async resolve(
    message: string,
    history: ConversationTurn[],
    projectFiles: string[],
    decisions: Decision[],
    pending: PendingQuestion | null,
    provider: string,
    apiKey: string
  ): Promise<ResolvedIntent> {
    const p = message.toLowerCase().trim()

    // Fast-path: pure chat starters
    const chatStarters = ['hi', 'hello', 'hey', 'thanks', 'what is', 'how do', 'explain', 'why does', 'what does', 'help me', 'what are', 'how to', 'show me how', 'can you tell']
    if (chatStarters.some(k => p.startsWith(k))) return this._chatIntent(message)

    // Fast-path: undo
    if (/\b(undo|revert|go back|restore|roll back)\b/.test(p)) {
      return { operation: 'UNDO', description: 'Revert the last change', targetFiles: [], preserve: [], needsClarification: false, clarificationQuestion: '', confidence: 90, scope: 'project', resolvesPendingQuestion: null }
    }

    // Check if this answers a pending question
    let resolvesPending: string | null = null
    if (pending) {
      const score = this._scoreAsAnswer(message, pending)
      if (score > 0.6) resolvesPending = pending.id
    }

    // Build LLM context
    const historyStr = history.slice(-8).map(t => `${t.role.toUpperCase()}: ${t.content.slice(0, 300)}`).join('\n')
    const decisionsStr = decisions.length > 0 ? decisions.map(d => `- ${d.key}: ${d.value}`).join('\n') : 'None yet'
    const filesStr = projectFiles.length > 0 ? projectFiles.slice(0, 20).join(', ') : 'No project open'
    const pendingStr = pending ? `PENDING QUESTION: "${pending.question}" (key: ${pending.expectedAnswerKey})` : 'None'

    const contextPrompt = `CONVERSATION HISTORY:\n${historyStr || 'First message.'}\n\nPROJECT FILES:\n${filesStr}\n\nDECISION LEDGER:\n${decisionsStr}\n\nPENDING CLARIFICATION:\n${pendingStr}\n\nUSER MESSAGE: "${message}"\n\nReturn JSON only.`

    try {
      const raw = await streamFromLLM(contextPrompt, provider, apiKey, RESOLVER_SYSTEM, { maxOutputTokens: 400 })
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON')
      const parsed = JSON.parse(jsonMatch[0]) as ResolvedIntent
      const validOps: IntentOperation[] = ['NEW_BUILD', 'ADD_FEATURE', 'MODIFY_STYLE', 'MODIFY_LOGIC', 'FIX_BUG', 'EXPLAIN', 'UNDO', 'CHAT']
      if (!validOps.includes(parsed.operation)) parsed.operation = 'CHAT'
      parsed.confidence = Math.max(0, Math.min(100, parsed.confidence ?? 70))
      parsed.targetFiles = Array.isArray(parsed.targetFiles) ? parsed.targetFiles : []
      parsed.preserve = Array.isArray(parsed.preserve) ? parsed.preserve : []
      parsed.resolvesPendingQuestion = resolvesPending
      return parsed
    } catch {
      return this._fallbackClassify(message, resolvesPending)
    }
  }

  toLegacyMode(intent: ResolvedIntent): 'chat' | 'edit' | 'build' {
    switch (intent.operation) {
      case 'NEW_BUILD': return 'build'
      case 'ADD_FEATURE': return 'build'
      case 'MODIFY_STYLE': return 'edit'
      case 'MODIFY_LOGIC': return 'edit'
      case 'FIX_BUG': return 'edit'
      case 'EXPLAIN': return 'chat'
      case 'UNDO': return 'edit'
      default: return 'chat'
    }
  }

  toSummaryText(intent: ResolvedIntent): string {
    const labels: Record<IntentOperation, string> = {
      NEW_BUILD: '🚀 New Build', ADD_FEATURE: '➕ Add Feature',
      MODIFY_STYLE: '🎨 Style Change', MODIFY_LOGIC: '⚙️ Logic Change',
      FIX_BUG: '🐛 Fix Bug', EXPLAIN: '💬 Explain', UNDO: '↩️ Undo', CHAT: '💬 Chat',
    }
    let out = `**${labels[intent.operation]}** (${intent.confidence}% confidence)\n📝 ${intent.description}`
    if (intent.targetFiles.length > 0) out += `\n🎯 Target: ${intent.targetFiles.join(', ')}`
    if (intent.preserve.length > 0) out += `\n🔒 Preserve: ${intent.preserve.join(', ')}`
    return out
  }

  private _chatIntent(msg: string): ResolvedIntent {
    return { operation: 'CHAT', description: msg.slice(0, 80), targetFiles: [], preserve: [], needsClarification: false, clarificationQuestion: '', confidence: 95, scope: 'project', resolvesPendingQuestion: null }
  }

  private _scoreAsAnswer(message: string, pending: PendingQuestion): number {
    const p = message.toLowerCase().trim()
    if (pending.options) {
      const match = pending.options.some(opt => p.includes(opt.toLowerCase()) || opt.toLowerCase().includes(p))
      if (match && p.split(' ').length <= 6) return 0.9
    }
    if (/\b(skip|use default|doesn.t matter|whatever|any)\b/.test(p)) return 0.85
    return 0.2
  }

  private _fallbackClassify(message: string, resolvesPending: string | null): ResolvedIntent {
    const p = message.toLowerCase()
    let op: IntentOperation = 'CHAT'
    if (/\b(build|create|make|generate|scaffold)\b/.test(p)) op = 'NEW_BUILD'
    else if (/\b(add|include|also add|append)\b/.test(p)) op = 'ADD_FEATURE'
    else if (/\b(color|theme|font|style|design|look|dark|light|attractive)\b/.test(p)) op = 'MODIFY_STYLE'
    else if (/\b(fix|debug|error|broken|bug)\b/.test(p)) op = 'FIX_BUG'
    else if (/\b(change|update|edit|modify|rename)\b/.test(p)) op = 'MODIFY_LOGIC'
    return { operation: op, description: message.slice(0, 100), targetFiles: [], preserve: [], needsClarification: false, clarificationQuestion: '', confidence: 55, scope: 'project', resolvesPendingQuestion: resolvesPending }
  }
}
