import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// Loose string type — prevents mismatch crashes if step names drift
export type StepName = string

export const STEP: Record<string, StepName> = {
  WORKSPACE_SCAN:  'workspace_scan',
  TEMPLATE_DETECT: 'template_detect',
  PLAN:            'plan',
  DESIGN:          'design',
  BUILD:           'build',
  VALIDATE:        'validate',
  SECURITY:        'security',
  SEO:             'seo',
  PERFORMANCE:     'performance',
  DEVOPS:          'devops',
  CODEGUARD:       'codeguard',
  EXECUTE:         'execute',
  SUGGEST:         'suggest',
}

export interface StepCheckpoint {
  stepNumber: number
  stepName: StepName
  status: 'complete' | 'failed'
  outputSummary: string   // Short string summary only — NOT full output (too large)
  completedAt: string     // ISO timestamp
  startedAt?: string      // ISO timestamp — when the step began
  durationMs?: number     // elapsed ms for this step
  // Structured metrics — never parsed from text:
  metrics?: Record<string, number | string>
}

export interface Session {
  id: string
  prompt: string
  template: string
  provider: string
  status: 'running' | 'complete' | 'failed'
  steps: StepCheckpoint[]
  startedAt: string
  updatedAt: string
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export class SessionState {
  private dir: string

  constructor() {
    this.dir = path.join(os.homedir(), '.zozo', 'sessions')
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true })
  }

  create(prompt: string, provider: string): Session {
    const session: Session = {
      id: makeId(),
      prompt: prompt.slice(0, 200),  // truncate long prompts
      template: '',
      provider,
      status: 'running',
      steps: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.write(session)
    return session
  }

  checkpoint(
    sessionId: string,
    stepNumber: number,
    stepName: StepName,
    outputSummary: string,
    metrics?: Record<string, number | string>,
    startedAt?: number  // Date.now() captured before the step ran
  ): void {
    const session = this.load(sessionId)
    if (!session) return
    // Replace if step already exists (retry case)
    session.steps = session.steps.filter(s => s.stepNumber !== stepNumber)
    const now = Date.now()
    session.steps.push({
      stepNumber,
      stepName,
      status: 'complete',
      outputSummary: outputSummary.slice(0, 300),
      completedAt: new Date(now).toISOString(),
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
      durationMs: startedAt ? now - startedAt : undefined,
      metrics,
    })
    session.steps.sort((a, b) => a.stepNumber - b.stepNumber)
    session.updatedAt = new Date(now).toISOString()
    this.write(session)
  }

  markFailed(sessionId: string, stepNumber: number, stepName: StepName): void {
    const session = this.load(sessionId)
    if (!session) return
    session.steps.push({
      stepNumber, stepName, status: 'failed',
      outputSummary: 'step failed',
      completedAt: new Date().toISOString(),
    })
    session.status = 'failed'
    session.updatedAt = new Date().toISOString()
    this.write(session)
  }

  markComplete(sessionId: string): void {
    const session = this.load(sessionId)
    if (!session) return
    session.status = 'complete'
    session.updatedAt = new Date().toISOString()
    this.write(session)
  }

  setTemplate(sessionId: string, template: string): void {
    const session = this.load(sessionId)
    if (!session) return
    session.template = template
    session.updatedAt = new Date().toISOString()
    this.write(session)
  }

  getLastCompletedStep(sessionId: string): number {
    const session = this.load(sessionId)
    if (!session) return 0
    const completed = session.steps.filter(s => s.status === 'complete')
    if (completed.length === 0) return 0
    return Math.max(...completed.map(s => s.stepNumber))
  }

  load(sessionId: string): Session | null {
    try {
      const p = path.join(this.dir, `${sessionId}.json`)
      if (!fs.existsSync(p)) return null
      return JSON.parse(fs.readFileSync(p, 'utf8')) as Session
    } catch {
      return null
    }
  }

  listRecent(limit = 5): Session[] {
    try {
      const files = fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Session
            return s
          } catch { return null }
        })
        .filter((s): s is Session => s !== null)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      return files.slice(0, limit)
    } catch {
      return []
    }
  }

  private write(session: Session): void {
    try {
      const p = path.join(this.dir, `${session.id}.json`)
      fs.writeFileSync(p, JSON.stringify(session, null, 2), 'utf8')
    } catch {}
  }

  /**
   * Deletes oldest sessions keeping only the most recent `keep` sessions.
   * Call this at the start of each new orchestrator run.
   */
  cleanup(keep = 100): void {
    try {
      const files = fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(this.dir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)

      const toDelete = files.slice(keep)
      for (const file of toDelete) {
        try { fs.unlinkSync(path.join(this.dir, file.name)) } catch {}
      }
    } catch {}
  }
}
