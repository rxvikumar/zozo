/**
 * ManifestValidator
 *
 * Scores the PlannerAgent's output BEFORE passing to BuilderAgent.
 * Runs immediately after planning to catch hallucinated files and
 * budget violations — then emits metrics to PipelineEventBus.
 *
 * Architecture: Antigravity evaluator pattern
 *   agent output → evaluate → score → emit → sidebar displays
 */

import { PipelineEventBus } from './PipelineEventBus'

export interface ManifestScore {
  fileEfficiency: number            // (justified / total) * 100
  budgetCompliance: boolean         // stayed within task budget
  budgetUsed: number
  budgetAllowed: number
  removedFiles: string[]            // hallucinations auto-removed
  unnecessaryPatterns: string[]     // patterns that shouldn't be there
  missingRequired: string[]         // required files not in plan
  consolidationSuggestions: string[]
  passed: boolean                   // efficiency >= 70 AND budget compliant AND no missing required
}

// ─── Files that should NEVER appear in generated output ──────────────────────
const NEVER_GENERATE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^index\.(ts|js)$/, reason: 'barrel exports (hallucination)' },
  { pattern: /\/index\.(ts|js)$/, reason: 'barrel exports in subdirectory (hallucination)' },
  { pattern: /\.test\.(ts|tsx)$/, reason: 'tests are not part of UI generation' },
  { pattern: /\.spec\.(ts|tsx)$/, reason: 'spec files are not part of UI generation' },
  { pattern: /\.stories\.(ts|tsx)$/, reason: 'storybook stories not needed in build output' },
  { pattern: /README\.md$/i, reason: 'documentation not needed in build output' },
  { pattern: /CHANGELOG\.md$/i, reason: 'changelog not needed in build output' },
  { pattern: /\.env(\.local|\.example)?$/, reason: 'env files should not be generated' },
]

// ─── Files that should be created only if truly needed ───────────────────────
const RARELY_NEEDED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^types\//, reason: 'types/ folder — put types inline in the file that uses them' },
  { pattern: /^hooks\/use[A-Z]/, reason: 'custom hook file — inline the hook if used only once' },
  { pattern: /^constants\//, reason: 'constants/ folder — put constants in lib/utils.ts' },
  { pattern: /^utils\//, reason: 'utils/ folder — put utilities in lib/utils.ts' },
  { pattern: /^contexts\//, reason: 'contexts/ folder — only needed for truly global state' },
  { pattern: /^providers\//, reason: 'providers/ folder — use layout.tsx instead' },
]

// ─── Files that must ALWAYS be present ───────────────────────────────────────
const ALWAYS_REQUIRED = [
  'package.json',
  'tsconfig.json',
  'tailwind.config.ts',
  'next.config.js',
  'postcss.config.js',
  'app/layout.tsx',
  'app/page.tsx',
  'app/globals.css',
]

/**
 * Validate and score a list of planned files.
 * Auto-removes hallucinated files.
 * Returns the cleaned file list and a score.
 */
export function validateManifest(
  filesToCreate: string[],
  budget: number,
  sessionId?: string
): { cleaned: string[]; score: ManifestScore } {
  const bus = sessionId ? PipelineEventBus.getInstance() : null

  // ── Step 1: Detect and remove hallucinations ─────────────────────────────
  const removed: string[] = []
  const cleaned = filesToCreate.filter(f => {
    const hallucination = NEVER_GENERATE_PATTERNS.find(({ pattern }) => pattern.test(f))
    if (hallucination) {
      removed.push(f)
      console.log(`[MANIFEST] Removed hallucination: ${f} (${hallucination.reason})`)
      return false
    }
    return true
  })

  // ── Step 2: Flag rarely-needed patterns (warn but don't remove) ───────────
  const unnecessaryPatterns: string[] = []
  for (const f of cleaned) {
    const rarely = RARELY_NEEDED_PATTERNS.find(({ pattern }) => pattern.test(f))
    if (rarely) {
      unnecessaryPatterns.push(`${f} — ${rarely.reason}`)
    }
  }

  // ── Step 3: Check required files ─────────────────────────────────────────
  const missingRequired = ALWAYS_REQUIRED.filter(f => !cleaned.includes(f))

  // ── Step 4: Compute efficiency ───────────────────────────────────────────
  // Efficiency = files that are justified / total planned
  // Hallucinations are subtracted from the justified count
  const justified = cleaned.length - unnecessaryPatterns.length
  const fileEfficiency = cleaned.length > 0
    ? Math.round(Math.max(0, justified / cleaned.length) * 100)
    : 100

  // ── Step 5: Budget compliance ─────────────────────────────────────────────
  const budgetCompliance = cleaned.length <= budget

  // ── Step 6: Build suggestions ─────────────────────────────────────────────
  const suggestions: string[] = []
  if (removed.length > 0) {
    suggestions.push(`Auto-removed ${removed.length} hallucinated file(s): ${removed.join(', ')}`)
  }
  if (unnecessaryPatterns.length > 0) {
    suggestions.push(`Consider consolidating: ${unnecessaryPatterns.slice(0, 3).join('; ')}`)
  }
  if (missingRequired.length > 0) {
    suggestions.push(`Missing required files: ${missingRequired.join(', ')}`)
  }
  if (!budgetCompliance) {
    suggestions.push(
      `Over budget: ${cleaned.length}/${budget} files. Consolidate page-specific UI inline in page.tsx files.`
    )
  }

  const passed = fileEfficiency >= 70 && budgetCompliance && missingRequired.length === 0

  const score: ManifestScore = {
    fileEfficiency,
    budgetCompliance,
    budgetUsed: cleaned.length,
    budgetAllowed: budget,
    removedFiles: removed,
    unnecessaryPatterns,
    missingRequired,
    consolidationSuggestions: suggestions,
    passed,
  }

  // ── Emit to EventBus ──────────────────────────────────────────────────────
  if (bus && sessionId) {
    bus.emit({
      type: 'planner_metric',
      sessionId,
      fileEfficiency,
      budgetUsed: cleaned.length,
      budgetAllowed: budget,
    } as any)
  }

  return { cleaned, score }
}

/**
 * Format a ManifestScore for output channel logging.
 */
export function formatManifestScore(score: ManifestScore): string {
  const lines = [
    `ManifestValidator: ${score.passed ? '✅ PASSED' : '⚠️ NEEDS ATTENTION'}`,
    `  File efficiency: ${score.fileEfficiency}% (target ≥ 70%)`,
    `  Budget: ${score.budgetUsed}/${score.budgetAllowed} files`,
  ]
  if (score.removedFiles.length > 0) {
    lines.push(`  Auto-removed ${score.removedFiles.length} hallucination(s)`)
  }
  if (score.missingRequired.length > 0) {
    lines.push(`  ⚠️  Missing: ${score.missingRequired.join(', ')}`)
  }
  if (score.consolidationSuggestions.length > 0) {
    lines.push(`  Suggestions: ${score.consolidationSuggestions[0]}`)
  }
  return lines.join('\n')
}
