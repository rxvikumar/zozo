/**
 * ClarificationGate — Dedicated Clarification Decision Engine
 *
 * Implements the algorithm described by the user:
 *   User message + context inspection
 *     → LLM produces structured ClarificationAssessment JSON
 *     → Gate scores 4 factors: Ambiguity × Impact × Discoverability × Reversibility
 *     → Deterministic policy rules output: ASK | PROCEED | INVESTIGATE | CONFIRM
 *
 * Hard safety rules ALWAYS override any numerical score.
 * The model proposes — the gate decides.
 */

import { streamFromLLM } from './NetworkNode'

// ── Output decision ──────────────────────────────────────────────────────────

export type GateDecision = 'ASK' | 'PROCEED' | 'INVESTIGATE' | 'CONFIRM'

export interface GateResult {
  decision:             GateDecision
  question:             string
  confirmationPrompt:   string
  proceedAssumption:    string
  investigateHint:      string
  scores: {
    ambiguity:       number
    impact:          number
    discoverability: number
    reversibility:   number
    total:           number
  }
  hardSafetyTriggered: boolean
  rawAssessment:       ClarificationAssessment | null
}

// ── LLM-generated structured assessment ─────────────────────────────────────

export interface ClarificationAmbiguity {
  field:                         string
  alternatives:                  string[]
  already_resolved_from_context: boolean
  impact_if_wrong:               'low' | 'medium' | 'high'
  reversible:                    'easy' | 'medium' | 'hard'
  safe_default_available:        boolean
  safe_default_value?:           string
}

export interface ClarificationAssessment {
  intent:                      string
  task_continuation:           boolean
  ambiguities:                 ClarificationAmbiguity[]
  recommended_action:          'ask' | 'proceed_with_default' | 'investigate' | 'require_confirmation'
  default_value?:              string
  ask_user:                    boolean
  question?:                   string
  reason:                      string
  is_destructive:              boolean
  is_externally_consequential: boolean
}

// ── Gate system prompt ────────────────────────────────────────────────────────

const GATE_SYSTEM = `You are the Clarification Decision Analyst for ZOZO, an AI coding assistant.

Your job: Given a user message + conversation history + project files, produce a structured JSON assessment of what the user wants and whether any clarification is needed.

GOLDEN RULES:
1. NEVER ask about things already visible in package.json, tsconfig.json, or existing files.
2. NEVER ask about taste/aesthetics — use sensible professional defaults.
3. ONLY flag a question when: (a) two materially different interpretations exist AND (b) picking wrong would cause major re-work AND (c) you cannot safely infer the right one.
4. Flag is_destructive=true if the action would delete, overwrite, or permanently modify existing user files.
5. Flag is_externally_consequential=true if the action touches external services (auth, payments, emails, APIs).

EXAMPLES — do NOT ask:
- "Which React version?" → Inspect package.json
- "Should it look modern?" → Use design system defaults
- "Do you want dark mode?" → DesignAgent handles this

EXAMPLES — DO ask:
- "Should this calendar sync with Google Calendar or stay local?" → Changes auth + API model
- "Should I replace your existing Nav component or create a new one?" → Destructive ambiguity

Return ONLY valid JSON in this exact shape:
{
  "intent": "short description",
  "task_continuation": true,
  "ambiguities": [
    {
      "field": "field_name",
      "alternatives": ["option_a", "option_b"],
      "already_resolved_from_context": false,
      "impact_if_wrong": "high",
      "reversible": "hard",
      "safe_default_available": true,
      "safe_default_value": "option_a"
    }
  ],
  "recommended_action": "proceed_with_default",
  "default_value": "option_a",
  "ask_user": false,
  "question": "",
  "reason": "one sentence",
  "is_destructive": false,
  "is_externally_consequential": false
}`

// ── Scoring maps ──────────────────────────────────────────────────────────────

const IMPACT_SCORE:     Record<string, number> = { low: 0, medium: 1.5, high: 3 }
const REVERSIBLE_SCORE: Record<string, number> = { easy: 0, medium: 1,  hard: 3 }

export class ClarificationGate {

  async evaluate(
    message:      string,
    history:      Array<{ role: string; content: string }>,
    projectFiles: string[],
    provider:     string,
    apiKey:       string
  ): Promise<GateResult> {

    // ── Hard safety fast-paths (before LLM call) ─────────────────────────
    const p = message.toLowerCase()
    if (this._isDestructivePattern(p)) {
      return this._confirmResult(
        'This will modify or delete existing files. Are you sure you want to proceed?',
        true
      )
    }

    // ── Build context for LLM ─────────────────────────────────────────────
    const historyStr = history.slice(-6)
      .map(t => `${t.role.toUpperCase()}: ${t.content.slice(0, 250)}`).join('\n')
    const filesStr = projectFiles.slice(0, 15).join(', ') || 'No project open'

    const contextPrompt =
      `CONVERSATION HISTORY:\n${historyStr || 'First message.'}\n\n` +
      `PROJECT FILES:\n${filesStr}\n\n` +
      `USER MESSAGE: "${message}"\n\nReturn JSON only.`

    let assessment: ClarificationAssessment | null = null

    try {
      const raw = await streamFromLLM(contextPrompt, provider, apiKey, GATE_SYSTEM, { maxOutputTokens: 500 })
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) assessment = JSON.parse(match[0]) as ClarificationAssessment
    } catch {
      return this._proceedResult('Proceeding with sensible defaults.', null)
    }

    if (!assessment) return this._proceedResult('Proceeding with sensible defaults.', null)

    // ── Hard safety overrides (post-LLM) ─────────────────────────────────
    if (assessment.is_destructive) {
      return this._confirmResult(
        'This action will modify existing project files. Confirm to proceed.',
        true, assessment
      )
    }
    if (assessment.is_externally_consequential) {
      return this._confirmResult(
        'This connects to an external service. Please confirm before proceeding.',
        true, assessment
      )
    }

    // ── Score ambiguities ─────────────────────────────────────────────────
    const actionable = assessment.ambiguities.filter(a => !a.already_resolved_from_context)
    if (actionable.length === 0) {
      return this._proceedResult(assessment.reason, assessment)
    }

    // Score each ambiguity — pick the worst (highest score = most critical)
    let maxScore = 0
    let worst: ClarificationAmbiguity | null = null

    for (const amb of actionable) {
      const ambiguity       = amb.alternatives.length >= 2 ? 2 : 0
      const impact          = IMPACT_SCORE[amb.impact_if_wrong]  ?? 1.5
      const discoverability = amb.already_resolved_from_context   ? 0 : 2
      const reversibility   = REVERSIBLE_SCORE[amb.reversible]   ?? 1
      const total = ambiguity + impact + discoverability + reversibility

      if (total > maxScore) { maxScore = total; worst = amb }
    }

    const scores = worst ? {
      ambiguity:       worst.alternatives.length >= 2 ? 2 : 0,
      impact:          IMPACT_SCORE[worst.impact_if_wrong]  ?? 1.5,
      discoverability: worst.already_resolved_from_context   ? 0 : 2,
      reversibility:   REVERSIBLE_SCORE[worst.reversible]   ?? 1,
      total:           maxScore,
    } : { ambiguity: 0, impact: 0, discoverability: 0, reversibility: 0, total: 0 }

    // ── Policy decision ───────────────────────────────────────────────────
    // Total >= 7          → ASK
    // Total 4-6.9 + no default → ASK
    // Total 4-6.9 + default    → PROCEED (state assumption)
    // Total < 4           → PROCEED
    // recommended=investigate  → INVESTIGATE

    if (assessment.recommended_action === 'investigate') {
      return {
        decision: 'INVESTIGATE', question: '', confirmationPrompt: '', proceedAssumption: '',
        investigateHint: assessment.reason, scores,
        hardSafetyTriggered: false, rawAssessment: assessment,
      }
    }

    if (maxScore >= 7 || (maxScore >= 4 && worst && !worst.safe_default_available)) {
      const q = assessment.question ||
        (worst ? `Which approach for ${worst.field}? ${worst.alternatives.join(' or ')}` : '')
      return {
        decision: 'ASK', question: q, confirmationPrompt: '', proceedAssumption: '',
        investigateHint: '', scores, hardSafetyTriggered: false, rawAssessment: assessment,
      }
    }

    const assumption = worst?.safe_default_value
      ? `Using **${worst.safe_default_value}** for ${worst.field} as the default.`
      : assessment.reason
    return this._proceedResult(assumption, assessment, scores)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _isDestructivePattern(p: string): boolean {
    return /\b(delete all|remove all files|wipe|overwrite everything|replace all|clear the project)\b/.test(p)
  }

  private _confirmResult(
    prompt: string,
    hardSafety: boolean,
    assessment: ClarificationAssessment | null = null
  ): GateResult {
    return {
      decision: 'CONFIRM', question: '', confirmationPrompt: prompt, proceedAssumption: '',
      investigateHint: '',
      scores: { ambiguity: 3, impact: 3, discoverability: 3, reversibility: 3, total: 12 },
      hardSafetyTriggered: hardSafety, rawAssessment: assessment,
    }
  }

  private _proceedResult(
    assumption: string,
    assessment: ClarificationAssessment | null,
    scores = { ambiguity: 0, impact: 0, discoverability: 0, reversibility: 0, total: 0 }
  ): GateResult {
    return {
      decision: 'PROCEED', question: '', confirmationPrompt: '',
      proceedAssumption: assumption, investigateHint: '',
      scores, hardSafetyTriggered: false, rawAssessment: assessment,
    }
  }
}
