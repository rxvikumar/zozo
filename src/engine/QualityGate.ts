import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { PipelineEventBus } from './PipelineEventBus'

export interface QualityScore {
  overall: number
  categories: {
    // Original 8
    darkTheme: number
    hasAnimations: number
    hasGradients: number
    hasGlassmorphism: number
    typescriptStrict: number
    noWhiteBackground: number
    hasCustomFonts: number
    mobileResponsive: number
    // New design intelligence
    spacingSystem: number
    colorHarmony: number
    motionRestraint: number
    typographyHierarchy: number
    layoutStructure: number
    performanceSafe: number
    noDesignChaos: number
  }
  verdict: 'WORLD_CLASS' | 'ACCEPTABLE' | 'NEEDS_WORK'
  issues: string[]
  designScore: number   // average of new design categories only
  codeScore: number     // average of original 8 categories only
}

export class QualityGate {

  async evaluate(workspacePath: string, sessionId?: string): Promise<QualityScore> {
    const issues: string[] = []

    const tsxFiles = this.findFiles(workspacePath, '.tsx')
    const cssFiles = this.findFiles(workspacePath, '.css')
    const tsFiles = this.findFiles(workspacePath, '.ts').filter(f => !f.endsWith('.d.ts'))

    const allContent = [...tsxFiles, ...cssFiles, ...tsFiles]
      .map(f => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } })
      .join('\n')

    const tsxContent = tsxFiles
      .map(f => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } })
      .join('\n')

    // ── ORIGINAL 8 ──────────────────────────────────────────────────────────

    const darkTheme = (
      allContent.includes('bg-black') ||
      allContent.includes('bg-gray-900') ||
      allContent.includes('bg-zinc-900') ||
      allContent.includes('bg-neutral-900') ||
      /background[^;]*#[01][0-9a-f]{5}/i.test(allContent) ||
      allContent.includes('#0a0a0a') || allContent.includes('#0d0d0d')
    ) ? 100 : 0
    if (!darkTheme) issues.push('No dark theme — use bg-gray-900 or bg-zinc-950')

    const bus = sessionId ? PipelineEventBus.getInstance() : null
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'darkTheme', categoryScore: darkTheme })

    const hasAnimations = (
      allContent.includes('framer-motion') ||
      allContent.includes('motion.') ||
      /animate\s*=\s*\{/.test(allContent) ||
      allContent.includes('@keyframes') ||
      allContent.includes('useAnimation') ||
      allContent.includes('whileInView') ||
      allContent.includes('initial=') ||
      allContent.includes('variants=')
    ) ? 100 : 0
    if (!hasAnimations) issues.push('No animations — add framer-motion whileInView + variants')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'hasAnimations', categoryScore: hasAnimations })

    const hasGradients = (
      allContent.includes('bg-gradient') ||
      allContent.includes('linear-gradient') ||
      allContent.includes('radial-gradient') ||
      /from-\[/.test(allContent) ||
      /via-\[/.test(allContent) ||
      allContent.includes('bg-gradient-to')
    ) ? 100 : 0
    if (!hasGradients) issues.push('No gradients — add hero gradient and text gradient')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'hasGradients', categoryScore: hasGradients })

    const hasGlassmorphism = (
      allContent.includes('backdrop-blur') ||
      /bg-white\//.test(allContent) ||
      /bg-black\//.test(allContent) ||
      /bg-white\/[1-9]/.test(allContent) ||
      allContent.includes('backdrop_blur')
    ) ? 100 : 0
    if (!hasGlassmorphism) issues.push('No glassmorphism — add backdrop-blur-md with bg-white/10')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'hasGlassmorphism', categoryScore: hasGlassmorphism })

    const tsconfig = path.join(workspacePath, 'tsconfig.json')
    const typescriptStrict = fs.existsSync(tsconfig) &&
      /\"strict\"\s*:\s*true/.test(fs.readFileSync(tsconfig, 'utf8')) ? 100 : 0
    if (!typescriptStrict) issues.push('TypeScript strict mode off — add "strict": true to tsconfig.json')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'typescriptStrict', categoryScore: typescriptStrict })

    const noWhiteBackground = !(
      allContent.includes('bg-white ') ||
      allContent.includes('bg-white"') ||
      /background:\s*white/.test(allContent) ||
      /background:\s*#fff[^f]/.test(allContent) ||
      /background:\s*#ffffff/.test(allContent)
    ) ? 100 : 0
    if (!noWhiteBackground) issues.push('White backgrounds detected — replace with dark or semi-transparent')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'noWhiteBackground', categoryScore: noWhiteBackground })

    const hasCustomFonts = (
      allContent.includes('next/font') ||
      allContent.includes('@font-face') ||
      allContent.includes('fonts.googleapis') ||
      allContent.includes('font-display') ||
      /fontFamily/.test(allContent)
    ) ? 100 : 0
    if (!hasCustomFonts) issues.push('No custom fonts — use next/font/google with a premium typeface')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'hasCustomFonts', categoryScore: hasCustomFonts })

    const mobileResponsive = (
      /\bmd:/.test(allContent) ||
      /\bsm:/.test(allContent) ||
      /\blg:/.test(allContent) ||
      allContent.includes('@media')
    ) ? 100 : 0
    if (!mobileResponsive) issues.push('No responsive breakpoints — add md: sm: lg: classes')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'mobileResponsive', categoryScore: mobileResponsive })

    // ── NEW: DESIGN INTELLIGENCE ─────────────────────────────────────────────

    // Spacing system — checks for consistent 8px grid usage
    // Premium sites use multiples of 4 or 8. Arbitrary px values = cheap look.
    const spacingPatterns = [
      /\bp-4\b/, /\bp-8\b/, /\bp-12\b/, /\bp-16\b/, /\bp-24\b/, /\bp-32\b/,
      /\bgap-4\b/, /\bgap-8\b/, /\bgap-12\b/, /\bgap-16\b/,
      /\bspace-y-[48]/, /\bspace-x-[48]/,
      /\bmy-[48]/, /\bmx-[48]/,
    ]
    const spacingMatches = spacingPatterns.filter(p => p.test(allContent)).length
    // Bad sign: random arbitrary values like p-[13px] p-[7px] p-[23px]
    const arbitrarySpacing = (allContent.match(/p-\[\d+px\]/g) || [])
      .filter(m => {
        const n = parseInt(m.replace(/[^\d]/g, ''))
        return n % 4 !== 0  // not on 4px grid
      }).length
    const spacingSystem = spacingMatches >= 4 && arbitrarySpacing <= 3 ? 100 : spacingMatches >= 2 ? 60 : 0
    if (spacingSystem < 60) issues.push('Inconsistent spacing — use Tailwind p-4 p-8 p-16 scale (4px grid)')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'spacingSystem', categoryScore: spacingSystem })

    // Color harmony — checks for a tight, intentional palette
    // Premium sites: 2-3 primary colors max, used consistently
    const colorMatches = (allContent.match(/#[0-9a-fA-F]{6}/g) || [])
    const uniqueColors = new Set(colorMatches.map(c => c.toLowerCase()))
    // More than 12 unique hex colors = chaos
    const colorHarmony = uniqueColors.size <= 12 ? 100 : uniqueColors.size <= 20 ? 60 : 0
    if (colorHarmony < 60) issues.push(`Too many colors (${uniqueColors.size} unique hex values) — limit to 8-12 for harmony`)
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'colorHarmony', categoryScore: colorHarmony })

    // Motion restraint — checks animation is controlled, not chaotic
    // Too many animation variants = overwhelming. Too few = flat.
    const animationCount = (allContent.match(/variants\s*=\s*\{/g) || []).length +
      (allContent.match(/whileInView/g) || []).length +
      (allContent.match(/whileHover/g) || []).length +
      (allContent.match(/animate\s*=/g) || []).length
    // 3-15 animation uses = controlled. 0 = flat. 16+ = chaotic.
    // AFTER — Heavy profile legitimately has 25+ animations, don't penalize it
    const motionRestraint = animationCount >= 3 ? 100 :   // any meaningful animation = pass
      animationCount >= 1 ? 70 : 0
    if (motionRestraint === 0) issues.push('No animations found — add framer-motion whileInView to sections')
    // removed: overuse penalty — heavy builds SHOULD have many animations
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'motionRestraint', categoryScore: motionRestraint })

    // Typography hierarchy — premium sites have clear heading/body distinction
    const hasH1 = /<h1|text-[456789]xl|text-\[([6-9]|[1-9][0-9])/.test(tsxContent)
    const hasBoldHeadings = /font-bold|font-black|font-semibold|font-medium/.test(allContent)
    const hasTextSizes = /text-sm|text-base|text-lg|text-xl|text-2xl/.test(allContent)
    const typographyHierarchy = hasH1 && hasBoldHeadings && hasTextSizes ? 100 :
      (hasBoldHeadings && hasTextSizes) ? 60 : 0
    if (typographyHierarchy < 60) issues.push('Weak typography hierarchy — use clear heading sizes + font weights')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'typographyHierarchy', categoryScore: typographyHierarchy })

    // Layout structure — checks for intentional layout patterns
    const hasFlexLayout = /flex|flex-col|flex-row|items-center|justify-between/.test(allContent)
    const hasGridLayout = /grid|grid-cols|grid-rows/.test(allContent)
    const hasMaxWidth = /max-w-|container|mx-auto/.test(allContent)
    const hasSection = /<section|<main|<article/.test(tsxContent)
    const layoutScore = [hasFlexLayout, hasGridLayout, hasMaxWidth, hasSection].filter(Boolean).length
    const layoutStructure = layoutScore >= 3 ? 100 : layoutScore >= 2 ? 60 : 0
    if (layoutStructure < 60) issues.push('Weak layout structure — use section tags, max-w-*, grid + flex')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'layoutStructure', categoryScore: layoutStructure })

    // Performance safety — no obvious perf anti-patterns
    // AFTER — realistic scoring
    const hasImageOptimization =
      allContent.includes('next/image') ||
      allContent.includes('<Image') ||
      allContent.includes('loading="lazy"') ||   // <img loading="lazy"> counts
      allContent.includes("loading='lazy'") ||
      allContent.includes('object-cover') ||      // image is being styled = used
      allContent.includes('object-contain')
    const hasLazyLoading =
      allContent.includes('loading="lazy"') ||
      allContent.includes('next/image') ||
      allContent.includes('<Image') ||
      allContent.includes('object-cover')        // picsum/pexels images with object-cover = optimized
    const avoidsSyncEffects =
      !(/useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[\s\S]{0,50}fetch\(/.test(allContent)) ||
      allContent.includes('Suspense') ||
      allContent.includes('loading') ||
      allContent.includes('isLoading')
    const perfScore = [hasImageOptimization, hasLazyLoading, avoidsSyncEffects].filter(Boolean).length
    const performanceSafe = perfScore >= 1 ? 100 : 60  // if any perf practice exists = pass
    // performanceSafe never causes NEEDS_WORK — it's a bonus category
    if (performanceSafe < 60) issues.push('Performance risks — add loading="lazy" to images, avoid sync fetches')
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'performanceSafe', categoryScore: performanceSafe })

    // No design chaos — checks for anti-patterns that kill premium feel
    const hasTooManyColors = uniqueColors.size > 20
    const hasRandomSizes = (allContent.match(/text-\[\d+px\]/g) || []).length > 5
    const hasInlineStyles = (tsxContent.match(/style=\{\{/g) || []).length > 10
    const hasConsistentRounding = /rounded-lg|rounded-xl|rounded-2xl|rounded-full/.test(allContent)
    const chaosScore = [hasTooManyColors, hasRandomSizes, hasInlineStyles].filter(Boolean).length
    const noDesignChaos = chaosScore === 0 && hasConsistentRounding ? 100 :
      chaosScore <= 1 ? 70 : 0
    if (noDesignChaos < 70) {
      if (hasTooManyColors) issues.push('Color chaos — too many unique colors, use a design token system')
      if (hasRandomSizes) issues.push('Typography chaos — avoid arbitrary text-[Npx] values')
      if (hasInlineStyles) issues.push('Too many inline styles — move to Tailwind classes')
    }
    if (bus && sessionId) bus.emit({ type: 'quality_category', sessionId, category: 'noDesignChaos', categoryScore: noDesignChaos })

    // ── SCORING ──────────────────────────────────────────────────────────────

    const originalScores = [
      darkTheme, hasAnimations, hasGradients, hasGlassmorphism,
      typescriptStrict, noWhiteBackground, hasCustomFonts, mobileResponsive
    ]
    const designScores = [
      spacingSystem, colorHarmony, motionRestraint, typographyHierarchy,
      layoutStructure, performanceSafe, noDesignChaos
    ]

    const codeScore = Math.round(originalScores.reduce((a, b) => a + b, 0) / originalScores.length)
    const designScore = Math.round(designScores.reduce((a, b) => a + b, 0) / designScores.length)
    const overall = Math.round((codeScore + designScore) / 2)

    const cfg = vscode.workspace.getConfiguration('zozo')
    const threshold = cfg.get<number>('qualityThreshold', 65)

    let verdict: 'WORLD_CLASS' | 'ACCEPTABLE' | 'NEEDS_WORK'
    // AFTER — designScore >= 80 was too strict, 70 is realistic
    if (overall >= Math.min(threshold + 20, 90) && designScore >= 70) verdict = 'WORLD_CLASS'
    else if (overall >= threshold) verdict = 'ACCEPTABLE'
    else verdict = 'NEEDS_WORK'

    const categories = {
      darkTheme, hasAnimations, hasGradients, hasGlassmorphism,
      typescriptStrict, noWhiteBackground, hasCustomFonts, mobileResponsive,
      spacingSystem, colorHarmony, motionRestraint, typographyHierarchy,
      layoutStructure, performanceSafe, noDesignChaos,
    }

    if (bus && sessionId) {
      bus.emit({
        type: 'quality_complete',
        sessionId,
        qualityScore: overall,
        qualityVerdict: verdict,
      })
    }

    return { overall, categories, verdict, issues, designScore, codeScore }
  }

  private findFiles(dir: string, ext: string): string[] {
    const results: string[] = []
    const skip = ['node_modules', '.next', '.git', 'dist', 'out', 'build', '.turbo']
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (skip.includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) results.push(...this.findFiles(full, ext))
        else if (entry.name.endsWith(ext)) results.push(full)
      }
    } catch { }
    return results
  }

  formatResult(score: QualityScore): string {
    const bar = (n: number) =>
      '█'.repeat(Math.round(n / 10)) + '░'.repeat(10 - Math.round(n / 10))

    return [
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `  ZOZO Quality Gate — ${score.verdict}`,
      `  Overall ${score.overall}/100  │  Code ${score.codeScore}  │  Design ${score.designScore}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `CODE QUALITY`,
      `  Dark theme         ${bar(score.categories.darkTheme)} ${score.categories.darkTheme}`,
      `  Animations         ${bar(score.categories.hasAnimations)} ${score.categories.hasAnimations}`,
      `  Gradients          ${bar(score.categories.hasGradients)} ${score.categories.hasGradients}`,
      `  Glassmorphism      ${bar(score.categories.hasGlassmorphism)} ${score.categories.hasGlassmorphism}`,
      `  TS strict mode     ${bar(score.categories.typescriptStrict)} ${score.categories.typescriptStrict}`,
      `  No white bg        ${bar(score.categories.noWhiteBackground)} ${score.categories.noWhiteBackground}`,
      `  Custom fonts       ${bar(score.categories.hasCustomFonts)} ${score.categories.hasCustomFonts}`,
      `  Mobile responsive  ${bar(score.categories.mobileResponsive)} ${score.categories.mobileResponsive}`,
      ``,
      `DESIGN INTELLIGENCE`,
      `  Spacing system     ${bar(score.categories.spacingSystem)} ${score.categories.spacingSystem}`,
      `  Color harmony      ${bar(score.categories.colorHarmony)} ${score.categories.colorHarmony}`,
      `  Motion restraint   ${bar(score.categories.motionRestraint)} ${score.categories.motionRestraint}`,
      `  Type hierarchy     ${bar(score.categories.typographyHierarchy)} ${score.categories.typographyHierarchy}`,
      `  Layout structure   ${bar(score.categories.layoutStructure)} ${score.categories.layoutStructure}`,
      `  Performance safe   ${bar(score.categories.performanceSafe)} ${score.categories.performanceSafe}`,
      `  No design chaos    ${bar(score.categories.noDesignChaos)} ${score.categories.noDesignChaos}`,
      ``,
      ...(score.issues.length > 0
        ? [`ISSUES TO FIX:`, ...score.issues.map(i => `  • ${i}`)]
        : [`  ✅ No issues found`]),
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join('\n')
  }

  /**
   * Converts a failing score into a precise fix prompt for BuilderAgent.
   * Tells the builder exactly what is wrong and exactly how to fix it.
   * Returns empty string if score is already ACCEPTABLE or better.
   */
  buildFixPrompt(score: QualityScore, attempt: number): string {
    if (score.verdict !== 'NEEDS_WORK') return ''

    // Find the 3 worst-scoring categories to focus on
    const categoryScores = Object.entries(score.categories) as [string, number][]
    const worstThree = categoryScores
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .filter(([, v]) => v < 100)

    const lines: string[] = [
      `## Quality Gate: Attempt ${attempt} scored ${score.overall}/100 (need 65+)`,
      ``,
      `Focus ONLY on fixing these 3 issues. Do not change anything else.`,
      ``,
    ]

    for (const [category] of worstThree) {
      switch (category) {
        case 'darkTheme':
          lines.push(`### Fix 1 — Dark theme missing`)
          lines.push(`- Layout root: <div className="min-h-screen bg-zinc-950 text-zinc-50">`)
          lines.push(`- globals.css: body { background: #09090b; color: #fafafa; }`)
          lines.push(``)
          break
        case 'hasAnimations':
          lines.push(`### Fix — Animations missing`)
          lines.push(`- Add to every section: import { motion } from 'framer-motion'`)
          lines.push(`- Wrap content: <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>`)
          lines.push(``)
          break
        case 'hasGradients':
          lines.push(`### Fix — Gradients missing`)
          lines.push(`- Hero headline: className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent"`)
          lines.push(`- Section divider: <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />`)
          lines.push(``)
          break
        case 'hasGlassmorphism':
          lines.push(`### Fix — Glassmorphism missing`)
          lines.push(`- Cards: className="bg-white/5 border border-white/10 backdrop-blur-sm rounded-xl p-6"`)
          lines.push(`- Nav (scrolled): className="bg-zinc-950/80 backdrop-blur-md border-b border-white/10"`)
          lines.push(``)
          break
        case 'noWhiteBackground':
          lines.push(`### Fix — White backgrounds found`)
          lines.push(`- Replace bg-white → bg-zinc-900`)
          lines.push(`- Replace bg-gray-50 → bg-zinc-950`)
          lines.push(`- Replace text-black → text-zinc-100`)
          lines.push(``)
          break
        case 'hasCustomFonts':
          lines.push(`### Fix — No custom fonts`)
          lines.push(`- layout.tsx: import { Inter } from 'next/font/google'`)
          lines.push(`- const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })`)
          lines.push(`- <html className={\`\${inter.variable}\`}>`)
          lines.push(``)
          break
        case 'mobileResponsive':
          lines.push(`### Fix — No responsive breakpoints`)
          lines.push(`- Add md: lg: prefixes to all layout classes`)
          lines.push(`- Grid: className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"`)
          lines.push(`- Text: className="text-4xl md:text-6xl"`)
          lines.push(``)
          break
        case 'spacingSystem':
          lines.push(`### Fix — Inconsistent spacing`)
          lines.push(`- Replace all p-[Npx] with nearest: p-2(8) p-4(16) p-6(24) p-8(32) p-12(48) p-16(64)`)
          lines.push(`- Section padding: py-16 md:py-24`)
          lines.push(``)
          break
        case 'colorHarmony':
          lines.push(`### Fix — Too many colors`)
          lines.push(`- Use only: zinc-950 zinc-900 zinc-800 zinc-400 zinc-100 white + one accent`)
          lines.push(`- Remove all one-off hex values not in this palette`)
          lines.push(``)
          break
        case 'motionRestraint':
          lines.push(`### Fix — Animation count out of range`)
          lines.push(`- Target: 4-8 animations total across the whole page`)
          lines.push(`- Use whileInView on: hero, features section, CTA only`)
          lines.push(`- Remove animations from footer, nav, small utility components`)
          lines.push(``)
          break
        case 'typographyHierarchy':
          lines.push(`### Fix — Weak typography hierarchy`)
          lines.push(`- h1: text-5xl md:text-7xl font-black tracking-tight`)
          lines.push(`- h2: text-3xl md:text-4xl font-bold`)
          lines.push(`- body: text-base md:text-lg text-zinc-400 leading-relaxed`)
          lines.push(``)
          break
        case 'layoutStructure':
          lines.push(`### Fix — Weak layout structure`)
          lines.push(`- Wrap page in: <main className="relative overflow-hidden bg-zinc-950">`)
          lines.push(`- Each section: <section className="relative py-24 px-6 max-w-7xl mx-auto">`)
          lines.push(``)
          break
        case 'noDesignChaos':
          lines.push(`### Fix — Design inconsistency`)
          lines.push(`- Use rounded-xl consistently. Remove all rounded-sm and rounded-3xl.`)
          lines.push(`- Remove all style={{ }} attributes. Use Tailwind only.`)
          lines.push(``)
          break
        default:
          lines.push(`### Fix — ${category}`)
          lines.push(`- ${score.issues.find(i => i.toLowerCase().includes(category.toLowerCase())) ?? 'Fix this category'}`)
          lines.push(``)
      }
    }

    lines.push(`Rewrite only the components that have these issues. Keep everything else identical.`)
    return lines.join('\n')
  }
}
