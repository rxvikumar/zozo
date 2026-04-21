import * as path from 'path'
import * as fs from 'fs'
import { spawn } from 'child_process'

export interface RuntimeError {
  type: 'console_error' | 'unhandled_rejection' | 'env_missing' | 'import_error' | 'hydration'
  message: string
  source?: string
  fixable: boolean   // whether RuntimeVerifier knows how to fix this
}

export interface RuntimeResult {
  passed: boolean
  errors: RuntimeError[]
  warnings: RuntimeWarning[]
  serverStarted: boolean
  timeoutMs: number
}

export interface RuntimeWarning {
  message: string
  type: 'perf' | 'deprecation' | 'config'
}

const TIMEOUT_MS = 45_000  // 45s to start dev server and settle

/**
 * RuntimeVerifier
 *
 * Starts `npm run dev`, waits for the server to be ready,
 * captures errors from stdout/stderr, classifies them,
 * and returns actionable fix prompts.
 *
 * Does NOT use a browser — purely process-level output analysis.
 * This covers the most common real-world failures.
 */
export class RuntimeVerifier {

  async verify(workspaceRoot: string): Promise<RuntimeResult> {
    // First check if node_modules exists
    if (!fs.existsSync(path.join(workspaceRoot, 'node_modules'))) {
      return {
        passed: false,
        errors: [{
          type: 'import_error',
          message: 'node_modules not found — run npm install first',
          fixable: false,
        }],
        warnings: [],
        serverStarted: false,
        timeoutMs: 0,
      }
    }

    return new Promise(resolve => {
      const errors: RuntimeError[] = []
      const warnings: RuntimeWarning[] = []
      let serverStarted = false
      let settled = false
      const startTime = Date.now()

      const proc = spawn('npm', ['run', 'dev'], {
        cwd: workspaceRoot,
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      })

      const finish = () => {
        if (settled) return
        settled = true
        try { proc.kill() } catch {}

        resolve({
          passed: errors.filter(e => e.type !== 'hydration').length === 0,
          errors,
          warnings,
          serverStarted,
          timeoutMs: Date.now() - startTime,
        })
      }

      const handleOutput = (data: Buffer) => {
        const text = data.toString()

        // Server ready signal
        if (text.includes('Ready in') || text.includes('started server on') || text.includes('Local:')) {
          serverStarted = true
          // Give it 5 more seconds to surface any startup errors
          setTimeout(finish, 5_000)
        }

        // Classify errors
        this.classifyOutput(text, errors, warnings)
      }

      proc.stdout?.on('data', handleOutput)
      proc.stderr?.on('data', handleOutput)

      // Hard timeout
      setTimeout(() => {
        if (!settled) {
          if (!serverStarted) {
            errors.push({
              type: 'import_error',
              message: 'Dev server failed to start within 45 seconds',
              fixable: false,
            })
          }
          finish()
        }
      }, TIMEOUT_MS)

      proc.on('error', err => {
        errors.push({
          type: 'import_error',
          message: `Failed to start dev server: ${err.message}`,
          fixable: false,
        })
        finish()
      })
    })
  }

  private classifyOutput(text: string, errors: RuntimeError[], warnings: RuntimeWarning[]): void {
    const lines = text.split('\n')

    for (const line of lines) {
      const l = line.toLowerCase()

      // Missing environment variables (very common)
      if (l.includes('missing env') || l.includes('environment variable') ||
          (l.includes('undefined') && l.includes('process.env'))) {
        const envMatch = line.match(/([A-Z_]{4,})\s*(?:is\s+)?(?:not|missing|undefined)/i)
        errors.push({
          type: 'env_missing',
          message: envMatch
            ? `Missing environment variable: ${envMatch[1]}`
            : `Missing environment variable: ${line.slice(0, 100)}`,
          fixable: true,
        })
        continue
      }

      // Import/module errors
      if (l.includes("cannot find module") || l.includes("module not found")) {
        const modMatch = line.match(/cannot find module '([^']+)'/i) ??
                         line.match(/module not found.*'([^']+)'/i)
        errors.push({
          type: 'import_error',
          message: modMatch
            ? `Module not found: ${modMatch[1]} — add to package.json dependencies`
            : line.slice(0, 150),
          fixable: true,
        })
        continue
      }

      // Hydration errors (React server/client mismatch)
      if (l.includes('hydration') || l.includes('did not match')) {
        errors.push({
          type: 'hydration',
          message: 'Hydration mismatch — component renders differently on server vs client',
          fixable: true,
        })
        continue
      }

      // Unhandled promise rejections
      if (l.includes('unhandledrejection') || l.includes('unhandled rejection')) {
        errors.push({
          type: 'unhandled_rejection',
          message: line.slice(0, 150),
          fixable: false,
        })
        continue
      }

      // Console errors (but not warnings)
      if (l.includes('error') && !l.includes('warning') && line.length > 20) {
        errors.push({
          type: 'console_error',
          message: line.slice(0, 150),
          fixable: false,
        })
      }

      // Deprecation warnings
      if (l.includes('deprecat')) {
        warnings.push({ message: line.slice(0, 100), type: 'deprecation' })
      }
    }
  }

  /**
   * Convert runtime errors into a FixAgent prompt.
   */
  toFixPrompt(result: RuntimeResult): string {
    const fixable = result.errors.filter(e => e.fixable)
    if (fixable.length === 0) return ''

    const lines = [
      `## Runtime Errors (dev server)`,
      ``,
      `The app starts but has ${fixable.length} runtime error(s). Fix them.`,
      ``,
    ]

    // Group by type
    const envErrors    = fixable.filter(e => e.type === 'env_missing')
    const importErrors = fixable.filter(e => e.type === 'import_error')
    const hydration    = fixable.filter(e => e.type === 'hydration')

    if (envErrors.length > 0) {
      lines.push(`### Missing Environment Variables`)
      lines.push(`Create a .env.local file with these variables:`)
      for (const e of envErrors) {
        const varName = e.message.replace('Missing environment variable: ', '')
        lines.push(`${varName}=your_value_here`)
      }
      lines.push(`Also add these to .env.example with empty values as documentation.`)
      lines.push(``)
    }

    if (importErrors.length > 0) {
      lines.push(`### Missing Modules`)
      for (const e of importErrors) {
        lines.push(`- ${e.message}`)
      }
      lines.push(`Add these to package.json dependencies and call npm install.`)
      lines.push(``)
    }

    if (hydration.length > 0) {
      lines.push(`### Hydration Errors`)
      lines.push(`Wrap the affected component in a useEffect + useState to defer client-only rendering:`)
      lines.push(`const [mounted, setMounted] = useState(false)`)
      lines.push(`useEffect(() => setMounted(true), [])`)
      lines.push(`if (!mounted) return null`)
      lines.push(``)
    }

    return lines.join('\n')
  }
}
