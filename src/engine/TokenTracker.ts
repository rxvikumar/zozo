import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

export interface TokenCall {
  sessionId: string
  stepName: string
  model: string
  provider: 'gemini' | 'anthropic' | 'openai'
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

export interface SessionStats {
  sessionId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  estimatedCostUsd: number
  callCount: number
  steps: string[]
}

// Cost per 1M tokens (USD)
const COST_TABLE: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'gemini-2.5-flash':          { input: 0.15,  output: 0.60,  cacheWrite: 0,     cacheRead: 0 },
  'gemini-2.5-pro':            { input: 1.25,  output: 10.0,  cacheWrite: 0,     cacheRead: 0 },
  'gemini-3.1-pro-preview':    { input: 7.0,   output: 21.0,  cacheWrite: 3.5,   cacheRead: 0.875 },
  'gemini-3-flash-preview':    { input: 0.30,  output: 2.50,  cacheWrite: 0,     cacheRead: 0 },
  'claude-3-7-sonnet-20250219':{ input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-opus-4-6':           { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.50 },
  'gpt-4o':                    { input: 5.0,   output: 15.0,  cacheWrite: 0,     cacheRead: 0 },
}

function estimateCost(call: TokenCall): number {
  const rates = COST_TABLE[call.model] ?? { input: 1.0, output: 3.0, cacheWrite: 0, cacheRead: 0 }
  const inputCost  = (call.inputTokens / 1_000_000) * rates.input
  const outputCost = (call.outputTokens / 1_000_000) * rates.output
  const writeCost  = ((call.cacheCreationTokens ?? 0) / 1_000_000) * rates.cacheWrite
  const readCost   = ((call.cacheReadTokens ?? 0) / 1_000_000) * rates.cacheRead
  return inputCost + outputCost + writeCost + readCost
}

export class TokenTracker {
  private dbPath: string
  private records: TokenCall[] = []

  constructor() {
    const dir = path.join(os.homedir(), '.zozo')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.dbPath = path.join(dir, 'token-log.json')
    this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8')
        this.records = JSON.parse(raw) as TokenCall[]
      }
    } catch {
      this.records = []
    }
  }

  private save(): void {
    try {
      // Keep last 5000 records only
      if (this.records.length > 5000) {
        this.records = this.records.slice(-5000)
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(this.records, null, 2), 'utf8')
    } catch {}
  }

  record(call: TokenCall): void {
    this.records.push(call)
    this.save()
  }

  getSessionTotal(sessionId: string): SessionStats {
    const calls = this.records.filter(r => r.sessionId === sessionId)
    const stats: SessionStats = {
      sessionId,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      estimatedCostUsd: 0,
      callCount: calls.length,
      steps: [],
    }
    for (const c of calls) {
      stats.totalInputTokens += c.inputTokens
      stats.totalOutputTokens += c.outputTokens
      stats.totalCacheCreationTokens += c.cacheCreationTokens ?? 0
      stats.totalCacheReadTokens += c.cacheReadTokens ?? 0
      stats.estimatedCostUsd += estimateCost(c)
      if (!stats.steps.includes(c.stepName)) stats.steps.push(c.stepName)
    }
    return stats
  }

  getAllTimeCostUsd(): number {
    return this.records.reduce((sum, c) => sum + estimateCost(c), 0)
  }

  getRecentSessions(limit = 10): SessionStats[] {
    const sessionIds = [...new Set(this.records.map(r => r.sessionId))].slice(-limit)
    return sessionIds.map(id => this.getSessionTotal(id))
  }

  formatSession(stats: SessionStats): string {
    return [
      `Session ${stats.sessionId.slice(0, 8)}`,
      `  Steps:  ${stats.steps.join(' → ')}`,
      `  Input:  ${stats.totalInputTokens.toLocaleString()} tokens`,
      `  Output: ${stats.totalOutputTokens.toLocaleString()} tokens`,
      `  Cache writes: ${stats.totalCacheCreationTokens.toLocaleString()}`,
      `  Cache reads:  ${stats.totalCacheReadTokens.toLocaleString()}`,
      `  Cost:   $${stats.estimatedCostUsd.toFixed(4)}`,
      `  Calls:  ${stats.callCount}`,
    ].join('\n')
  }
}
