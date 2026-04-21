import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import type { PipelineMode } from './SupervisorAgent'

export interface SupervisorDecisionRecord {
  prompt: string            // first 80 chars
  promptHash: string        // simple keyword hash for matching
  mode: PipelineMode
  qualityScore: number      // quality gate score after build
  durationMs: number        // how long the build took
  wasCorrect: boolean       // true if mode was appropriate (score ≥ 65 in time)
  timestamp: string
}

/**
 * SupervisorMemory
 *
 * Persists past supervisor decisions and their outcomes.
 * SupervisorAgent reads this to bias future decisions toward
 * modes that produced high-quality output efficiently.
 *
 * Separate file from SupervisorAgent — memory is a concern,
 * decision-making is a separate concern.
 */
export class SupervisorMemory {
  private dbPath: string
  private records: SupervisorDecisionRecord[] = []

  constructor() {
    const dir = path.join(os.homedir(), '.zozo')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.dbPath = path.join(dir, 'supervisor-memory.json')
    this.load()
  }

  /**
   * Record an outcome after a build completes.
   * Orchestrator calls this at the end of each run.
   */
  record(
    prompt: string,
    mode: PipelineMode,
    qualityScore: number,
    durationMs: number
  ): void {
    const wasCorrect =
      (mode === 'express'  && qualityScore >= 65 && durationMs < 3 * 60_000) ||
      (mode === 'standard' && qualityScore >= 65 && durationMs < 6 * 60_000) ||
      (mode === 'full'     && qualityScore >= 65)

    this.records.push({
      prompt: prompt.slice(0, 80),
      promptHash: this.hashPrompt(prompt),
      mode,
      qualityScore,
      durationMs,
      wasCorrect,
      timestamp: new Date().toISOString(),
    })

    // Keep last 100 records
    if (this.records.length > 100) this.records = this.records.slice(-100)
    this.save()
  }

  /**
   * Get the mode that worked best for similar past prompts.
   * Returns null if no similar history exists.
   */
  getBestModeForPrompt(prompt: string): PipelineMode | null {
    const hash = this.hashPrompt(prompt)
    const similar = this.records.filter(r =>
      r.promptHash === hash && r.wasCorrect
    )
    if (similar.length < 2) return null  // not enough data

    // Pick the mode that appeared most in successful similar builds
    const counts: Record<string, number> = {}
    for (const r of similar) {
      counts[r.mode] = (counts[r.mode] ?? 0) + 1
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return best ? (best[0] as PipelineMode) : null
  }

  /**
   * Get overall stats — useful for DreamEngine integration.
   */
  getStats(): {
    totalDecisions: number
    correctRate: number
    avgScoreByMode: Record<PipelineMode, number>
  } {
    if (this.records.length === 0) {
      return { totalDecisions: 0, correctRate: 0, avgScoreByMode: { express: 0, standard: 0, full: 0 } }
    }

    const correct = this.records.filter(r => r.wasCorrect).length
    const scoresByMode: Record<string, number[]> = {}

    for (const r of this.records) {
      if (!scoresByMode[r.mode]) scoresByMode[r.mode] = []
      scoresByMode[r.mode]!.push(r.qualityScore)
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0

    return {
      totalDecisions: this.records.length,
      correctRate:    Math.round((correct / this.records.length) * 100),
      avgScoreByMode: {
        express:  avg(scoresByMode['express']  ?? []),
        standard: avg(scoresByMode['standard'] ?? []),
        full:     avg(scoresByMode['full']     ?? []),
      },
    }
  }

  private hashPrompt(prompt: string): string {
    // Simple keyword-based hash — groups similar prompts together
    const keywords = prompt.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .sort()
      .slice(0, 5)
      .join('_')
    return keywords || 'generic'
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        this.records = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'))
      }
    } catch { this.records = [] }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.records, null, 2), 'utf8')
    } catch {}
  }
}
