import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { SessionState } from './SessionState'
import { TokenTracker } from './TokenTracker'

export interface DreamInsight {
  bestTemplates: Array<{ template: string; avgScore: number; count: number }>
  commonFailures: Array<{ category: string; failRate: number }>
  avgCostPerBuild: number
  avgQualityScore: number
  totalBuilds: number
  lastConsolidated: string
  worstQualityCategories: Array<{ category: string; avgScore: number }>
  retryRate: number  // what % of builds needed quality gate retries
  fastestTemplate: string  // template with fewest retry attempts
  stepAvgMs: Record<string, number>   // average duration per step in ms
  bottleneckStep: { name: string; ms: number } | null
}

export interface DreamMemory {
  version: 2
  lastUpdated: string
  totalBuilds: number
  avgQualityScore: number
  avgCostPerBuild: number
  retryRate: number
  bestTemplates: Array<{ template: string; avgScore: number; count: number }>
  fastestTemplate: string
  insights: string[]   // human-readable bullet points, max 5
  stepAvgMs: Record<string, number>
  bottleneckStep: { name: string; ms: number } | null
}

const MEMORY_VERSION = 2

/**
 * DreamEngine
 *
 * Background memory consolidation — runs after every 3 completed sessions.
 * Inspired by Claude Code's autoDream system (3-gate trigger: time + sessions + lock).
 *
 * Phases:
 *   1. Orient   — read existing MEMORY.md
 *   2. Gather   — scan recent session logs for patterns
 *   3. Consolidate — write updated MEMORY.md
 *   4. Prune    — keep MEMORY.md under 200 lines
 */
export class DreamEngine {
  private memoryDir: string
  private memoryPath: string
  private lockPath: string
  private sessionState: SessionState
  private tokenTracker: TokenTracker

  constructor() {
    this.memoryDir = path.join(os.homedir(), '.zozo', 'memory')
    this.memoryPath = path.join(this.memoryDir, 'MEMORY.md')
    this.lockPath   = path.join(os.homedir(), '.zozo', 'dream.lock')
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true })
    }
    this.sessionState = new SessionState()
    this.tokenTracker = new TokenTracker()
  }

  /**
   * Three-gate trigger. All must pass:
   *   Gate 1: ≥3 completed sessions since last dream
   *   Gate 2: ≥1 hour since last dream (or never dreamed)
   *   Gate 3: No active dream lock
   */
  shouldDream(): boolean {
    if (fs.existsSync(this.lockPath)) return false

    const lastDreamTime = this.getLastDreamTime()
    const hoursSince = lastDreamTime
      ? (Date.now() - lastDreamTime) / (1000 * 60 * 60)
      : 999

    if (hoursSince < 1) return false

    const sessions = this.sessionState.listRecent(20)
    const completedSince = sessions.filter(s =>
      s.status === 'complete' &&
      (!lastDreamTime || new Date(s.updatedAt).getTime() > lastDreamTime)
    )

    return completedSince.length >= 3
  }

  /**
   * Run the 4-phase dream consolidation.
   * Call this from extension.ts activate() with a setTimeout so it never blocks startup.
   */
  async dream(): Promise<void> {
    if (!this.shouldDream()) return

    // Acquire dream lock
    try {
      fs.writeFileSync(this.lockPath, new Date().toISOString(), 'utf8')
    } catch {
      return
    }

    try {
      // Phase 1 — Orient
      const existing = this.readMemory()

      // Phase 2 — Gather
      const insight = this.gatherInsights()

      // Phase 3 — Consolidate
      const newMemory = this.buildMemoryDoc(insight, existing)

      // Phase 4 — Prune (keep under 200 lines)
      const lines = newMemory.split('\n')
      const pruned = lines.length > 200
        ? lines.slice(0, 180).join('\n') + '\n\n_[older history pruned]_'
        : newMemory

      fs.writeFileSync(this.memoryPath, pruned, 'utf8')

      // Write structured JSON store (v2)
      this.writeStructuredMemory(insight)

      // Write last dream timestamp
      const metaPath = path.join(this.memoryDir, 'last-dream.txt')
      fs.writeFileSync(metaPath, Date.now().toString(), 'utf8')

    } finally {
      try { fs.unlinkSync(this.lockPath) } catch {}
    }
  }

  /**
   * Returns the memory context string to inject into agent prompts.
   * Returns empty string if no memory exists yet.
   */
  getMemoryContext(): string {
    // Try structured JSON first — faster and more reliable
    const structured = this.readStructuredMemory()
    if (structured) {
      if (structured.insights.length === 0) return ''
      const lines = [
        `## Memory (${structured.insights.length} insights, ${structured.totalBuilds} builds)`,
        ...structured.insights.map((i: string) => `- ${i}`),
      ]
      return `\n\n${lines.join('\n')}\n`
    }

    // Fall back to markdown (old format or first run)
    if (!fs.existsSync(this.memoryPath)) return ''
    try {
      const content = fs.readFileSync(this.memoryPath, 'utf8')
      if (!content.trim()) return ''
      const lines = content.split('\n')
        .filter(l => l.startsWith('- '))
        .slice(0, 5)
      if (lines.length === 0) return ''
      return `\n\n## Memory (${lines.length} insights)\n${lines.join('\n')}\n`
    } catch {
      return ''
    }
  }

  private gatherInsights(): DreamInsight {
    const sessions = this.sessionState.listRecent(50)
    // Only learn from builds that passed quality gate (score ≥ 70)
    // Bad builds produce bad memories → worse future outputs
    const allCompleted = sessions.filter(s => s.status === 'complete')
    const completed = allCompleted.filter(s => {
      const buildStep = s.steps.find(st => st.stepName === 'build')
      // Prefer structured metrics over text parsing
      const qualityScore = buildStep?.metrics?.qualityScore
      if (typeof qualityScore === 'number') return qualityScore >= 70
      // Fallback: parse from summary if no structured metrics (legacy sessions)
      if (!buildStep?.outputSummary) return true
      const match = buildStep.outputSummary.match(/(\d+)\/100/)
      if (!match) return true
      return parseInt(match[1]) >= 70
    })

    const templateScores: Record<string, number[]> = {}
    for (const s of completed) {
      if (s.template) {
        if (!templateScores[s.template]) templateScores[s.template] = []
        // Prefer structured metrics
        const buildStep = s.steps.find(st => st.stepName === 'build')
        const qualityScore = buildStep?.metrics?.qualityScore
        if (typeof qualityScore === 'number') {
          templateScores[s.template].push(qualityScore)
        } else {
          // Fallback: parse from summary (legacy sessions)
          const executeStep = s.steps.find(st => st.stepName === 'execute')
          if (executeStep?.outputSummary) {
            const match = executeStep.outputSummary.match(/(\d+)\/100/)
            if (match) templateScores[s.template].push(parseInt(match[1]))
          }
        }
      }
    }

    const bestTemplates = Object.entries(templateScores).map(([template, scores]) => ({
      template,
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      count: scores.length,
    })).sort((a, b) => b.avgScore - a.avgScore)

    // Cost stats
    const recentStats = this.tokenTracker.getRecentSessions(20)
    const avgCostPerBuild = recentStats.length > 0
      ? recentStats.reduce((a, b) => a + b.estimatedCostUsd, 0) / recentStats.length
      : 0

    // Quality score average — prefer structured metrics
    const scores: number[] = []
    for (const s of completed) {
      const buildStep = s.steps.find(st => st.stepName === 'build')
      const qualityScore = buildStep?.metrics?.qualityScore
      if (typeof qualityScore === 'number') {
        scores.push(qualityScore)
      } else if (buildStep?.outputSummary) {
        // Fallback: parse from summary (legacy sessions)
        const match = buildStep.outputSummary.match(/(\d+)\/100/)
        if (match) scores.push(parseInt(match[1]))
      }
    }
    const avgQualityScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0

    // Retry rate calculation — prefer structured metrics
    const buildsWithRetries = completed.filter(s => {
      const buildStep = s.steps.find(st => st.stepName === 'build')
      const retryCount = buildStep?.metrics?.retryCount
      if (typeof retryCount === 'number') return retryCount > 1
      // Fallback: text match (legacy sessions)
      return buildStep?.outputSummary?.includes('retry')
    }).length
    const retryRate = completed.length > 0
      ? Math.round((buildsWithRetries / completed.length) * 100)
      : 0

    // Fastest template (fewest retries) — prefer structured metrics
    const templateRetryCount: Record<string, number> = {}
    for (const s of completed) {
      if (!s.template) continue
      const buildStep = s.steps.find(st => st.stepName === 'build')
      const retryCount = buildStep?.metrics?.retryCount
      const hadRetry = typeof retryCount === 'number' ? (retryCount > 1 ? 1 : 0)
        : (buildStep?.outputSummary?.includes('retry') ? 1 : 0)
      templateRetryCount[s.template] = (templateRetryCount[s.template] ?? 0) + hadRetry
    }
    const fastestTemplate = Object.entries(templateRetryCount)
      .sort((a, b) => a[1] - b[1])
      .map(([t]) => t)[0] ?? 'saas'

    // ── Category-level failure tracking ──────────────────────────────────
    const categoryFailCounts: Record<string, number> = {}
    const categoryTotalCounts: Record<string, number> = {}

    const TRACKED_CATEGORIES = [
      'darkTheme', 'hasAnimations', 'hasGradients', 'hasGlassmorphism',
      'typescriptStrict', 'noWhiteBackground', 'hasCustomFonts', 'mobileResponsive',
      'spacingSystem', 'colorHarmony', 'motionRestraint', 'typographyHierarchy',
      'layoutStructure', 'performanceSafe', 'noDesignChaos',
    ]

    for (const s of completed) {
      const buildStep = s.steps.find(st => st.stepName === 'build')
      if (!buildStep?.metrics) continue

      const codeScore   = buildStep.metrics.codeScore
      const designScore = buildStep.metrics.designScore

      if (typeof codeScore === 'number') {
        const codeCats = ['darkTheme', 'hasAnimations', 'hasGradients', 'hasGlassmorphism',
                          'typescriptStrict', 'noWhiteBackground', 'hasCustomFonts', 'mobileResponsive']
        for (const cat of codeCats) {
          categoryTotalCounts[cat] = (categoryTotalCounts[cat] ?? 0) + 1
          if (codeScore < 70) {
            categoryFailCounts[cat] = (categoryFailCounts[cat] ?? 0) + 1
          }
        }
      }

      if (typeof designScore === 'number') {
        const designCats = ['spacingSystem', 'colorHarmony', 'motionRestraint',
                            'typographyHierarchy', 'layoutStructure', 'performanceSafe', 'noDesignChaos']
        for (const cat of designCats) {
          categoryTotalCounts[cat] = (categoryTotalCounts[cat] ?? 0) + 1
          if (designScore < 70) {
            categoryFailCounts[cat] = (categoryFailCounts[cat] ?? 0) + 1
          }
        }
      }
    }

    const commonFailures = TRACKED_CATEGORIES
      .filter(cat => (categoryTotalCounts[cat] ?? 0) >= 3)  // need at least 3 data points
      .map(cat => ({
        category: cat,
        failRate: Math.round(
          ((categoryFailCounts[cat] ?? 0) / (categoryTotalCounts[cat] ?? 1)) * 100
        ),
      }))
      .filter(f => f.failRate >= 30)  // only report if fails ≥30% of the time
      .sort((a, b) => b.failRate - a.failRate)
      .slice(0, 5)

    // ── Step timing analysis — find bottlenecks ──────────────────────────
    const stepDurations: Record<string, number[]> = {}

    for (const s of completed) {
      for (const step of s.steps) {
        if (!step.durationMs) continue
        const key = step.stepName
        if (!stepDurations[key]) stepDurations[key] = []
        stepDurations[key].push(step.durationMs)
      }
    }

    const stepAvgMs: Record<string, number> = {}
    for (const [stepName, durations] of Object.entries(stepDurations)) {
      if (durations.length >= 2) {
        stepAvgMs[stepName] = Math.round(
          durations.reduce((a, b) => a + b, 0) / durations.length
        )
      }
    }

    // Find slowest step (bottleneck)
    const bottleneck = Object.entries(stepAvgMs)
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => ({ name, ms }))[0]

    return {
      bestTemplates: bestTemplates.slice(0, 5),
      commonFailures,
      avgCostPerBuild,
      avgQualityScore,
      totalBuilds: completed.length,
      lastConsolidated: new Date().toISOString(),
      worstQualityCategories: [],
      retryRate,
      fastestTemplate,
      stepAvgMs,
      bottleneckStep: bottleneck ?? null,
    }
  }

  private buildMemoryDoc(insight: DreamInsight, existing: string): string {
    const lines: string[] = [
      `# ZOZO Build Memory`,
      `_Last updated: ${new Date().toLocaleString()}_`,
      ``,
      `## Stats`,
      `- Total completed builds: ${insight.totalBuilds}`,
      `- Average quality score: ${insight.avgQualityScore}/100`,
      `- Average cost per build: $${insight.avgCostPerBuild.toFixed(4)}`,
      ``,
    ]

    if (insight.bestTemplates.length > 0) {
      lines.push(`## Best Performing Templates`)
      for (const t of insight.bestTemplates) {
        lines.push(`- **${t.template}**: avg score ${t.avgScore}/100 (${t.count} builds)`)
      }
      lines.push(``)
    }

    lines.push(`## Notes for Next Build`)
    if (insight.avgQualityScore < 65) {
      lines.push(`- Quality scores are low overall — prioritise dark theme, animations, and glassmorphism`)
    } else if (insight.avgQualityScore >= 85) {
      lines.push(`- Quality scores are high — output is meeting WORLD_CLASS standards`)
    } else {
      lines.push(`- Quality scores are acceptable — focus on design intelligence categories to improve`)
    }

    if (insight.avgCostPerBuild > 0.50) {
      lines.push(`- Cost per build is high ($${insight.avgCostPerBuild.toFixed(4)}) — verify cache_control is active`)
    }

    lines.push(`- Retry rate: ${insight.retryRate}% of builds needed quality gate retries`)
    if (insight.fastestTemplate) {
      lines.push(`- Most reliable template: **${insight.fastestTemplate}** (fewest retries)`)
    }

    if (insight.retryRate > 50) {
      lines.push(`- HIGH retry rate — BuilderAgent is not following design rules. Check if DesignRulesEngine is wired correctly.`)
    } else if (insight.retryRate < 20) {
      lines.push(`- LOW retry rate — output quality is consistent. Consider raising QualityGate threshold to 75.`)
    }

    if (insight.commonFailures.length > 0) {
      lines.push(``)
      lines.push(`## Most Common Quality Failures`)
      for (const f of insight.commonFailures) {
        lines.push(`- **${f.category}**: fails ${f.failRate}% of builds`)
      }
    }

    // Step timing bottleneck section
    if (insight.bottleneckStep && insight.bottleneckStep.ms > 30_000) {
      lines.push(``)
      lines.push(`## Pipeline Timing`)
      const seconds = Math.round(insight.bottleneckStep.ms / 1000)
      lines.push(`- **Bottleneck**: ${insight.bottleneckStep.name} (avg ${seconds}s) — ${this.getStepAdvice(insight.bottleneckStep.name)}`)
      const sortedSteps = Object.entries(insight.stepAvgMs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
      for (const [name, ms] of sortedSteps) {
        lines.push(`- ${name}: ~${Math.round(ms / 1000)}s avg`)
      }
    }

    lines.push(``)

    // Preserve existing notes section if it exists
    const existingNotesMatch = existing.match(/## User Notes\n([\s\S]*?)(?=\n##|$)/)
    if (existingNotesMatch) {
      lines.push(`## User Notes`)
      lines.push(existingNotesMatch[1].trim())
      lines.push(``)
    }

    return lines.join('\n')
  }

  private readMemory(): string {
    try {
      return fs.existsSync(this.memoryPath)
        ? fs.readFileSync(this.memoryPath, 'utf8')
        : ''
    } catch {
      return ''
    }
  }

  private getLastDreamTime(): number | null {
    try {
      const metaPath = path.join(this.memoryDir, 'last-dream.txt')
      if (!fs.existsSync(metaPath)) return null
      return parseInt(fs.readFileSync(metaPath, 'utf8'))
    } catch {
      return null
    }
  }

  private readStructuredMemory(): DreamMemory | null {
    try {
      const jsonPath = path.join(this.memoryDir, 'memory.json')
      if (!fs.existsSync(jsonPath)) return null
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as DreamMemory
      if (raw.version !== MEMORY_VERSION) return null
      return raw
    } catch {
      return null
    }
  }

  private writeStructuredMemory(insight: DreamInsight): void {
    const insights: string[] = []

    if (insight.avgQualityScore >= 85) {
      insights.push(`Output quality is high (avg ${insight.avgQualityScore}/100) — WORLD_CLASS standard`)
    } else if (insight.avgQualityScore >= 65) {
      insights.push(`Output quality is acceptable (avg ${insight.avgQualityScore}/100) — room to improve`)
    } else {
      insights.push(`Quality is low (avg ${insight.avgQualityScore}/100) — check DesignRulesEngine wiring`)
    }

    if (insight.retryRate > 50) {
      insights.push(`High retry rate (${insight.retryRate}%) — BuilderAgent not following design rules`)
    } else if (insight.retryRate < 20) {
      insights.push(`Low retry rate (${insight.retryRate}%) — output is consistently good`)
    }

    if (insight.avgCostPerBuild > 0.50) {
      insights.push(`Cost is high ($${insight.avgCostPerBuild.toFixed(4)}/build) — verify cache_control active`)
    }

    if (insight.bestTemplates.length > 0) {
      const best = insight.bestTemplates[0]!
      insights.push(`Best template: ${best.template} (avg ${best.avgScore}/100 over ${best.count} builds)`)
    }

    if (insight.fastestTemplate) {
      insights.push(`Most reliable template: ${insight.fastestTemplate} (fewest retries)`)
    }

    if (insight.commonFailures.length > 0) {
      const worst = insight.commonFailures[0]!
      insights.push(
        `Most common failure: ${worst.category} (${worst.failRate}% of builds) — ` +
        this.getCategoryAdvice(worst.category)
      )
    }

    if (insight.bottleneckStep && insight.bottleneckStep.ms > 30_000) {
      const seconds = Math.round(insight.bottleneckStep.ms / 1000)
      insights.push(
        `Slowest step: ${insight.bottleneckStep.name} (avg ${seconds}s) — ` +
        this.getStepAdvice(insight.bottleneckStep.name)
      )
    }

    const memory: DreamMemory = {
      version: MEMORY_VERSION,
      lastUpdated: new Date().toISOString(),
      totalBuilds: insight.totalBuilds,
      avgQualityScore: insight.avgQualityScore,
      avgCostPerBuild: insight.avgCostPerBuild,
      retryRate: insight.retryRate,
      bestTemplates: insight.bestTemplates,
      fastestTemplate: insight.fastestTemplate,
      insights: insights.slice(0, 5),
      stepAvgMs: insight.stepAvgMs,
      bottleneckStep: insight.bottleneckStep,
    }

    const jsonPath = path.join(this.memoryDir, 'memory.json')
    fs.writeFileSync(jsonPath, JSON.stringify(memory, null, 2), 'utf8')
  }

  private getCategoryAdvice(category: string): string {
    const advice: Record<string, string> = {
      darkTheme:          'ensure bg-zinc-950 on root layout',
      hasAnimations:      'add framer-motion whileInView to every section',
      hasGradients:       'add hero headline gradient-text and section dividers',
      hasGlassmorphism:   'cards need bg-white/5 backdrop-blur-sm border-white/10',
      typescriptStrict:   'add "strict": true to tsconfig.json',
      noWhiteBackground:  'replace all bg-white with bg-zinc-900',
      hasCustomFonts:     'add next/font/google import to layout.tsx',
      mobileResponsive:   'add sm: md: lg: breakpoint prefixes everywhere',
      spacingSystem:      'use 8px grid — p-2 p-4 p-8 p-16 only',
      colorHarmony:       'limit palette to 8 hex values maximum',
      motionRestraint:    'target 4-8 animations, use whileInView+once:true',
      typographyHierarchy:'h1 text-6xl font-black, h2 text-4xl font-bold',
      layoutStructure:    'wrap in <section py-24 max-w-7xl mx-auto>',
      performanceSafe:    'use next/image for all images, add Suspense',
      noDesignChaos:      'remove style={{}} attrs, use rounded-xl consistently',
    }
    return advice[category] ?? 'review DesignRulesEngine rules'
  }

  private getStepAdvice(stepName: string): string {
    const advice: Record<string, string> = {
      build:       'BuilderAgent is slow — try switching to gemini-2.5-flash for faster generation',
      validate:    'ValidatorAgent taking long — reduce validator strictness or use a faster model',
      security:    'SecurityAgent slow — normal for large codebases, no action needed',
      plan:        'PlannerAgent slow — workspace scan may be too large, check EXCLUDED_DIRS',
      execute:     'File writes slow — check AntigravityWriter for disk I/O issues',
    }
    return advice[stepName] ?? 'check network and API key rate limits'
  }
}
