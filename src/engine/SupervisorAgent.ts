import { streamFromLLM } from './NetworkNode'
import { SupervisorMemory } from './SupervisorMemory'

export type PipelineMode = 'express' | 'standard' | 'full'

export interface PipelineDecision {
  mode: PipelineMode
  steps: {
    resourceFetch: boolean
    design: boolean
    validate: boolean
    security: boolean
    seo: boolean
    performance: boolean
    devops: boolean
    suggest: boolean
  }
  reasoning: string
  estimatedMinutes: number
}

// Complexity signals that always require full pipeline
const FULL_PIPELINE_SIGNALS = [
  'stripe', 'auth', 'authentication', 'database', 'prisma',
  'supabase', 'postgres', 'api routes', 'server', 'backend',
  'admin', 'subscription', 'payment', 'deploy',
  'production', 'docker', 'vercel', 'full stack', 'fullstack',
]

// Signals for express mode (landing page, simple UI only)
const EXPRESS_SIGNALS = [
  'landing page', 'landing', 'hero', 'simple', 'quick',
  'portfolio', 'single page', 'one page', 'showcase', 'promo',
]

/**
 * SupervisorAgent
 *
 * Reads the user prompt and decides which pipeline steps to run.
 * Does NOT call an LLM for simple decisions — uses rule-based detection first.
 * Falls back to LLM only for ambiguous prompts.
 *
 * Modes:
 *   express  (~2-3 min): workspace scan, template, design, build, execute
 *   standard (~4-6 min): + validate, resource fetch, seo, suggest
 *   full     (~8-12 min): everything
 */
export class SupervisorAgent {
  private memory = new SupervisorMemory()

  async decide(
    prompt: string,
    provider: string,
    apiKey: string
  ): Promise<PipelineDecision> {
    // Check memory first — has this type of prompt worked well in a specific mode?
    const historicBest = this.memory.getBestModeForPrompt(prompt)
    if (historicBest) {
      return this.buildDecision(historicBest, `Memory: ${historicBest} mode worked for similar past prompts`)
    }

    const p = prompt.toLowerCase()

    // Rule-based fast path — no LLM needed
    const hasFullSignals  = FULL_PIPELINE_SIGNALS.some(s => p.includes(s))
    const hasExpressSignals = EXPRESS_SIGNALS.some(s => p.includes(s))
    const wordCount = prompt.split(' ').length

    // Long detailed prompt → full pipeline regardless
    if (wordCount > 25 || hasFullSignals) {
      return this.buildDecision('full', 'Full pipeline: complex prompt or backend requirements detected')
    }

    // Clear simple landing page → express
    if (hasExpressSignals && !hasFullSignals && wordCount < 15) {
      return this.buildDecision('express', 'Express mode: simple landing page prompt')
    }

    // Ambiguous → ask LLM (fast, cheap call)
    return this.llmDecide(prompt, provider, apiKey)
  }

  /** Expose memory for Orchestrator to record outcomes */
  getMemory(): SupervisorMemory {
    return this.memory
  }

  private async llmDecide(
    prompt: string,
    provider: string,
    apiKey: string
  ): Promise<PipelineDecision> {
    try {
      const systemPrompt = `You are a pipeline decision engine. Given a user's app request, decide the pipeline mode.

Respond with ONLY a JSON object, nothing else:
{
  "mode": "express" | "standard" | "full",
  "reasoning": "one sentence"
}

Rules:
- express: landing pages, portfolios, simple marketing sites, pure UI
- standard: SaaS UI without complex backend, blogs with CMS, ecommerce UI
- full: auth systems, payment integration, database schemas, API routes, deployment configs`

      const response = await streamFromLLM(
        `User request: "${prompt}"\n\nDecide the pipeline mode.`,
        provider, apiKey, systemPrompt,
        { maxOutputTokens: 100 }
      )

      const clean = response.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean) as { mode: PipelineMode; reasoning: string }
      return this.buildDecision(parsed.mode ?? 'standard', parsed.reasoning ?? 'LLM decision')
    } catch {
      // Fallback to standard on any LLM error
      return this.buildDecision('standard', 'Fallback to standard mode (LLM decision failed)')
    }
  }

  private buildDecision(mode: PipelineMode, reasoning: string): PipelineDecision {
    const steps = {
      express: {
        resourceFetch: true,
        design: true,
        validate: false,
        security: false,
        seo: false,
        performance: false,
        devops: false,
        suggest: false,
      },
      standard: {
        resourceFetch: true,
        design: true,
        validate: true,
        security: false,
        seo: true,
        performance: false,
        devops: false,
        suggest: true,
      },
      full: {
        resourceFetch: true,
        design: true,
        validate: true,
        security: true,
        seo: true,
        performance: true,
        devops: true,
        suggest: true,
      },
    }

    const minutes = { express: 2.5, standard: 5, full: 10 }

    return {
      mode,
      steps: steps[mode],
      reasoning,
      estimatedMinutes: minutes[mode],
    }
  }
}
