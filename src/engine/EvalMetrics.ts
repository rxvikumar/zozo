/**
 * EvalMetrics
 *
 * Collects all pipeline metrics into a single EvalScorecard and
 * emits it to PipelineEventBus after each build. The sidebar
 * renders it as a "Build Scorecard" card below the last message.
 *
 * Architecture: Antigravity evaluation pattern
 *   step metrics → accumulate → scorecard → emit → render
 */

import { PipelineEventBus } from './PipelineEventBus'

export interface EvalScorecard {
  // ── Build health ──────────────────────────────────────────────────────────
  buildSuccess: boolean          // files written without fatal errors
  runtimePassed: boolean         // dev server started OK (RuntimeVerifier)

  // ── Planner quality ───────────────────────────────────────────────────────
  fileEfficiency: number         // ManifestValidator: (justified/total)*100
  budgetCompliance: boolean      // stayed within task budget
  fileBudgetUsed: number
  fileBudgetAllowed: number
  hallucinationsRemoved: number  // files auto-removed by ManifestValidator

  // ── Code quality (from QualityGate) ──────────────────────────────────────
  qualityScore: number           // overall QualityGate score
  codeScore: number
  designScore: number
  tsErrors: number               // TypeScript errors found

  // ── Generation stats ──────────────────────────────────────────────────────
  retryCount: number             // quality gate retries needed
  filesGenerated: number
  filesSkipped: number

  // ── Performance ───────────────────────────────────────────────────────────
  buildDurationMs: number
  estimatedCostUsd: number

  // ── Grade ─────────────────────────────────────────────────────────────────
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F'

  // ── Targets (shown next to values in sidebar) ─────────────────────────────
  targets: {
    fileEfficiency: 80
    qualityScore: 70
    tsErrors: 0
    buildSuccess: true
  }
}

/** Default scorecard — filled in incrementally during pipeline. */
export function createEmptyScorecard(): EvalScorecard {
  return {
    buildSuccess: false,
    runtimePassed: false,
    fileEfficiency: 0,
    budgetCompliance: true,
    fileBudgetUsed: 0,
    fileBudgetAllowed: 15,
    hallucinationsRemoved: 0,
    qualityScore: 0,
    codeScore: 0,
    designScore: 0,
    tsErrors: 0,
    retryCount: 0,
    filesGenerated: 0,
    filesSkipped: 0,
    buildDurationMs: 0,
    estimatedCostUsd: 0,
    overallGrade: 'F',
    targets: {
      fileEfficiency: 80,
      qualityScore: 70,
      tsErrors: 0,
      buildSuccess: true,
    },
  }
}

/**
 * Compute an A-F letter grade from the scorecard.
 * Weighted scoring mirrors Antigravity's evaluation parameters.
 */
export function computeGrade(s: EvalScorecard): 'A' | 'B' | 'C' | 'D' | 'F' {
  let score = 0

  // Build success is most important (30 pts)
  if (s.buildSuccess) score += 30

  // No TypeScript errors (20 pts)
  if (s.tsErrors === 0) score += 20
  else if (s.tsErrors <= 2) score += 10
  else if (s.tsErrors <= 5) score += 5

  // File efficiency (15 pts)
  if (s.fileEfficiency >= 80) score += 15
  else if (s.fileEfficiency >= 70) score += 10
  else if (s.fileEfficiency >= 50) score += 5

  // Quality score (20 pts)
  if (s.qualityScore >= 75) score += 20
  else if (s.qualityScore >= 65) score += 15
  else if (s.qualityScore >= 50) score += 8

  // Budget compliance (10 pts)
  if (s.budgetCompliance) score += 10

  // Runtime (5 pts)
  if (s.runtimePassed) score += 5

  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

/**
 * Emit the completed scorecard to PipelineEventBus.
 * ChatSidebarProvider listens for 'build_scorecard' and renders the card.
 */
export function emitScorecard(scorecard: EvalScorecard, sessionId: string): void {
  scorecard.overallGrade = computeGrade(scorecard)
  PipelineEventBus.getInstance().emit({
    type: 'build_scorecard',
    sessionId,
    scorecard: scorecard as any,
  })

  console.log(
    `[EVAL] Scorecard: Grade ${scorecard.overallGrade} | ` +
    `Efficiency ${scorecard.fileEfficiency}% | ` +
    `Quality ${scorecard.qualityScore}/100 | ` +
    `TS errors ${scorecard.tsErrors} | ` +
    `Cost ~$${scorecard.estimatedCostUsd.toFixed(3)}`
  )
}

/**
 * Format the scorecard for the VS Code output channel.
 */
export function formatScorecard(s: EvalScorecard): string {
  const row = (label: string, value: string, target: string, ok: boolean) =>
    `  ${ok ? '✅' : '⚠️ '} ${label.padEnd(24)} ${value.padStart(8)}  →  ${target}`

  return [
    `━━━ 📊 Build Scorecard — Grade ${s.overallGrade} ━━━`,
    row('Build success',    s.buildSuccess ? 'YES' : 'NO',    'YES',    s.buildSuccess),
    row('File efficiency',  `${s.fileEfficiency}%`,           '≥ 80%',  s.fileEfficiency >= 80),
    row('Quality score',    `${s.qualityScore}/100`,          '≥ 70',   s.qualityScore >= 70),
    row('TypeScript errors',`${s.tsErrors}`,                  '= 0',    s.tsErrors === 0),
    row('Budget compliance',s.budgetCompliance ? 'YES' : 'NO','YES',    s.budgetCompliance),
    row('Files generated',  `${s.filesGenerated}`,            '',       true),
    row('Quality retries',  `${s.retryCount}`,                '',       s.retryCount === 0),
    row('Build time',       `${Math.round(s.buildDurationMs / 1000)}s`,  '', true),
    row('Est. cost',        `$${s.estimatedCostUsd.toFixed(3)}`, '',    true),
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n')
}
