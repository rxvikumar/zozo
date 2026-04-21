import * as vscode from 'vscode'
import { GEMINI_MODELS } from './NetworkNode'

export type ComplexityMode  = 'normal' | 'ultra' | 'max'
export type UIStyle         = 'minimal' | 'modern' | 'premium'
export type AnimationLevel  = 'none' | 'light' | 'heavy'
export type VisualDepth     = '2d' | '3d' | 'hybrid'
export type Inspiration     = 'framer' | 'blender' | 'saas-clean' | 'web3' | 'editorial'

export interface BuildProfile {
  prompt:      string
  complexity:  ComplexityMode
  uiStyle:     UIStyle
  animation:   AnimationLevel
  visualDepth: VisualDepth
  inspiration: Inspiration[]
  efficient:   boolean          // true = Planner+Design use free model, only Builder uses selected
  // Auto-derived from above:
  selectedModel:    string
  selectedProvider: string
  pipelineMode:     'express' | 'standard' | 'full'
  designPreset:     string
}

// Model routing table — complexity + depth → model
function selectModel(
  complexity: ComplexityMode,
  depth: VisualDepth,
  animation: AnimationLevel,
  provider: string
): string {
  switch (provider.toLowerCase()) {
    case 'anthropic':
      if (complexity === 'max') return 'claude-opus-4-6'
      if (complexity === 'ultra') return 'claude-opus-4-6'
      return 'claude-sonnet-4-6'  // Normal always uses Sonnet

    case 'gemini':
      if (complexity === 'max')   return 'gemini-3.1-pro-preview'   // paid
      if (complexity === 'ultra') return 'gemini-3.1-pro-preview'   // paid
      return 'gemini-2.5-flash'   // 1500 req/day free — Pro only gets 25/day

    case 'openai':
      if (complexity === 'max') return 'gpt-4o'
      if (complexity === 'ultra') return 'gpt-4o'
      return 'gpt-4o-mini'  // Normal uses mini

    default:
      return complexity === 'normal' ? 'gemini-2.5-flash' : 'gemini-3.1-pro-preview'
  }
}

// Design preset routing — inspiration → DesignRulesEngine preset key
function selectPreset(inspiration: Inspiration[], uiStyle: UIStyle): string {
  if (inspiration.includes('web3'))       return 'dark-3d'
  if (inspiration.includes('blender'))    return 'dark-3d'
  if (inspiration.includes('editorial')) return 'wearebrand-approach'
  if (inspiration.includes('framer'))    return 'lovable-beater'
  if (uiStyle === 'minimal')             return 'dark-minimal'
  if (uiStyle === 'premium')             return 'emergent-beater'
  return 'saas'
}

// Pipeline mode — complexity drives this, not just prompt length
function selectPipelineMode(complexity: ComplexityMode, visualDepth: VisualDepth): 'express' | 'standard' | 'full' {
  if (complexity === 'max') return 'full'
  if (complexity === 'normal') return 'express'  // Normal ALWAYS express — never full
  if (complexity === 'ultra' || visualDepth === '3d') return 'full'
  if (visualDepth === 'hybrid') return 'standard'
  return 'express'
}

/**
 * BuildProfileCapture
 *
 * Captures structured user intent before the pipeline runs.
 * Shows a VS Code QuickPick flow — 5 questions, 10 seconds.
 *
 * Output drives: model selection, preset, pipeline mode, package choices.
 * Replaces: Supervisor LLM call for mode detection (faster + more accurate).
 */
export class BuildProfileCapture {

  async capture(prompt: string, provider: string): Promise<BuildProfile | null> {
    // Q1 — Complexity
    const complexity = await vscode.window.showQuickPick([
      {
        label: '$(zap) Normal',
        description: 'Fast · 2-3 min · Flash (1500 req/day free) / Sonnet · $0',
        detail: 'Best for: landing pages, portfolios, simple apps',
        value: 'normal' as ComplexityMode,
      },
      {
        label: '$(sparkle) Ultra',
        description: 'Premium · 8-12 min · Gemini 3 Pro / Opus · ~$0.10-0.60',
        detail: 'Best for: SaaS products, complex dashboards, immersive UIs',
        value: 'ultra' as ComplexityMode,
      },
      {
        label: '$(flame) Max \uD83D\uDD25',
        description: 'Top model for EVERY step · no cost limits · maximum quality',
        detail: '\u26A0\uFE0F Uses Opus / Gemini 3 Pro for ALL steps. API costs will be high.',
        value: 'max' as ComplexityMode,
      },
    ], {
      title: 'ZOZO — Step 1 of 5: Complexity',
      placeHolder: 'How much time and quality do you want?',
      ignoreFocusOut: true,
    }) as (vscode.QuickPickItem & { value: ComplexityMode }) | undefined
    if (!complexity) return null

    // Efficient mode toggle — only for Normal mode
    let efficient = false
    if (complexity.value === 'normal') {
      const qualityChoice = await vscode.window.showQuickPick([
        {
          label: '$(star-full) Quality',
          description: 'All agents use selected model',
          detail: 'Standard build — every agent uses your chosen model',
          value: 'quality',
        },
        {
          label: '$(battery) Efficient',
          description: 'Only Builder uses selected model · ~50% cheaper',
          detail: 'Planner + Design → gemini-2.5-flash (free). Builder → your model.',
          value: 'efficient',
        },
      ], {
        title: 'ZOZO — Cost Mode',
        placeHolder: 'Quality uses all agents on your model. Efficient saves credits.',
        ignoreFocusOut: true,
      }) as (vscode.QuickPickItem & { value: string }) | undefined
      if (!qualityChoice) return null
      efficient = qualityChoice.value === 'efficient'
    }

    // Q2 — UI Style
    const uiStyle = await vscode.window.showQuickPick([
      {
        label: '$(circle-outline) Minimal',
        description: 'Clean · few elements · focused',
        detail: 'Linear, Notion, or Apple style — no noise',
        value: 'minimal' as UIStyle,
      },
      {
        label: '$(layers) Modern',
        description: 'Balanced · dark theme · professional',
        detail: 'Standard SaaS — Stripe, Vercel, Tailwind Plus style',
        value: 'modern' as UIStyle,
      },
      {
        label: '$(star-full) Premium',
        description: 'Immersive · rich · high-end',
        detail: 'Framer sites, WEAREBRAND, award-winning UI style',
        value: 'premium' as UIStyle,
      },
    ], {
      title: 'ZOZO — Step 2 of 5: UI Style',
      placeHolder: 'How should the interface feel?',
      ignoreFocusOut: true,
    }) as (vscode.QuickPickItem & { value: UIStyle }) | undefined
    if (!uiStyle) return null

    // Q3 — Animation
    const animation = await vscode.window.showQuickPick([
      {
        label: '$(circle-slash) None',
        description: 'Static · fast load · focused',
        detail: 'No motion — best for dashboards, data-heavy apps',
        value: 'none' as AnimationLevel,
      },
      {
        label: '$(arrow-up) Light',
        description: 'Subtle fade + slide · professional feel',
        detail: 'Entry animations on scroll — standard premium feel',
        value: 'light' as AnimationLevel,
      },
      {
        label: '$(flame) Heavy',
        description: 'Parallax · complex motion · cinematic',
        detail: 'Full Framer Motion — hero animations, stagger, transitions',
        value: 'heavy' as AnimationLevel,
      },
    ], {
      title: 'ZOZO — Step 3 of 5: Animation',
      placeHolder: 'How much motion do you want?',
      ignoreFocusOut: true,
    }) as (vscode.QuickPickItem & { value: AnimationLevel }) | undefined
    if (!animation) return null

    // Q4 — Visual depth
    const visualDepth = await vscode.window.showQuickPick([
      {
        label: '$(browser) 2D',
        description: 'Flat UI · Tailwind · standard web',
        detail: 'Standard React/Next.js — fast, compatible everywhere',
        value: '2d' as VisualDepth,
      },
      {
        label: '$(globe) Hybrid',
        description: '2D + subtle depth · glassmorphism · layering',
        detail: 'Glass cards, gradients, depth shadows — no Three.js',
        value: 'hybrid' as VisualDepth,
      },
      {
        label: '$(symbol-misc) 3D',
        description: 'Three.js / R3F · immersive · advanced',
        detail: 'Full 3D hero, interactive objects, WebGL — slower build',
        value: '3d' as VisualDepth,
      },
    ], {
      title: 'ZOZO — Step 4 of 5: Visual Depth',
      placeHolder: 'How deep should the visual experience go?',
      ignoreFocusOut: true,
    }) as (vscode.QuickPickItem & { value: VisualDepth }) | undefined
    if (!visualDepth) return null

    // Q5 — Inspiration (multi-select)
    const inspirationOptions = [
      { label: '$(link) Framer-style', description: 'Smooth, editorial, motion-first', value: 'framer' as Inspiration },
      { label: '$(globe) Web3 / Crypto', description: 'Dark, neon, futuristic', value: 'web3' as Inspiration },
      { label: '$(server) Clean SaaS', description: 'Stripe/Vercel/Linear style', value: 'saas-clean' as Inspiration },
      { label: '$(symbol-misc) Blender 3D', description: 'Three.js, immersive, cinematic', value: 'blender' as Inspiration },
      { label: '$(book) Editorial', description: 'WEAREBRAND/typography-first style', value: 'editorial' as Inspiration },
    ]

    const inspirationPicked = await vscode.window.showQuickPick(inspirationOptions, {
      title: 'ZOZO — Step 5 of 5: Inspiration (pick up to 2)',
      placeHolder: 'What should it feel inspired by?',
      canPickMany: true,
      ignoreFocusOut: true,
    }) as (vscode.QuickPickItem & { value: Inspiration })[] | undefined
    if (!inspirationPicked) return null
    const inspiration = inspirationPicked.map(i => i.value).slice(0, 2)

    // Derive the rest
    const selectedModel    = selectModel(complexity.value, visualDepth.value, animation.value, provider)
    const selectedProvider = provider
    const pipelineMode     = selectPipelineMode(complexity.value, visualDepth.value)
    const designPreset     = selectPreset(inspiration.length > 0 ? inspiration : ['saas-clean'], uiStyle.value)

    return {
      prompt,
      complexity:  complexity.value,
      uiStyle:     uiStyle.value,
      animation:   animation.value,
      visualDepth: visualDepth.value,
      inspiration: inspiration.length > 0 ? inspiration : ['saas-clean'],
      efficient,
      selectedModel,
      selectedProvider,
      pipelineMode,
      designPreset,
    }
  }

  /**
   * Convert profile to a system prompt injection for BuilderAgent.
   * Tells the model EXACTLY what the user wants — no guessing.
   */
  toPromptHint(profile: BuildProfile): string {
    const animInstructions: Record<AnimationLevel, string> = {
      none:  'NO animations. Static UI only. Remove all motion imports.',
      light: 'Subtle animations: fade + slide-up on scroll. Max 6 whileInView elements.',
      heavy: 'Rich animations: parallax, stagger, complex motion. Use framer-motion throughout. Target 12-15 motion elements.',
    }
    const depthInstructions: Record<VisualDepth, string> = {
      '2d':     'Standard 2D UI. No Three.js. No canvas. Tailwind + React only.',
      'hybrid': 'Glass cards, gradient backgrounds, depth shadows. backdrop-blur everywhere. No Three.js.',
      '3d':     'Include Three.js / @react-three/fiber for hero section. Add a 3D element in the hero. Rest is standard 2D.',
    }
    const styleInstructions: Record<UIStyle, string> = {
      minimal: 'Minimal UI: few colors (max 6 hex values), generous whitespace, restrained typography. Less is more.',
      modern:  'Modern professional: dark theme, clean grid, subtle glass cards, balanced spacing.',
      premium: 'Premium immersive: cinematic hero, rich gradients, micro-interactions, editorial spacing.',
    }

    return [
      `## User Build Profile (FOLLOW EXACTLY — user explicitly chose these)`,
      ``,
      `Complexity: ${profile.complexity.toUpperCase()}`,
      `UI Style: ${profile.uiStyle} — ${styleInstructions[profile.uiStyle]}`,
      `Animation: ${profile.animation} — ${animInstructions[profile.animation]}`,
      `Visual depth: ${profile.visualDepth} — ${depthInstructions[profile.visualDepth]}`,
      `Inspiration: ${profile.inspiration.join(', ')}`,
      ``,
      `These are NOT suggestions. The user explicitly chose them.`,
      `If animation is "none", include ZERO animation imports.`,
      `If visual depth is "2d", do NOT import Three.js or @react-three/fiber.`,
    ].join('\n')
  }
}
