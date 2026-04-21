import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { PackageRegistry, FORBIDDEN_PACKAGES } from './PackageRegistry'

export interface ReconcileResult {
  missingInPackageJson: string[]   // imported in code, not in package.json
  unusedInPackageJson:  string[]   // in package.json, no import found
  brokenImportPaths:    Array<{ file: string; importPath: string; suggestion?: string }>
  npmInstallRan:        boolean
  installSuccess:       boolean
}

// Known package name → npm package mapping
// Some imports don't match npm package names exactly
const IMPORT_TO_PACKAGE: Record<string, string> = {
  'framer-motion':         'framer-motion',
  'next/image':            'next',
  'next/link':             'next',
  'next/font':             'next',
  'next/font/google':      'next',     // built into next — no separate package
  '@next/font':            'next',     // deprecated alias — maps to next core
  'next/navigation':       'next',
  '@supabase/supabase-js': '@supabase/supabase-js',
  'stripe':                'stripe',
  '@stripe/stripe-js':     '@stripe/stripe-js',
  'lucide-react':          'lucide-react',
  'clsx':                  'clsx',
  'tailwind-merge':        'tailwind-merge',
  'class-variance-authority': 'class-variance-authority',
  'sonner':                'sonner',
  'recharts':              'recharts',
  'zod':                   'zod',
  'react-hook-form':       'react-hook-form',
  '@hookform/resolvers':   '@hookform/resolvers',
  'axios':                 'axios',
  'swr':                   'swr',
  '@tanstack/react-query': '@tanstack/react-query',
  'next-themes':           'next-themes',
  'next-auth':             'next-auth',
  '@clerk/nextjs':         '@clerk/nextjs',
  'prisma':                'prisma',
  '@prisma/client':        '@prisma/client',
  'date-fns':              'date-fns',
  'zustand':               'zustand',
  'jotai':                 'jotai',
}

// Packages that come bundled — no install needed
const BUILT_IN = new Set([
  'react', 'react-dom', 'next', 'node:path', 'node:fs', 'node:os',
  'path', 'fs', 'os', 'crypto', 'http', 'https', 'child_process', 'util',
])

/**
 * DependencyReconciler
 *
 * Scans generated TypeScript files for import statements.
 * Compares against package.json.
 * Adds missing packages to package.json.
 * Runs npm install.
 *
 * This closes the #1 post-generation failure: "Cannot find module X".
 */
export class DependencyReconciler {

  async reconcile(workspaceRoot: string): Promise<ReconcileResult> {
    const pkgPath = path.join(workspaceRoot, 'package.json')
    const result: ReconcileResult = {
      missingInPackageJson: [],
      unusedInPackageJson:  [],
      brokenImportPaths:    [],
      npmInstallRan:        false,
      installSuccess:       false,
    }

    if (!fs.existsSync(pkgPath)) return result

    // Read package.json
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const existingDeps = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ])

    // Scan all TS/TSX files for imports
    const files = this.findTypeScriptFiles(workspaceRoot)
    const importedPackages = new Set<string>()
    const brokenPaths: ReconcileResult['brokenImportPaths'] = []

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const imports = this.extractImports(content)

        for (const imp of imports) {
          if (imp.startsWith('.') || imp.startsWith('/')) {
            // Relative import — check if file exists
            const broken = this.checkRelativePath(file, imp, workspaceRoot)
            if (broken) brokenPaths.push({ file: path.relative(workspaceRoot, file), importPath: imp, suggestion: broken })
          } else {
            // External package — extract package name
            const pkgName = this.extractPackageName(imp)
            if (pkgName && !BUILT_IN.has(pkgName)) {
              importedPackages.add(pkgName)
            }
          }
        }
      } catch {}
    }

    // Find missing packages
    const missing: string[] = []
    for (const p of importedPackages) {
      const actualPkg = IMPORT_TO_PACKAGE[p] ?? p
      if (!existingDeps.has(actualPkg)) {
        missing.push(actualPkg)
      }
    }

    result.brokenImportPaths    = brokenPaths.slice(0, 10)

    // Filter out invalid package names (path aliases, relative paths, etc.)
    const validPackageName = (name: string): boolean => {
      if (name.startsWith('@/')) return false     // path alias, not npm package
      if (name.startsWith('./')) return false
      if (name.startsWith('../')) return false
      if (name.includes(' ')) return false         // spaces = not a valid package name
      if (name.startsWith('#')) return false        // TypeScript path alias
      if (name === '') return false
      return true
    }
    const validMissing = missing.filter(validPackageName)

    // Filter out forbidden packages (hallucination safety net)
    const forbidden = new Set(FORBIDDEN_PACKAGES)
    const filteredMissing = validMissing.filter(pkg => !forbidden.has(pkg))

    if (missing.length !== filteredMissing.length) {
      const blocked = missing.filter(pkg => !validPackageName(pkg) || forbidden.has(pkg))
      console.warn(`[ZOZO] Blocked invalid/forbidden packages: ${blocked.join(', ')}`)
    }

    result.missingInPackageJson = filteredMissing

    // Add missing to package.json with pinned versions from registry
    if (filteredMissing.length > 0) {
      const registry = new PackageRegistry()
      try {
        const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (!updatedPkg.dependencies) updatedPkg.dependencies = {}
        for (const dep of filteredMissing) {
          const pinnedVersion = registry.getVersion(dep)
          updatedPkg.dependencies[dep] = pinnedVersion ?? '^1.0.0'
        }
        fs.writeFileSync(pkgPath, JSON.stringify(updatedPkg, null, 2), 'utf8')
      } catch {}
    }

    // Always run npm install (ensures all deps are installed, not just new ones)
    try {
      result.npmInstallRan = true
      execSync('npm install --legacy-peer-deps --prefer-offline', {
        cwd: workspaceRoot,
        timeout: 120_000,
        stdio: 'pipe',
      })
      result.installSuccess = true
    } catch {
      // Try without --prefer-offline
      try {
        execSync('npm install --legacy-peer-deps', {
          cwd: workspaceRoot,
          timeout: 180_000,
          stdio: 'pipe',
        })
        result.installSuccess = true
      } catch {}
    }

    return result
  }

  private extractImports(content: string): string[] {
    const imports: string[] = []
    const patterns = [
      /^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm,
      /^import\s+['"]([^'"]+)['"]/gm,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    ]
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) imports.push(match[1])
      }
    }
    return imports
  }

  private extractPackageName(importPath: string): string | null {
    if (importPath.startsWith('@')) {
      // Scoped package: @supabase/supabase-js → @supabase/supabase-js
      const parts = importPath.split('/')
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
    }
    // Regular package: framer-motion/client → framer-motion
    return importPath.split('/')[0] ?? null
  }

  private checkRelativePath(
    fromFile: string,
    importPath: string,
    workspaceRoot: string
  ): string | null {
    const dir = path.dirname(fromFile)
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '', '/index.ts', '/index.tsx']

    for (const ext of extensions) {
      const candidate = path.resolve(dir, importPath + ext)
      if (fs.existsSync(candidate)) return null  // found — not broken
    }

    // Broken — try to suggest a fix
    const basename = path.basename(importPath)
    const suggestion = this.findSimilarFile(basename, workspaceRoot)
    return suggestion ?? 'file not found'
  }

  private findSimilarFile(name: string, root: string): string | null {
    try {
      const all = this.findTypeScriptFiles(root)
      const match = all.find(f => path.basename(f, path.extname(f)).toLowerCase() === name.toLowerCase())
      return match ? path.relative(root, match) : null
    } catch { return null }
  }

  private findTypeScriptFiles(root: string): string[] {
    const results: string[] = []
    const skip = ['node_modules', '.next', '.git', 'dist', 'out', 'build']
    const walk = (dir: string) => {
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (skip.includes(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) results.push(full)
        }
      } catch {}
    }
    walk(root)
    return results
  }
}
