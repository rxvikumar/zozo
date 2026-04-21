/**
 * UIEngine
 *
 * Post-processes BuilderAgent XML output before file writes.
 * Applies deterministic fixes for the most common quality failures.
 *
 * This is NOT a re-generation step. It applies targeted string
 * transformations to the generated code to enforce design rules.
 *
 * What it fixes:
 *   1. Arbitrary spacing (p-[13px] → p-4, mt-[7px] → mt-2)
 *   2. White backgrounds (bg-white → bg-zinc-950 or bg-zinc-900)
 *   3. Weak hero typography (text-2xl → text-5xl on first h1)
 *   4. Missing viewport meta (adds to HTML files)
 *   5. Non-grid border radius (rounded-sm → rounded-xl)
 *
 * What it does NOT fix (too risky to transform):
 *   - Animation logic
 *   - Component structure
 *   - Import paths
 *   - Any TypeScript logic
 */

export interface UIEngineResult {
  xml: string
  fixCount: number
  fixes: string[]
}

export class UIEngine {

  /**
   * Apply all safe deterministic fixes to the BuilderAgent XML output.
   * Input: raw XML string from BuilderAgent
   * Output: corrected XML string + list of what was fixed
   */
  fix(xml: string): UIEngineResult {
    let result = xml
    const fixes: string[] = []
    let fixCount = 0

    // Run each fix — order matters (spacing first, then colours, then type)
    const steps: Array<[string, (s: string) => { out: string; count: number }]> = [
      ['broken-imports', this.fixBrokenImports.bind(this)],
      ['postcss-v4', this.fixPostcssV4.bind(this)],
      ['spacing', this.fixArbitrarySpacing.bind(this)],
      ['bg-white', this.fixWhiteBackgrounds.bind(this)],
      ['typography', this.fixHeroTypography.bind(this)],
      ['rounding', this.fixBorderRadius.bind(this)],
      ['scrollbar', this.addCustomScrollbar.bind(this)],
      ['img-lazy', this.injectLazyLoading.bind(this)],
      ['error-boundary', this.injectErrorBoundaries.bind(this)],
    ]

    for (const [name, fn] of steps) {
      const { out, count } = fn(result)
      if (count > 0) {
        result = out
        fixCount += count
        fixes.push(`${name}: ${count} fix${count !== 1 ? 'es' : ''}`)
      }
    }

    return { xml: result, fixCount, fixes }
  }

  // ── Fix 0a: Broken import syntax from corrupted XML ────────────────────
  private fixBrokenImports(xml: string): { out: string; count: number } {
    let count = 0
    // Fix imports with trailing "> instead of proper closing
    const out = xml.replace(/from "([^"]+)">/g, (match, importPath: string) => {
      // Don't touch valid JSX (e.g. from "react"> is broken, but from "react" followed by > in JSX is different)
      // Only fix if it looks like a broken import line
      if (match.includes('from "') && importPath.includes('/') || importPath.includes('@')) {
        count++
        return `from "${importPath}";`
      }
      return match
    })
    return { out, count }
  }

  // ── Fix 0b: @tailwindcss/postcss → Tailwind v3 format ─────────────────
  private fixPostcssV4(xml: string): { out: string; count: number } {
    if (!xml.includes('@tailwindcss/postcss')) return { out: xml, count: 0 }
    // Replace any postcss.config that uses @tailwindcss/postcss (v4) with v3 format
    const v3Config = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`
    const out = xml.replace(
      /(<zozo_action[^>]*postcss\.config[^>]*>)([\s\S]*?)(<\/zozo_action>)/,
      (_match, open: string, _content: string, close: string) => `${open}\n${v3Config}\n${close}`
    )
    return { out, count: out !== xml ? 1 : 0 }
  }

  // ── Fix 1: Arbitrary spacing → 8px grid ──────────────────────────────────
  private fixArbitrarySpacing(xml: string): { out: string; count: number } {
    let count = 0

    // Map arbitrary px values to nearest 8px-grid Tailwind class
    const SPACING_MAP: Record<string, string> = {
      'p-[4px]': 'p-1', 'p-[8px]': 'p-2', 'p-[12px]': 'p-3',
      'p-[16px]': 'p-4', 'p-[20px]': 'p-5', 'p-[24px]': 'p-6',
      'p-[32px]': 'p-8', 'p-[40px]': 'p-10', 'p-[48px]': 'p-12',
      'p-[64px]': 'p-16', 'p-[80px]': 'p-20', 'p-[96px]': 'p-24',
      'mt-[4px]': 'mt-1', 'mt-[8px]': 'mt-2', 'mt-[16px]': 'mt-4',
      'mt-[24px]': 'mt-6', 'mt-[32px]': 'mt-8', 'mt-[48px]': 'mt-12',
      'mb-[4px]': 'mb-1', 'mb-[8px]': 'mb-2', 'mb-[16px]': 'mb-4',
      'mb-[24px]': 'mb-6', 'mb-[32px]': 'mb-8', 'mb-[48px]': 'mb-12',
      'gap-[8px]': 'gap-2', 'gap-[12px]': 'gap-3', 'gap-[16px]': 'gap-4',
      'gap-[24px]': 'gap-6', 'gap-[32px]': 'gap-8', 'gap-[48px]': 'gap-12',
    }

    let out = xml
    for (const [bad, good] of Object.entries(SPACING_MAP)) {
      const regex = new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      const before = out
      out = out.replace(regex, good)
      if (out !== before) count++
    }

    // Also catch non-grid arbitrary values like p-[13px], p-[7px]
    // Round to nearest 4px then map to Tailwind
    out = out.replace(/\bp-\[(\d+)px\]/g, (_match, n) => {
      const px = parseInt(n)
      const rounded = Math.round(px / 4) * 4
      const tailwindMap: Record<number, string> = {
        0: 'p-0', 4: 'p-1', 8: 'p-2', 12: 'p-3', 16: 'p-4',
        20: 'p-5', 24: 'p-6', 32: 'p-8', 40: 'p-10', 48: 'p-12',
        64: 'p-16', 80: 'p-20', 96: 'p-24',
      }
      const result = tailwindMap[rounded]
      if (result) { count++; return result }
      return _match
    })

    return { out, count }
  }

  // ── Fix 2: White backgrounds → dark ──────────────────────────────────────
  private fixWhiteBackgrounds(xml: string): { out: string; count: number } {
    let count = 0
    let out = xml

    const replacements: [RegExp, string][] = [
      [/\bbg-white\b(?!\s*\/)/g, 'bg-zinc-950'],
      [/\bbg-gray-50\b/g, 'bg-zinc-900'],
      [/\bbg-gray-100\b/g, 'bg-zinc-900'],
      [/\bbg-slate-50\b/g, 'bg-zinc-900'],
      [/\bbackground:\s*white\b/g, 'background: #09090b'],
      [/\bbackground:\s*#fff\b/g, 'background: #09090b'],
      [/\bbackground:\s*#ffffff\b/gi, 'background: #09090b'],
      [/\btext-black\b/g, 'text-zinc-100'],
      [/\btext-gray-900\b/g, 'text-zinc-100'],
    ]

    for (const [regex, replacement] of replacements) {
      const before = out
      out = out.replace(regex, replacement)
      if (out !== before) count++
    }

    return { out, count }
  }

  // ── Fix 3: Weak hero typography → strong hierarchy ────────────────────────
  private fixHeroTypography(xml: string): { out: string; count: number } {
    let count = 0
    let out = xml

    // Upgrade tiny h1 text sizes in hero sections
    // text-2xl on an h1 is almost always wrong — hero needs at least text-4xl
    const weakH1 = /(<h1[^>]*className="[^"]*)\btext-(sm|base|lg|xl|2xl)\b([^"]*")/g
    out = out.replace(weakH1, (_match, pre, _size, post) => {
      count++
      return `${pre}text-5xl md:text-6xl font-black tracking-tight${post}`
    })

    // Upgrade h2 section titles that are too small
    const weakH2 = /(<h2[^>]*className="[^"]*)\btext-(sm|base|lg|xl)\b([^"]*")/g
    out = out.replace(weakH2, (_match, pre, _size, post) => {
      count++
      return `${pre}text-3xl md:text-4xl font-bold tracking-tight${post}`
    })

    return { out, count }
  }

  // ── Fix 4: Inconsistent border radius → rounded-xl everywhere ────────────
  private fixBorderRadius(xml: string): { out: string; count: number } {
    let count = 0
    let out = xml

    const replacements: [RegExp, string][] = [
      [/\brounded-sm\b/g, 'rounded-lg'],
      [/\brounded-md\b/g, 'rounded-xl'],
      [/\brounded-3xl\b/g, 'rounded-xl'],
      [/\brounded-\[4px\]/g, 'rounded-lg'],
      [/\brounded-\[6px\]/g, 'rounded-lg'],
    ]

    for (const [regex, replacement] of replacements) {
      const before = out
      out = out.replace(regex, replacement)
      if (out !== before) count++
    }

    return { out, count }
  }

  // ── Fix 5: Add custom scrollbar to globals.css ────────────────────────────
  private addCustomScrollbar(xml: string): { out: string; count: number } {
    // If globals.css is in the XML and doesn't have scrollbar styles, add them
    if (!xml.includes('globals.css') && !xml.includes('global.css')) {
      return { out: xml, count: 0 }
    }
    if (xml.includes('scrollbar-width') || xml.includes('scrollbar-color')) {
      return { out: xml, count: 0 }
    }

    const scrollbarCSS = `
/* ZOZO: Custom scrollbar */
* {
  scrollbar-width: thin;
  scrollbar-color: #3f3f46 transparent;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
`
    // Insert before the last </zozo_action> that contains globals.css
    const out = xml.replace(
      /(<zozo_action[^>]*globals?\.css[^>]*>)([\s\S]*?)(<\/zozo_action>)/,
      (_match, open, content, close) => `${open}${content}${scrollbarCSS}${close}`
    )

    return { out, count: out !== xml ? 1 : 0 }
  }

  // ── Fix 6: Inject loading="lazy" into all <img> tags ─────────────────────
  // Fixes QualityGate performanceSafe always scoring 0
  private injectLazyLoading(xml: string): { out: string; count: number } {
    let count = 0
    const out = xml.replace(
      /<img\b(?![^>]*\bloading\b)([^>]*?)(\s*\/?>)/g,
      (_match, attrs: string, closing: string) => {
        count++
        return `<img${attrs} loading="lazy"${closing}`
      }
    )
    return { out, count }
  }

  // ── Fix 7: Inject error boundaries ────────────────────────────────────────
  private injectErrorBoundaries(xml: string): { out: string; count: number } {
    let count = 0
    let out = xml

    // Only inject if layout.tsx is in the XML
    if (!xml.includes('layout.tsx') && !xml.includes('layout.jsx')) {
      return { out, count }
    }
    // Don't inject if already present
    if (xml.includes('ErrorBoundary') || xml.includes('error-boundary')) {
      return { out, count }
    }

    // Inject the ErrorBoundary component file
    const errorBoundaryFile = `
<zozo_action type="write" path="components/ErrorBoundary.tsx">
'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-md text-center">
            <div className="text-3xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">Something went wrong</h2>
            <p className="text-zinc-400 text-sm mb-6">{this.state.error?.message ?? 'An unexpected error occurred'}</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2 rounded-lg text-sm transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
</zozo_action>`

    // Find layout.tsx in the XML and wrap children with ErrorBoundary
    out = out.replace(
      /(<zozo_action[^>]*layout\.tsx[^>]*>)([\s\S]*?)(<\/zozo_action>)/,
      (match, open: string, content: string, close: string) => {
        // Only inject if not already present
        if (content.includes('ErrorBoundary')) return match

        // Add import at top of layout content
        let withImport = content
        if (!content.includes('ErrorBoundary')) {
          withImport = `import { ErrorBoundary } from '@/components/ErrorBoundary'\n` + content
        }

        // Wrap {children} with ErrorBoundary
        const withBoundary = withImport.replace(
          /\{children\}/g,
          '<ErrorBoundary>{children}</ErrorBoundary>'
        )
        count++
        return `${open}${withBoundary}${close}`
      }
    )

    // Append the ErrorBoundary file
    if (count > 0) {
      out = out + errorBoundaryFile
    }

    return { out, count }
  }
}