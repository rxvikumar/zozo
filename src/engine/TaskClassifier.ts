/**
 * TaskClassifier
 *
 * Classifies user prompts into task types and sets TIGHT file budgets
 * BEFORE the PlannerAgent runs. This is the "governor" that prevents
 * hallucinated file counts (22-50 files for a simple dashboard).
 *
 * Architecture: Antigravity governor pattern
 *   classify → set budget → pass to agent → evaluate output
 */

export type TaskType =
  | 'small_ui'        // button, card, color tweak → budget: 1-5 files
  | 'single_page'     // landing page, portfolio → budget: 5-10 files
  | 'dashboard'       // multi-section dashboard → budget: 8-15 files
  | 'multi_page'      // multi-page app → budget: 12-20 files
  | 'full_stack'      // auth + db + api → budget: 15-28 files
  | 'major_feature'   // architectural change → budget: up to 35

export interface TaskClassification {
  type: TaskType
  fileBudget: number          // hard limit passed to planner (API-enforced maxItems)
  justifyBudget: boolean      // true = planner must justify each file in manifest
  requireManifest: boolean    // true = file manifest required before code
  reason: string              // human-readable explanation for logging
  detectedSignals: string[]   // keywords that triggered classification
}

// ─── Task budgets — TIGHT, based on real-world project sizes ─────────────────
// These replace MODE_FILE_LIMITS (express=40, standard=60, full=80)
// which were arbitrary and caused hallucination.
const TASK_BUDGETS: Record<TaskType, number> = {
  small_ui:      5,
  single_page:   10,
  dashboard:     15,
  multi_page:    20,
  full_stack:    28,
  major_feature: 35,
}

// ─── Keyword signals for each task type ──────────────────────────────────────
const TASK_SIGNALS: Record<TaskType, string[]> = {
  small_ui: [
    'change color', 'fix button', 'update text', 'modify', 'tweak',
    'adjust', 'rename', 'replace icon', 'fix spacing', 'add margin',
  ],
  single_page: [
    'landing page', 'portfolio', 'one page', 'simple page', 'hero section',
    'personal site', 'coming soon', 'splash page',
  ],
  dashboard: [
    'dashboard', 'analytics', 'admin panel', 'charts', 'data table',
    'kpi', 'metrics', 'reporting', 'stats panel', 'overview page',
    'management panel', 'control panel',
  ],
  multi_page: [
    'multiple pages', 'settings page', 'profile page', 'billing page',
    'reports page', 'multi-page', 'app with pages', 'navigation between',
    'sidebar with pages', 'route to',
  ],
  full_stack: [
    'auth', 'authentication', 'login', 'stripe', 'payment', 'checkout',
    'database', 'supabase', 'prisma', 'api routes', 'api endpoint',
    'user management', 'backend', 'server actions', 'webhook',
  ],
  major_feature: [
    'rebuild', 'rewrite', 'migrate', 'full rewrite', 'new architecture',
    'from scratch', 'complete overhaul', 'redesign entire',
  ],
}

/**
 * Classify a user prompt into a task type with a file budget.
 * Uses keyword matching — no LLM needed (fast, deterministic).
 */
export function classifyTask(prompt: string): TaskClassification {
  const p = prompt.toLowerCase()
  const detected: Partial<Record<TaskType, string[]>> = {}

  // Count signal hits per type
  for (const [type, signals] of Object.entries(TASK_SIGNALS) as [TaskType, string[]][]) {
    const hits = signals.filter(s => p.includes(s))
    if (hits.length > 0) {
      detected[type] = hits
    }
  }

  // Pick type with most hits (most specific match wins)
  let bestType: TaskType = 'single_page'   // safe default
  let bestCount = 0

  for (const [type, hits] of Object.entries(detected) as [TaskType, string[]][]) {
    if (hits.length > bestCount) {
      bestCount = hits.length
      bestType = type
    }
  }

  // ── Heuristics to escalate when no clear signals ──────────────────────────

  // Word count: longer prompts typically describe more complex projects
  const wordCount = prompt.split(/\s+/).length
  if (bestCount === 0) {
    if (wordCount > 60) bestType = 'full_stack'
    else if (wordCount > 40) bestType = 'multi_page'
    else if (wordCount > 20) bestType = 'dashboard'
  }

  // Explicit page count: "5 pages" → multi_page, "10 pages" → full_stack
  const pageMatch = p.match(/(\d+)\s*pages?/)
  if (pageMatch) {
    const pages = parseInt(pageMatch[1], 10)
    if (pages >= 6) bestType = 'full_stack'
    else if (pages >= 3) bestType = 'multi_page'
    else if (pages >= 2) bestType = 'dashboard'
  }

  // "SaaS" alone → full_stack (has auth, billing, API by definition)
  if (p.includes('saas') && bestType === 'single_page') {
    bestType = 'full_stack'
  }

  const allSignals = Object.values(detected).flat()

  return {
    type: bestType,
    fileBudget: TASK_BUDGETS[bestType],
    justifyBudget: bestType !== 'small_ui',
    requireManifest: bestType !== 'small_ui',
    reason: `Classified as ${bestType} (signals: ${allSignals.join(', ') || 'word count / heuristic'})`,
    detectedSignals: allSignals,
  }
}

/**
 * Returns a concise prompt hint for the PlannerAgent system prompt.
 * Explains WHY this budget exists and what consolidation is expected.
 */
export function classificationToPromptHint(c: TaskClassification): string {
  const consolidationByType: Record<TaskType, string> = {
    small_ui:
      'You are making a small change. Create ONLY the files that need to change. No new files unless essential.',
    single_page:
      'Single page app. Inline all sections in page.tsx where possible. Create a separate file only for components used in 2+ places.',
    dashboard:
      'Dashboard. One Sidebar.tsx, one Layout.tsx, inline page-specific widgets in each page.tsx. Do NOT create per-widget files.',
    multi_page:
      'Multi-page app. Shared layout in Layout.tsx, shared sidebar, inline page-specific UI inside each page file.',
    full_stack:
      'Full-stack app. Group related API routes together. Consolidate small utility types into lib/types.ts.',
    major_feature:
      'Major architectural change. Still consolidate: no barrel index.ts files, no single-use wrapper components.',
  }

  return `
## TASK CLASSIFICATION (Governor)

Task type: ${c.type.toUpperCase().replace('_', ' ')}
File budget: ${c.fileBudget} files MAX (API-enforced — you cannot exceed this)
Reason: ${c.reason}

## CONSOLIDATION RULES FOR THIS TASK
${consolidationByType[c.type]}

## PHASE 1 — INSPECT
Before listing files, answer internally:
- What EXACTLY did the user request? (not assumed features)
- What existing files can be REUSED or MODIFIED?
- What is the simplest file structure that delivers all requested features?

## PHASE 2 — FILE MANIFEST (justify every file)
For each file you plan, confirm it passes this test:
"Would a senior engineer extract this into its own file in a real production codebase?"
If NO → inline it in the parent file instead.

NEVER create:
- index.ts barrel exports
- types/ folder (put types inline in the file that uses them)
- hooks/ with single-use hooks (inline the hook)
- Separate wrapper components used in only one place
- Config files that aren't actually needed

## PHASE 3 — BUDGET CHECK
Your hard limit is ${c.fileBudget} files. If you reach the limit:
- Consolidate remaining UI inline in page files
- Merge simple components together
- Never exceed the limit — the API will reject excess files
`.trim()
}
