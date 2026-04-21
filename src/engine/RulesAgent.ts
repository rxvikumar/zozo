/**
 * RulesAgent — zero LLM, zero API cost
 * Runs after Execute, before CodeGuard
 * Enforces strict rules on every generated file
 */

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

export class RulesAgent {
  private outputChannel: vscode.OutputChannel
  private workspaceRoot: string
  private violations: string[] = []
  private fixed: number = 0

  constructor(outputChannel: vscode.OutputChannel, workspaceRoot: string) {
    this.outputChannel = outputChannel
    this.workspaceRoot = workspaceRoot
  }

  async enforce(): Promise<{ violations: number; fixed: number }> {
    this.violations = []
    this.fixed = 0

    const tsxFiles = this.getTsxFiles()
    const cssFiles = this.getCssFiles()

    this.outputChannel.appendLine(`[RULES] Scanning ${tsxFiles.length} tsx/ts + ${cssFiles.length} css files...`)
    for (const f of tsxFiles) {
      this.outputChannel.appendLine(`[RULES]   → ${path.basename(f)}`)
    }

    for (const file of tsxFiles) {
      this.enforceTsxRules(file)
    }

    for (const file of cssFiles) {
      this.enforceCssRules(file)
    }

    this.enforcePackageJson()
    this.enforcePostcssConfig()

    this.outputChannel.appendLine(
      `[RULES] ✅ Enforced: ${this.fixed} fixed, ${this.violations.length} remaining`
    )

    return { violations: this.violations.length, fixed: this.fixed }
  }

  private getTsxFiles(): string[] {
    const dirs = ['components', 'app', 'lib']
    const files: string[] = []
    for (const dir of dirs) {
      const dirPath = path.join(this.workspaceRoot, dir)
      if (!fs.existsSync(dirPath)) continue
      try {
        fs.readdirSync(dirPath)
          .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
          .forEach(f => files.push(path.join(dirPath, f)))
      } catch { }
    }
    return files
  }

  private getCssFiles(): string[] {
    const files: string[] = []
    const globalsCss = path.join(this.workspaceRoot, 'app', 'globals.css')
    if (fs.existsSync(globalsCss)) files.push(globalsCss)
    return files
  }

  private enforceTsxRules(filePath: string) {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf8')
    } catch { return }

    let modified = false
    const name = path.basename(filePath)

    // RULE 1: 'use client' required for interactive components
    const clientKeywords = [
      'motion.', 'useState', 'useEffect', 'useRef',
      'useCallback', 'useMemo', 'onClick', 'onChange',
      'onSubmit', 'framer-motion', 'useReducer',
      'useScroll', 'useInView', 'useAnimation',
    ]
    const needsClient = clientKeywords.some(k => content.includes(k))
    if (needsClient && !content.startsWith("'use client'") && !content.startsWith('"use client"')) {
      content = "'use client'\n\n" + content
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 1: Added 'use client' → ${name}`)
      this.fixed++
    }

    // RULE 2: No @next/font imports
    if (content.includes("from '@next/font'") || content.includes('from "@next/font"')) {
      content = content.replace(/from ['"]@next\/font\/google['"]/g, "from 'next/font/google'")
      content = content.replace(/from ['"]@next\/font['"]/g, "from 'next/font/google'")
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 2: Fixed @next/font → ${name}`)
      this.fixed++
    }

    // RULE 3: No broken import syntax (from "x">)
    if (/from ["'][^"']+["']>/.test(content)) {
      content = content.replace(/from (["'][^"']+["'])>/g, 'from $1;')
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 3: Fixed broken import → ${name}`)
      this.fixed++
    }

    // RULE 4: Must have export default (components only)
    const hasFunction = content.includes('function ') || content.includes('const ')
    const hasExport = content.includes('export default')
    if (hasFunction && !hasExport && filePath.includes('components')) {
      const fnMatch = content.match(/(?:export )?function (\w+)\s*\(/)
      if (fnMatch) {
        content = content.trimEnd() + `\n\nexport default ${fnMatch[1]}\n`
        modified = true
        this.outputChannel.appendLine(`[RULES] 🔧 Rule 4: Added export default → ${name}`)
        this.fixed++
      }
    }

    // RULE 5: No bg-white on dark theme apps (except hover states)
    if (content.includes('bg-white') && !content.includes('dark:')) {
      // Fix bg-white in className strings — replace with dark equivalent
      content = content.replace(/(?<!hover:(?:focus:)?)\bbg-white\b/g, 'bg-zinc-950')
      content = content.replace(/\bbg-gray-50\b/g, 'bg-zinc-950')
      content = content.replace(/\bbg-gray-100\b/g, 'bg-zinc-900')
      content = content.replace(/\bbg-slate-50\b/g, 'bg-zinc-950')
      // Also fix text colors on dark background
      content = content.replace(/\btext-gray-900\b(?![^"]*dark:)/g, 'text-zinc-100')
      content = content.replace(/\btext-black\b(?![^"]*dark:)/g, 'text-zinc-100')
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 5: Replaced bg-white → bg-zinc-900 in ${name}`)
      this.fixed++
    }

    // RULE 7: Broken hover classes like hover:border-[ or hover:bg-[
    if (/hover:[a-z]+-\[\s*\w/.test(content)) {
      content = content.replace(/hover:border-\[\s*[^\]]*\]/g, 'hover:border-zinc-700')
      content = content.replace(/hover:bg-\[\s*[^\]]*\]/g, 'hover:bg-zinc-800')
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 7: Fixed broken hover class → ${name}`)
      this.fixed++
    }

    // RULE 14: Unclosed motion/section/div tags
    const openMotion = (content.match(/<motion\./g) || []).length
    const closeMotion = (content.match(/<\/motion\./g) || []).length
    if (openMotion > closeMotion) {
      content = content.trimEnd() + '\n' + '    </motion.div>\n'.repeat(openMotion - closeMotion)
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 14: Closed unclosed <motion.> in ${name}`)
      this.fixed++
    }

    const openSections = (content.match(/<section/g) || []).length
    const closeSections = (content.match(/<\/section>/g) || []).length
    if (openSections > closeSections) {
      content = content.trimEnd() + '\n' + '    </section>\n'.repeat(openSections - closeSections)
      modified = true
      this.fixed++
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8')
    }
  }

  private enforceCssRules(filePath: string) {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf8')
    } catch { return }

    let modified = false

    // RULE 8: CSS brace mismatch
    const open = (content.match(/\{/g) || []).length
    const close = (content.match(/\}/g) || []).length
    if (open > close) {
      content = content.trimEnd() + '\n}'.repeat(open - close) + '\n'
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 8: Fixed CSS brace mismatch`)
      this.fixed++
    }

    // RULE 9: @keyframes must be top-level
    if (/\.[a-z-]+\s*\{[^}]*@keyframes/.test(content)) {
      this.violations.push(`globals.css: @keyframes nested inside CSS class`)
      this.outputChannel.appendLine(`[RULES] ⚠️ Rule 9: Nested @keyframes in globals.css`)
    }

    // RULE 10: No Tailwind v4 postcss
    if (content.includes('@tailwindcss/postcss')) {
      content = content.replace('@tailwindcss/postcss', 'tailwindcss')
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 10: Fixed Tailwind v4 postcss`)
      this.fixed++
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8')
    }
  }

  private enforcePackageJson() {
    const pkgPath = path.join(this.workspaceRoot, 'package.json')
    if (!fs.existsSync(pkgPath)) return

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    } catch {
      this.violations.push('package.json: invalid JSON')
      return
    }

    let modified = false
    const forbidden = ['eslint', 'eslint-config-next', '@next/font', 'shadcn-ui']

    const deps = (parsed.dependencies || {}) as Record<string, string>
    const devDeps = (parsed.devDependencies || {}) as Record<string, string>

    for (const pkg of forbidden) {
      if (deps[pkg]) {
        delete deps[pkg]
        modified = true
        this.outputChannel.appendLine(`[RULES] 🔧 Rule 11: Removed forbidden: ${pkg}`)
        this.fixed++
      }
      if (devDeps[pkg]) {
        delete devDeps[pkg]
        modified = true
        this.fixed++
      }
    }

    // RULE 12: Pin tailwindcss to v3
    if (devDeps['tailwindcss'] && devDeps['tailwindcss'].startsWith('^4')) {
      devDeps['tailwindcss'] = '^3.4.0'
      modified = true
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 12: Pinned tailwindcss to v3`)
      this.fixed++
    }
    if (deps['tailwindcss'] && deps['tailwindcss'].startsWith('^4')) {
      deps['tailwindcss'] = '^3.4.0'
      modified = true
      this.fixed++
    }

    if (modified) {
      fs.writeFileSync(pkgPath, JSON.stringify(parsed, null, 2), 'utf8')
    }
  }

  private enforcePostcssConfig() {
    const postcssPath = path.join(this.workspaceRoot, 'postcss.config.js')
    if (!fs.existsSync(postcssPath)) return

    const content = fs.readFileSync(postcssPath, 'utf8')

    if (content.includes('@tailwindcss/postcss')) {
      const fixed = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n`
      fs.writeFileSync(postcssPath, fixed, 'utf8')
      this.outputChannel.appendLine(`[RULES] 🔧 Rule 13: Fixed postcss.config.js for Tailwind v3`)
      this.fixed++
    }
  }
}
