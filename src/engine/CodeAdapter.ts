import type { RawResource } from './ResourceAgent'
import type { ScoredResource } from './TemplateSelector'
import type { DesignRules } from './DesignRulesEngine'

export interface AdaptedResource {
  name: string
  originalSource: string
  adaptedCode: string          // code rewritten for ZOZO's design system
  extractedPatterns: string[]  // structural patterns extracted (not code)
  promptHint: string           // hint injected into BuilderAgent prompt
}

export class CodeAdapter {

  /**
   * Adapt fetched resources to ZOZO's design system.
   * Does NOT use LLM — pure rule-based transformation.
   * Pattern extraction is deterministic and fast.
   */
  adapt(resources: ScoredResource[], rules: DesignRules): AdaptedResource[] {
    return resources.map(r => this.adaptOne(r, rules))
  }

  /**
   * Convert selected resources into a BuilderAgent prompt injection.
   * This is what actually gets added to the builder's system prompt.
   * Keeps it tight — max 600 chars per resource.
   */
  toBuilderHint(adapted: AdaptedResource[], strategy: string): string {
    if (adapted.length === 0) return ''

    const lines = [
      `## Resource Intelligence (${strategy} mode)`,
      ``,
      `The following high-quality component patterns were found.`,
      strategy === 'reuse'
        ? `Strategy: REUSE — adapt the top pattern to the user's specific needs.`
        : `Strategy: HYBRID — use these as structural reference, generate the full implementation.`,
      ``,
    ]

    for (const r of adapted.slice(0, 2)) {  // max 2, not 3
      lines.push(`- ${r.name}: ${r.extractedPatterns.join(', ')}`)

    }

    lines.push(`Apply these patterns with your design rules. Never copy code directly — adapt to zinc-950 dark theme.`)

    return lines.join('\n')
  }

  private adaptOne(scored: ScoredResource, rules: DesignRules): AdaptedResource {
    const { resource } = scored
    const code = resource.code

    // Step 1: Extract structural patterns (what this component does)
    const patterns = this.extractPatterns(code)

    // Step 2: Apply design rule substitutions
    let adapted = code

    // Color substitutions → ZOZO's palette
    adapted = adapted
      .replace(/bg-white(?!\s*\/)/g, 'bg-zinc-950')
      .replace(/bg-gray-50/g, 'bg-zinc-900')
      .replace(/bg-gray-100/g, 'bg-zinc-900')
      .replace(/bg-gray-900/g, 'bg-zinc-950')
      .replace(/text-gray-900/g, 'text-zinc-100')
      .replace(/text-gray-600/g, 'text-zinc-400')
      .replace(/text-gray-500/g, 'text-zinc-500')
      .replace(/border-gray-200/g, 'border-zinc-800')
      .replace(/rounded-lg/g, 'rounded-xl')
      .replace(/rounded-md/g, 'rounded-xl')
      .replace(/rounded-sm/g, 'rounded-lg')
      // Replace accent colors with ZOZO's accent
      .replace(/text-blue-600/g, `text-[${rules.colorAccent}]`)
      .replace(/bg-blue-600/g, `bg-[${rules.colorAccent}]`)
      .replace(/border-blue-600/g, `border-[${rules.colorAccent}]`)

    // Font substitutions
    adapted = adapted
      .replace(/font-inter/gi, 'font-geist')

    // Animation upgrades — add if missing
    if (!resource.hasAnimation && adapted.includes('className=')) {
      // Wrap the outermost div in a motion.div hint (as a comment for the builder)
      adapted = `{/* ZOZO: wrap in motion.div with whileInView={{ opacity:1, y:0 }} initial={{ opacity:0, y:20 }} */}\n` + adapted
    }

    // Step 3: Build the prompt hint
    const promptHint = this.buildPromptHint(resource, patterns, rules)

    return {
      name: resource.name,
      originalSource: resource.source,
      adaptedCode: '', // cap to keep prompt lean
      extractedPatterns: patterns,
      promptHint,
    }
  }

  private extractPatterns(code: string): string[] {
    const patterns: string[] = []

    if (/grid-cols/i.test(code)) patterns.push('grid-layout')
    if (/flex.*items-center/i.test(code)) patterns.push('flex-center')
    if (/whileInView|animate=|motion\./i.test(code)) patterns.push('scroll-animation')
    if (/backdrop-blur/i.test(code)) patterns.push('glassmorphism-card')
    if (/bg-gradient|from-|linear-gradient/i.test(code)) patterns.push('gradient-bg')
    if (/sticky|fixed.*top/i.test(code)) patterns.push('sticky-nav')
    if (/overflow-hidden.*rounded/i.test(code)) patterns.push('card-container')
    if (/group.*hover:|peer/i.test(code)) patterns.push('interactive-hover')
    if (/max-w-.*mx-auto/i.test(code)) patterns.push('centered-container')
    if (/stagger|delay-\[/i.test(code)) patterns.push('staggered-animation')

    return patterns.length > 0 ? patterns : ['standard-layout']
  }

  private buildPromptHint(
    resource: RawResource,
    patterns: string[],
    rules: DesignRules
  ): string {
    return [
      `Use these patterns from ${resource.source}/${resource.name}:`,
      patterns.map(p => `- ${p}`).join('\n'),
      `Apply with: bg-zinc-950 background, ${rules.colorAccent} accent, backdrop-blur-sm cards.`,
      resource.hasAnimation
        ? `This component uses animations — preserve the motion pattern.`
        : `Add whileInView animation since the original lacked it.`,
    ].join('\n')
  }
}
