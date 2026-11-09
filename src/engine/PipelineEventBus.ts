/**
 * PipelineEventBus
 *
 * Typed in-process event bus for streaming pipeline progress
 * from Orchestrator to ChatPanel and any other subscriber.
 *
 * Design:
 * - Singleton per extension session
 * - Orchestrator fires events at each step
 * - ChatPanel webview subscribes and forwards to its UI
 * - All events are typed — no raw string parsing
 */

export type PipelineEventType =
  | 'session_start'
  | 'step_start'
  | 'step_complete'
  | 'step_failed'
  | 'llm_chunk'            // streaming LLM token chunk
  | 'quality_category'     // one quality category evaluated
  | 'quality_complete'     // full quality score ready
  | 'build_complete'
  | 'build_failed'
  | 'build_cancelled'
  | 'chat_start'
  | 'chat_chunk'
  | 'chat_end'
  | 'chat_system_message'
  // ── Streaming: file-level generation progress ────────────────────────────
  | 'build_chunk'          // raw token chunk while generating a file
  | 'file_generating'      // "Hero.tsx... generating"
  | 'file_complete'        // "Hero.tsx ✅ (247 lines)"
  // ── Metrics + Scorecard ──────────────────────────────────────────────────
  | 'step_metric'          // per-step scalar metric (value vs target)
  | 'planner_metric'       // planner-specific: file efficiency + budget
  | 'build_scorecard'      // full EvalScorecard after build completes
  // ── Component Wave Preview ───────────────────────────────────────────────
  | 'wave_complete'        // a wave of files finished writing to disk
  | 'wave_approved'        // user clicked Continue
  | 'wave_modify'          // user wants to change something
  | 'wave_stopped'         // user stopped the build
  | 'open_browser_preview' // open localhost:3000 in browser
  // ── Intent Cards (replaces QuickPick modals) ─────────────────────────────
  | 'intent_card'          // structured question card rendered in chat
  | 'intent_answer'        // user answered a single question
  | 'intent_complete'      // all questions answered → BuildProfile ready
  // ── Firecrawl confirmation ───────────────────────────────────────────────
  | 'firecrawl_prompt'     // show "Scrape the web?" Yes/No card in chat
  | 'firecrawl_answer'     // user answered yes or no
  // ── Plan approval gate ────────────────────────────────────────────────
  | 'plan_ready'           // planner done — show plan card + wait for approval
  | 'plan_approved'        // user clicked Approve — continue build
  | 'plan_cancelled'       // user clicked Cancel — abort build

export interface PipelineEvent {
  type: PipelineEventType
  sessionId: string
  timestamp: number

  // ── Step events ───────────────────────────────────────────────────────────
  stepNumber?: number
  stepName?: string

  // ── LLM streaming ─────────────────────────────────────────────────────────
  chunk?: string
  agentName?: string

  // ── Quality events ────────────────────────────────────────────────────────
  category?: string
  categoryScore?: number
  qualityScore?: number
  qualityVerdict?: string

  // ── Build complete ────────────────────────────────────────────────────────
  fileCount?: number
  totalCostUsd?: number

  // ── Error ────────────────────────────────────────────────────────────────
  error?: string

  // ── Chat events ───────────────────────────────────────────────────────────
  text?: string
  isError?: boolean

  // ── File-level streaming ──────────────────────────────────────────────────
  filePath?: string        // which file is being generated
  lineCount?: number       // lines in completed file

  // ── Firecrawl ─────────────────────────────────────────────────────────────
  approved?: boolean       // firecrawl_answer: true = scrape, false = skip

  // ── Plan card ───────────────────────────────────────────────────────────────
  planFiles?: string[]     // list of files the planner decided to create
  planTechStack?: string[] // e.g. ['Next.js', 'Tailwind', 'Prisma']
  planFramework?: string   // e.g. 'Next.js 14 App Router'
  planTaskType?: string    // e.g. 'dashboard', 'landing', 'saas'
  planBudget?: number      // max files allowed
  planEfficiency?: number  // % of files justified
  planFolderStructure?: string // tree string

  // ── Scalar metrics ────────────────────────────────────────────────────────
  metric?: string          // metric name, e.g. 'file_efficiency', 'ts_errors'
  value?: number           // actual value
  target?: number          // target value
  passed?: boolean         // value meets target

  // ── Planner metrics ───────────────────────────────────────────────────────
  fileEfficiency?: number
  budgetUsed?: number
  budgetAllowed?: number

  // ── Build scorecard ───────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scorecard?: Record<string, any>

  // ── Component wave ────────────────────────────────────────────────────────
  waveNumber?: number
  waveLabel?: string
  filesInWave?: string[]

  // ── Intent cards ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  questions?: any[]
  questionId?: string
  answer?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers?: Record<string, any>
}

type EventHandler = (event: PipelineEvent) => void

export class PipelineEventBus {
  private static instance: PipelineEventBus | undefined
  private handlers: Set<EventHandler> = new Set()
  private currentSessionId = ''
  private cancelled = false

  static getInstance(): PipelineEventBus {
    if (!PipelineEventBus.instance) {
      PipelineEventBus.instance = new PipelineEventBus()
    }
    return PipelineEventBus.instance
  }

  /** Subscribe to all pipeline events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** Fire an event to all subscribers. */
  emit(event: Omit<PipelineEvent, 'timestamp'>): void {
    if (this.cancelled && event.type !== 'build_cancelled') return
    const full: PipelineEvent = { ...event, timestamp: Date.now() }
    for (const handler of this.handlers) {
      try { handler(full) } catch (err) {
        // Log but never let one bad handler crash all others
        console.error('[PipelineEventBus] Handler error on event', event.type, err)
      }
    }
  }

  /** Call at the start of each pipeline run. */
  startSession(sessionId: string): void {
    this.currentSessionId = sessionId
    this.cancelled = false
    this.emit({ type: 'session_start', sessionId })
  }

  /** Returns true if a cancel was requested. Check this between steps. */
  isCancelled(): boolean {
    return this.cancelled
  }

  /** Request cancellation of the current build. */
  cancel(): void {
    this.cancelled = true
    this.emit({ type: 'build_cancelled', sessionId: this.currentSessionId })
  }

  /** Reset cancellation state. Call after build completes or fails. */
  reset(): void {
    this.cancelled = false
  }

  getCurrentSessionId(): string {
    return this.currentSessionId
  }
}
