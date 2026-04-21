import { PackageRegistry, FORBIDDEN_PACKAGES } from './PackageRegistry'

export interface ImportViolation {
  file: string
  importPath: string
  violationType: 'forbidden_package' | 'wrong_shadcn_path' | 'wrong_import_syntax'
  correction: string
}

export interface ValidationResult {
  xml: string
  violations: ImportViolation[]
  fixedCount: number
}

/**
 * ImportValidator
 *
 * Scans BuilderAgent XML output for import violations before file writes.
 * Fixes known violations automatically (forbidden package → correct path).
 * Catches what UIEngine cannot — import-level errors, not class-level errors.
 *
 * Runs in pipeline position: Builder → ImportValidator → UIEngine → Write
 */
export class ImportValidator {
  private registry = new PackageRegistry()

  validate(xml: string): ValidationResult {
    const violations: ImportViolation[] = []
    let result = xml
    let fixedCount = 0

    // Fix 1: shadcn-ui → @/components/ui/[name]
    const shadcnFixes: [RegExp, string][] = [
      [/from ['"]shadcn-ui['"]/g, `from '@/components/ui/button'`],
      [/from ['"]@shadcn\/ui['"]/g, `from '@/components/ui/button'`],
    ]
    for (const [pattern, fix] of shadcnFixes) {
      const before = result
      result = result.replace(pattern, fix)
      if (result !== before) {
        fixedCount++
        violations.push({
          file: 'multiple',
          importPath: 'shadcn-ui',
          violationType: 'wrong_shadcn_path',
          correction: fix,
        })
      }
    }

    // Fix 2: Specific shadcn component wrong paths
    // e.g., import { Button } from 'shadcn/button' → @/components/ui/button
    result = result.replace(
      /from ['"](?:shadcn|@shadcn)\/([a-z-]+)['"]/g,
      (_match, component) => {
        fixedCount++
        return `from '@/components/ui/${component}'`
      }
    )

    // Fix 3: Wrong framer imports
    const before3a = result
    result = result.replace(/from ['"]@framer\/motion['"]/g, `from 'framer-motion'`)
    if (result !== before3a) fixedCount++

    const before3b = result
    result = result.replace(/from ['"]motion['"]/g, `from 'framer-motion'`)
    if (result !== before3b) fixedCount++

    // Fix 4: Old react-query → @tanstack/react-query
    const before4 = result
    result = result.replace(/from ['"]react-query['"]/g, `from '@tanstack/react-query'`)
    if (result !== before4) fixedCount++

    // Fix 5: Wrong next-auth paths
    const before5a = result
    result = result.replace(/from ['"]next-auth\/next['"]/g, `from 'next-auth'`)
    if (result !== before5a) fixedCount++

    const before5b = result
    result = result.replace(/from ['"]next-auth\/client['"]/g, `from 'next-auth/react'`)
    if (result !== before5b) fixedCount++

    // Fix 6: Wrong supabase imports
    const before6a = result
    result = result.replace(/from ['"]supabase-js['"]/g, `from '@supabase/supabase-js'`)
    if (result !== before6a) fixedCount++

    const before6b = result
    result = result.replace(/from ['"]@supabase\/auth-js['"]/g, `from '@supabase/supabase-js'`)
    if (result !== before6b) fixedCount++

    // Fix 7: Wrong stripe imports
    const before7 = result
    result = result.replace(/from ['"]stripe-js['"]/g, `from '@stripe/stripe-js'`)
    if (result !== before7) fixedCount++

    // Fix 8: "latest" versions in package.json blocks
    // Find package.json in XML and fix version pinning
    result = result.replace(
      /(<zozo_action[^>]*package\.json[^>]*>)([\s\S]*?)(<\/zozo_action>)/,
      (_match, open: string, content: string, close: string) => {
        let fixed = content
        // Replace "latest" with registry versions where known
        fixed = fixed.replace(/"([^"]+)":\s*"latest"/g, (m, pkg: string) => {
          const version = this.registry.getVersion(pkg)
          return version ? `"${pkg}": "${version}"` : m
        })
        // Replace "*" with specific versions
        fixed = fixed.replace(/"([^"]+)":\s*"\*"/g, (m, pkg: string) => {
          const version = this.registry.getVersion(pkg)
          return version ? `"${pkg}": "${version}"` : m
        })
        if (fixed !== content) fixedCount++
        return `${open}${fixed}${close}`
      }
    )

    return { xml: result, violations, fixedCount }
  }
}
