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
  | 'llm_chunk'        // streaming LLM token chunk
  | 'quality_category' // one quality category evaluated
  | 'quality_complete' // full quality score ready
  | 'build_complete'
  | 'build_failed'
  | 'build_cancelled'

export interface PipelineEvent {
  type: PipelineEventType
  sessionId: string
  timestamp: number
  // Step events
  stepNumber?: number
  stepName?: string
  // LLM streaming
  chunk?: string
  agentName?: string
  // Quality
  category?: string
  categoryScore?: number
  qualityScore?: number
  qualityVerdict?: string
  // Build complete
  fileCount?: number
  totalCostUsd?: number
  // Error
  error?: string
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
      try { handler(full) } catch {}
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
