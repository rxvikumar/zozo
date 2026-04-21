import * as path from 'path'
import * as fs from 'fs'

export interface APICall {
  callerFile: string
  endpoint: string           // e.g. '/api/stripe/checkout'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'unknown'
}

export interface APIRoute {
  routePath: string          // e.g. '/api/stripe/checkout'
  filePath: string
  methods: string[]          // exported HTTP methods
}

export interface ContractViolation {
  type: 'missing_route' | 'wrong_method'
  endpoint: string
  callerFile: string
  detail: string
}

export interface ContractResult {
  passed: boolean
  violations: ContractViolation[]
  routes: APIRoute[]
  calls: APICall[]
  fixPrompt: string
}

/**
 * APIContractValidator
 *
 * Maps all frontend fetch('/api/...') calls to actual route files.
 * Flags when a frontend calls an endpoint that doesn't exist.
 *
 * This catches the runtime 404 that TypeScript cannot detect.
 * Runs after file writes, before RuntimeVerifier.
 */
export class APIContractValidator {

  validate(workspaceRoot: string): ContractResult {
    const routes = this.discoverRoutes(workspaceRoot)
    const calls = this.extractAPICalls(workspaceRoot)
    const violations: ContractViolation[] = []

    const routeMap = new Map(routes.map(r => [r.routePath, r]))

    for (const call of calls) {
      const route = routeMap.get(call.endpoint)
      if (!route) {
        violations.push({
          type: 'missing_route',
          endpoint: call.endpoint,
          callerFile: call.callerFile,
          detail: `${call.method} ${call.endpoint} called from ${path.basename(call.callerFile)} but route file does not exist`,
        })
      } else if (call.method !== 'unknown' && !route.methods.includes(call.method)) {
        violations.push({
          type: 'wrong_method',
          endpoint: call.endpoint,
          callerFile: call.callerFile,
          detail: `${call.method} not exported from ${route.filePath} — available: ${route.methods.join(', ')}`,
        })
      }
    }

    const fixPrompt = this.buildFixPrompt(violations)

    return {
      passed: violations.length === 0,
      violations,
      routes,
      calls,
      fixPrompt,
    }
  }

  private discoverRoutes(root: string): APIRoute[] {
    const routes: APIRoute[] = []
    const apiDirs = [
      path.join(root, 'app', 'api'),
      path.join(root, 'src', 'app', 'api'),
      path.join(root, 'pages', 'api'),
      path.join(root, 'src', 'pages', 'api'),
    ]

    for (const apiDir of apiDirs) {
      if (!fs.existsSync(apiDir)) continue
      this.walkApiDir(apiDir, apiDir, routes)
    }

    return routes
  }

  private walkApiDir(dir: string, apiBase: string, results: APIRoute[]): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          this.walkApiDir(full, apiBase, results)
        } else if (
          entry.name === 'route.ts' || entry.name === 'route.tsx' ||
          (entry.name.endsWith('.ts') && entry.name !== 'middleware.ts')
        ) {
          const relative = path.relative(apiBase, dir)
          const routePath = '/api/' + relative.replace(/\\/g, '/').replace(/\/\[.*?\]/g, '/:param')

          const content = fs.readFileSync(full, 'utf8')
          const methods: string[] = []
          if (/export.*function\s+GET|export\s+const\s+GET/i.test(content))    methods.push('GET')
          if (/export.*function\s+POST|export\s+const\s+POST/i.test(content))   methods.push('POST')
          if (/export.*function\s+PUT|export\s+const\s+PUT/i.test(content))     methods.push('PUT')
          if (/export.*function\s+DELETE|export\s+const\s+DELETE/i.test(content)) methods.push('DELETE')
          if (/export.*function\s+PATCH|export\s+const\s+PATCH/i.test(content)) methods.push('PATCH')
          // pages/api style
          if (/export\s+default/i.test(content) && methods.length === 0) methods.push('GET', 'POST')

          results.push({ routePath: routePath || '/api', filePath: full, methods })
        }
      }
    } catch {}
  }

  private extractAPICalls(root: string): APICall[] {
    const calls: APICall[] = []
    const skip = ['node_modules', '.next', '.git', 'dist', '__tests__']
    const files = this.findFiles(root, ['.ts', '.tsx'], skip)

    for (const file of files) {
      // Skip the api routes themselves
      if (file.includes(path.sep + 'api' + path.sep)) continue

      try {
        const content = fs.readFileSync(file, 'utf8')

        // Match fetch('/api/...') calls
        const fetchMatches = content.matchAll(
          /fetch\s*\(\s*['"`](\/api\/[^'"`?#]+)/g
        )
        for (const match of fetchMatches) {
          const endpoint = match[1]!
          // Try to detect HTTP method from nearby context
          const pos = match.index ?? 0
          const context = content.slice(Math.max(0, pos - 100), pos + 50).toLowerCase()
          const method: APICall['method'] =
            context.includes("'post'") || context.includes('"post"') ? 'POST'
            : context.includes("'put'") || context.includes('"put"') ? 'PUT'
            : context.includes("'delete'") || context.includes('"delete"') ? 'DELETE'
            : context.includes("'patch'") || context.includes('"patch"') ? 'PATCH'
            : 'GET'

          calls.push({
            callerFile: path.relative(root, file),
            endpoint,
            method,
          })
        }
      } catch {}
    }

    // Deduplicate
    const seen = new Set<string>()
    return calls.filter(c => {
      const key = `${c.endpoint}:${c.method}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private buildFixPrompt(violations: ContractViolation[]): string {
    if (violations.length === 0) return ''

    const missing = violations.filter(v => v.type === 'missing_route')
    const wrongMethod = violations.filter(v => v.type === 'wrong_method')

    const lines = [
      `## API Contract Violations`,
      ``,
      `Frontend code calls API routes that don't exist or use wrong HTTP methods.`,
      ``,
    ]

    if (missing.length > 0) {
      lines.push(`### Missing routes (create these):`)
      for (const v of missing) {
        lines.push(`- Create app/api${v.endpoint.replace('/api', '')}/route.ts`)
        lines.push(`  with exported ${v.detail.includes('POST') ? 'POST' : 'GET'} function`)
      }
      lines.push(``)
    }

    if (wrongMethod.length > 0) {
      lines.push(`### Wrong HTTP methods:`)
      for (const v of wrongMethod) {
        lines.push(`- ${v.detail}`)
      }
    }

    return lines.join('\n')
  }

  private findFiles(root: string, exts: string[], skip: string[]): string[] {
    const results: string[] = []
    const walk = (dir: string) => {
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (skip.includes(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else if (exts.some(ext => e.name.endsWith(ext))) results.push(full)
        }
      } catch {}
    }
    walk(root)
    return results
  }
}
