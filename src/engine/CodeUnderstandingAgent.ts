import * as path from 'path'
import * as fs from 'fs'

export interface WorkspaceUnderstanding {
  hasNextJs: boolean
  hasTailwind: boolean
  hasTypescript: boolean
  hasPrisma: boolean
  hasSupabase: boolean
  hasStripe: boolean
  hasAuth: boolean
  hasTests: boolean
  framework: 'nextjs' | 'react' | 'vue' | 'unknown'
  packageNames: string[]          // top-level dependencies
  existingPages: string[]         // pages/app router routes detected
  existingComponents: string[]    // component files found
  isExistingProject: boolean      // true if project already has code
  summary: string                 // human-readable one paragraph
}

/**
 * CodeUnderstandingAgent
 *
 * Reads the workspace structure BEFORE BuilderAgent runs.
 * Tells PlannerAgent what already exists so it doesn't overwrite it.
 *
 * Separate from PlannerAgent: understanding what exists is a
 * different concern from planning what to build.
 *
 * Inspired by code-review-graph dependency analysis pattern.
 * Does NOT use LLM — pure filesystem analysis.
 */
export class CodeUnderstandingAgent {

  analyze(workspaceRoot: string): WorkspaceUnderstanding {
    const empty: WorkspaceUnderstanding = {
      hasNextJs: false, hasTailwind: false, hasTypescript: false,
      hasPrisma: false, hasSupabase: false, hasStripe: false,
      hasAuth: false, hasTests: false,
      framework: 'unknown',
      packageNames: [], existingPages: [], existingComponents: [],
      isExistingProject: false,
      summary: 'Empty workspace — building from scratch.',
    }

    try {
      // Read package.json
      const pkgPath = path.join(workspaceRoot, 'package.json')
      if (!fs.existsSync(pkgPath)) return empty

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }

      const allDeps = {
        ...pkg.dependencies ?? {},
        ...pkg.devDependencies ?? {},
      }
      const depNames = Object.keys(allDeps)

      const hasNextJs    = depNames.some(d => d === 'next')
      const hasTailwind  = depNames.some(d => d === 'tailwindcss' || d.includes('tailwind'))
      const hasTypescript = depNames.some(d => d === 'typescript')
      const hasPrisma    = depNames.some(d => d === '@prisma/client' || d === 'prisma')
      const hasSupabase  = depNames.some(d => d.includes('supabase'))
      const hasStripe    = depNames.some(d => d.includes('stripe'))
      const hasAuth      = depNames.some(d =>
        d.includes('next-auth') || d.includes('clerk') || d.includes('auth0')
      )

      // Detect framework
      let framework: WorkspaceUnderstanding['framework'] = 'unknown'
      if (hasNextJs)                           framework = 'nextjs'
      else if (depNames.includes('react'))     framework = 'react'
      else if (depNames.includes('vue'))       framework = 'vue'

      // Find existing pages
      const existingPages = this.findPages(workspaceRoot)
      const existingComponents = this.findComponents(workspaceRoot)

      // Test detection
      const hasTests = depNames.some(d =>
        d === 'jest' || d === 'vitest' || d.includes('testing-library')
      )

      const isExistingProject = existingPages.length > 0 || existingComponents.length > 2

      // Build summary
      const techStack = [
        hasNextJs ? 'Next.js' : null,
        hasTailwind ? 'Tailwind' : null,
        hasTypescript ? 'TypeScript' : null,
        hasPrisma ? 'Prisma' : null,
        hasSupabase ? 'Supabase' : null,
        hasStripe ? 'Stripe' : null,
        hasAuth ? 'Auth' : null,
      ].filter(Boolean).join(', ')

      const summary = isExistingProject
        ? `Existing ${framework} project with ${techStack || 'no major libraries'}. ` +
          `Found ${existingPages.length} pages and ${existingComponents.length} components. ` +
          `Build should ADD to existing structure, not replace it.`
        : `Empty ${framework !== 'unknown' ? framework : ''} workspace. ` +
          `Tech stack detected: ${techStack || 'none'}. Building from scratch.`

      return {
        hasNextJs, hasTailwind, hasTypescript, hasPrisma,
        hasSupabase, hasStripe, hasAuth, hasTests,
        framework,
        packageNames: depNames.slice(0, 20),
        existingPages,
        existingComponents,
        isExistingProject,
        summary,
      }
    } catch {
      return empty
    }
  }

  /**
   * Convert understanding to a PlannerAgent prompt injection.
   * Called from Orchestrator before step 3.
   */
  toPromptHint(understanding: WorkspaceUnderstanding): string {
    if (!understanding.isExistingProject) {
      return `## Workspace: Empty — build from scratch\nStack detected: ${understanding.packageNames.slice(0, 5).join(', ') || 'none'}`
    }

    return [
      `## Existing Workspace (DO NOT OVERWRITE)`,
      `Framework: ${understanding.framework}`,
      `Stack: ${[
        understanding.hasNextJs    ? 'Next.js'    : '',
        understanding.hasTailwind  ? 'Tailwind'   : '',
        understanding.hasTypescript ? 'TypeScript' : '',
        understanding.hasPrisma    ? 'Prisma'     : '',
        understanding.hasSupabase  ? 'Supabase'   : '',
        understanding.hasStripe    ? 'Stripe'     : '',
      ].filter(Boolean).join(', ')}`,
      `Existing pages: ${understanding.existingPages.slice(0, 8).join(', ') || 'none'}`,
      `Existing components: ${understanding.existingComponents.slice(0, 8).join(', ') || 'none'}`,
      ``,
      `RULES for this workspace:`,
      `- ADD new files, do not rewrite existing ones unless explicitly asked`,
      `- Respect the existing routing structure`,
      `- Match the existing import style and file naming`,
    ].join('\n')
  }

  private findPages(root: string): string[] {
    const pages: string[] = []
    const pageDirs = [
      path.join(root, 'pages'),
      path.join(root, 'src', 'pages'),
      path.join(root, 'app'),
      path.join(root, 'src', 'app'),
    ]
    for (const dir of pageDirs) {
      if (fs.existsSync(dir)) {
        pages.push(...this.listFiles(dir, ['.tsx', '.ts', '.jsx', '.js']).slice(0, 15))
      }
    }
    return pages
  }

  private findComponents(root: string): string[] {
    const compDirs = [
      path.join(root, 'components'),
      path.join(root, 'src', 'components'),
    ]
    const result: string[] = []
    for (const dir of compDirs) {
      if (fs.existsSync(dir)) {
        result.push(...this.listFiles(dir, ['.tsx', '.jsx']).slice(0, 20))
      }
    }
    return result
  }

  private listFiles(dir: string, exts: string[]): string[] {
    const results: string[] = []
    const skip = ['node_modules', '.next', '.git', 'dist', 'out']
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (skip.includes(e.name)) continue
        if (e.isFile() && exts.some(ext => e.name.endsWith(ext))) {
          results.push(e.name)
        }
      }
    } catch {}
    return results
  }
}
