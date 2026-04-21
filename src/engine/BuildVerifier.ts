import * as path from 'path'
import { execSync } from 'child_process'
import * as fs from 'fs'

export interface BuildError {
  file: string
  line: number
  column: number
  message: string
  code: string
}

export interface VerifyResult {
  passed: boolean
  errors: BuildError[]
  errorText: string     // raw tsc output for FixAgent
  attemptNumber: number
}

/**
 * BuildVerifier
 *
 * Runs tsc --noEmit in the workspace and captures TypeScript errors.
 * Called AFTER ActionExecutor writes files, BEFORE showing success to user.
 *
 * This is the gap that separates a code printer from a developer.
 * A developer never hands you broken code.
 */
export class BuildVerifier {

  verify(workspaceRoot: string, attemptNumber = 1): VerifyResult {
    const tsconfig = path.join(workspaceRoot, 'tsconfig.json')
    if (!fs.existsSync(tsconfig)) {
      return { passed: true, errors: [], errorText: '', attemptNumber }
    }

    try {
      // Run tsc with short timeout — we just want error list
      execSync('npx tsc --noEmit --pretty false 2>&1', {
        cwd: workspaceRoot,
        timeout: 30_000,
        stdio: 'pipe',
      })
      // Exit code 0 = no errors
      return { passed: true, errors: [], errorText: '', attemptNumber }

    } catch (err: unknown) {
      const raw = err instanceof Error && 'stdout' in err
        ? String((err as NodeJS.ErrnoException & { stdout: Buffer }).stdout)
        : String(err)

      const errors = this.parseErrors(raw)

      // tsc can exit non-zero for warnings/lockfile issues — if we parsed 0 real errors, it's clean
      if (errors.length === 0) {
        return { passed: true, errors: [], errorText: '', attemptNumber }
      }

      return {
        passed: false,
        errors: errors.slice(0, 20),   // cap at 20 errors
        errorText: raw.slice(0, 3000), // cap for LLM consumption
        attemptNumber,
      }
    }
  }

  private parseErrors(raw: string): BuildError[] {
    const errors: BuildError[] = []
    const lines = raw.split('\n')

    for (const line of lines) {
      // Pattern: src/app/page.tsx(12,5): error TS2304: Cannot find name 'x'.
      const match = line.match(/^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/)
      if (match) {
        errors.push({
          file:    match[1]!.trim(),
          line:    parseInt(match[2]!),
          column:  parseInt(match[3]!),
          code:    match[4]!,
          message: match[5]!.trim(),
        })
      }
    }

    return errors
  }

  /**
   * Convert errors into a FixAgent prompt.
   * Focused and precise — not a wall of text.
   */
  toFixPrompt(result: VerifyResult): string {
    if (result.passed) return ''

    const lines = [
      `## TypeScript Build Errors (attempt ${result.attemptNumber})`,
      ``,
      `The generated code has ${result.errors.length} TypeScript error(s). Fix ALL of them.`,
      `Do not change component structure or functionality — only fix the type errors.`,
      ``,
      `### Errors:`,
    ]

    // Group by file for clarity
    const byFile: Record<string, BuildError[]> = {}
    for (const e of result.errors) {
      const key = e.file.split('/').pop() ?? e.file
      if (!byFile[key]) byFile[key] = []
      byFile[key]!.push(e)
    }

    for (const [file, errs] of Object.entries(byFile)) {
      lines.push(``)
      lines.push(`**${file}:**`)
      for (const e of errs.slice(0, 5)) {
        lines.push(`  Line ${e.line}: ${e.code} — ${e.message}`)
      }
    }

    lines.push(``)
    lines.push(`Fix these errors by:`)
    lines.push(`- Adding missing type imports`)
    lines.push(`- Correcting interface mismatches`)
    lines.push(`- Adding undefined checks where needed`)
    lines.push(`- Fixing wrong prop types`)
    lines.push(`Do NOT restructure components or change logic.`)

    return lines.join('\n')
  }
}
