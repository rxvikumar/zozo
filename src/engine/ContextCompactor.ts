/**
 * ContextCompactor
 *
 * Enforces a token budget before sending context to any LLM agent.
 * Prevents the "context explosion" problem where each layer adds more
 * context and the model degrades in output quality.
 *
 * Priority order (what survives cuts):
 *   1. Design rules    — always survive intact (agent needs these)
 *   2. Fix prompt      — always survive intact (retry must focus on the fix)
 *   3. Memory context  — top 5 bullet points only
 *   4. Resource hint   — truncated to 40% of remaining budget
 *   5. Workspace ctx   — truncated last (least critical per token)
 *
 * Separate file: Orchestrator.ts calls this, never contains this logic.
 */

export interface CompactInput {
  designRules:      string
  memoryContext:    string
  workspaceContext: string
  resourceHint:     string
  fixPrompt?:       string
  packageConstraints?: string  // NEVER compacted — anti-hallucination
}

export interface CompactOutput {
  designRules:         string
  memoryContext:       string
  workspaceContext:    string
  resourceHint:        string
  fixPrompt:           string
  packageConstraints:  string  // always intact
  totalChars:          number
  wasCompacted:        boolean
  budgetUsedPct:       number   // 0-100, useful for logging
}

const DEFAULT_TARGET_CHARS = 6_000    // ~1500 tokens — smaller context = more room for Builder output
const RETRY_TARGET_CHARS   = 5_000    // tighter budget on quality retries

export const OUTPUT_DISCIPLINE = `
## Output discipline (MANDATORY)
- Generate ONLY code. Zero explanation text outside XML tags.
- Zero inline comments unless they are // TODO or // IMPORTANT for the developer.
- Zero docstrings on obvious functions.
- Every zozo_action tag must contain complete, runnable code — no placeholders.
- Never write "// ... rest of component" or "// existing code here".
`

export class ContextCompactor {

  compact(input: CompactInput, isRetry = false): CompactOutput {
    const TARGET = isRetry ? RETRY_TARGET_CHARS : DEFAULT_TARGET_CHARS
    const fixPrompt = input.fixPrompt ?? ''
    const packageConstraints = input.packageConstraints ?? ''
    let wasCompacted = false

    // Fixed: design rules + fix prompt + package constraints never get cut
    const fixedLen = input.designRules.length + fixPrompt.length + packageConstraints.length
    let budget = TARGET - fixedLen

    // On retry: skip memory, workspace, resource entirely — focus only on fix
    if (isRetry) {
      return {
        designRules:      input.designRules,
        memoryContext:    '',
        workspaceContext: '',
        resourceHint:     '',
        fixPrompt,
        packageConstraints,
        totalChars:       fixedLen,
        wasCompacted:     input.memoryContext.length > 0 || input.workspaceContext.length > 0,
        budgetUsedPct:    Math.round((fixedLen / TARGET) * 100),
      }
    }

    // Memory: top 5 bullet points only
    let memory = input.memoryContext
    if (memory.length > 600) {
      const bullets = memory.split('\n').filter(l => l.startsWith('- ')).slice(0, 5)
      memory = bullets.length > 0 ? `## Memory\n${bullets.join('\n')}\n` : ''
      wasCompacted = true
    }
    memory = this.stripVerbosity(memory)
    budget -= memory.length

    // Resource hint: 40% of remaining budget
    let resourceHint = input.resourceHint
    const resourceBudget = Math.max(0, Math.floor(budget * 0.40))
    if (resourceHint.length > resourceBudget) {
      resourceHint = resourceHint.slice(0, resourceBudget) + '\n[truncated]'
      wasCompacted = true
    }
    budget -= resourceHint.length

    // Workspace context: rest of budget
    let workspaceContext = input.workspaceContext
    if (workspaceContext.length > Math.max(0, budget)) {
      workspaceContext = workspaceContext.slice(0, Math.max(0, budget)) +
        '\n[workspace truncated — token budget]'
      wasCompacted = true
    }
    workspaceContext = this.stripVerbosity(workspaceContext)

    const totalChars = input.designRules.length + fixPrompt.length + packageConstraints.length +
      memory.length + resourceHint.length + workspaceContext.length

    return {
      designRules:      input.designRules,
      memoryContext:    memory,
      workspaceContext: workspaceContext,
      resourceHint,
      fixPrompt,
      packageConstraints,
      totalChars,
      wasCompacted,
      budgetUsedPct:    Math.round((totalChars / TARGET) * 100),
    }
  }

  /**
   * Strip LLM verbosity from any string before sending as context.
   * Removes: explanatory comments, redundant whitespace, markdown headers
   * that duplicate information already in design rules.
   */
  private stripVerbosity(text: string): string {
    return text
      // Remove triple-slash comments from TypeScript snippets in context
      .replace(/\/\/\/[^\n]*/g, '')
      // Remove "Note:", "Important:", "Remember:" lines (already in system prompt)
      .replace(/^(Note|Important|Remember|Warning):[^\n]*/gm, '')
      // Collapse multiple blank lines to one
      .replace(/\n{3,}/g, '\n\n')
      // Remove trailing whitespace per line
      .replace(/ +$/gm, '')
      .trim()
  }
}
