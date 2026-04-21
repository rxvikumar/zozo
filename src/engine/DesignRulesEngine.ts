/**
 * DesignRulesEngine
 * 
 * Encodes the "taste" rules that produce WEAREBRAND-level output.
 * Agents read these rules and inject them into their system prompts.
 * No LLM calls. Pure configuration.
 */

export type ProjectComplexity = 'minimal' | 'standard' | 'premium'
export type MotionLevel = 'none' | 'subtle' | 'medium' | 'rich'

export interface DesignRules {
  // Typography
  fontPrimary: string         // Main display/heading font
  fontSecondary: string       // Body / UI font
  fontScale: string[]         // Allowed text sizes (Tailwind classes)
  fontWeights: string[]       // Allowed font weights

  // Colour
  colorBackground: string     // Page background
  colorSurface: string        // Card / panel background
  colorBorder: string         // Subtle border
  colorAccent: string         // CTA / highlight
  colorAccentGlow: string     // Accent at reduced opacity for glow
  colorTextPrimary: string    // Heading text
  colorTextSecondary: string  // Body text
  colorTextMuted: string      // Captions, labels

  // Spacing (8px grid)
  spacingUnit: number         // Base unit in px (always 8)
  spacingScale: number[]      // Multipliers: [1,2,3,4,6,8,12,16,24]

  // Motion
  motionLevel: MotionLevel
  durationFast: string        // e.g. "0.15s"
  durationNormal: string      // e.g. "0.4s"
  durationSlow: string        // e.g. "0.8s"
  easing: string              // e.g. "cubic-bezier(0.16, 1, 0.3, 1)"
  allowedAnimations: string[] // Which animation types are permitted

  // Layout
  maxWidth: string            // Max content width e.g. "1280px"
  containerPadding: string    // Side padding e.g. "px-6 md:px-12"
  borderRadius: string        // Base radius e.g. "rounded-xl"

  // Complexity guardrails
  maxColorsHex: number        // Hard limit on unique hex values in output
  maxAnimationsPerPage: number
  allow3D: boolean
  allowParticles: boolean
  allowVideoBackground: boolean
}

const DARK_PREMIUM: DesignRules = {
  fontPrimary: '"Geist", "Inter", system-ui, sans-serif',
  fontSecondary: '"Geist Mono", monospace',
  fontScale: ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-4xl', 'text-6xl', 'text-7xl'],
  fontWeights: ['font-normal', 'font-medium', 'font-semibold', 'font-bold', 'font-black'],

  colorBackground: '#09090b',
  colorSurface: '#18181b',
  colorBorder: 'rgba(255,255,255,0.08)',
  colorAccent: '#8b5cf6',
  colorAccentGlow: 'rgba(139,92,246,0.15)',
  colorTextPrimary: '#fafafa',
  colorTextSecondary: '#a1a1aa',
  colorTextMuted: '#71717a',

  spacingUnit: 8,
  spacingScale: [1, 2, 3, 4, 6, 8, 12, 16, 24],

  motionLevel: 'medium',
  durationFast: '0.15s',
  durationNormal: '0.4s',
  durationSlow: '0.8s',
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  allowedAnimations: ['fade', 'slide-up', 'scale', 'blur-in', 'stagger'],

  maxWidth: '1280px',
  containerPadding: 'px-6 md:px-12 lg:px-16',
  borderRadius: 'rounded-xl',

  maxColorsHex: 10,
  maxAnimationsPerPage: 8,
  allow3D: false,
  allowParticles: false,
  allowVideoBackground: false,
}

const DARK_3D: DesignRules = {
  ...DARK_PREMIUM,
  motionLevel: 'rich',
  allow3D: true,
  allowParticles: true,
  maxAnimationsPerPage: 20,
  colorAccent: '#06b6d4',
  colorAccentGlow: 'rgba(6,182,212,0.15)',
}

const DARK_MINIMAL: DesignRules = {
  ...DARK_PREMIUM,
  motionLevel: 'subtle',
  allowedAnimations: ['fade', 'slide-up'],
  maxAnimationsPerPage: 5,
  colorAccent: '#e4e4e7',
  colorAccentGlow: 'rgba(228,228,231,0.08)',
}

const SAAS_CLEAN: DesignRules = {
  ...DARK_PREMIUM,
  colorBackground: '#0f172a',
  colorSurface: '#1e293b',
  colorAccent: '#3b82f6',
  colorAccentGlow: 'rgba(59,130,246,0.12)',
  motionLevel: 'subtle',
  maxAnimationsPerPage: 6,
}

// What Lovable produces: clean but generic, weak animation, safe colors
// What ZOZO beats it with: stronger hierarchy, tighter palette, scroll animations
const LOVABLE_BEATER: DesignRules = {
  ...DARK_PREMIUM,
  colorBackground: '#0a0a0f',
  colorSurface:    '#12121a',
  colorAccent:     '#7c3aed',
  colorAccentGlow: 'rgba(124,58,237,0.18)',
  fontPrimary:     '"Cal Sans", "Inter", system-ui, sans-serif',
  motionLevel:     'medium',
  maxAnimationsPerPage: 8,
  allow3D:         false,
  allowParticles:  false,
}

// What Emergent produces: fast but shallow design, no glassmorphism, flat cards
// What ZOZO beats it with: depth, glass layers, premium motion
const EMERGENT_BEATER: DesignRules = {
  ...DARK_PREMIUM,
  colorBackground: '#060608',
  colorSurface:    '#0f0f14',
  colorBorder:     'rgba(255,255,255,0.06)',
  colorAccent:     '#06b6d4',
  colorAccentGlow: 'rgba(6,182,212,0.15)',
  motionLevel:     'rich',
  maxAnimationsPerPage: 10,
  allowParticles:  false,
  allow3D:         false,
}

// What WEAREBRAND produces: human-perfected, cinematic, editorial
// ZOZO cannot fully automate this yet, but this preset gets close
const WEAREBRAND_APPROACH: DesignRules = {
  ...DARK_PREMIUM,
  colorBackground: '#080808',
  colorSurface:    '#101010',
  colorBorder:     'rgba(255,255,255,0.05)',
  colorAccent:     '#e4e4e7',     // WEAREBRAND uses near-white accents
  colorAccentGlow: 'rgba(228,228,231,0.08)',
  fontPrimary:     '"Neue Montreal", "Inter", system-ui, sans-serif',
  motionLevel:     'subtle',      // WEAREBRAND uses very subtle motion
  durationNormal:  '0.6s',
  durationSlow:    '1.2s',
  easing:          'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  allowedAnimations: ['fade', 'slide-up', 'scale'],
  maxAnimationsPerPage: 6,
  allow3D:         false,
  allowParticles:  false,
  maxColorsHex:    6,              // WEAREBRAND is extremely minimal with color
}

const PRESETS: Record<string, DesignRules> = {
  'dark-premium':        DARK_PREMIUM,
  'dark-3d':             DARK_3D,
  'dark-minimal':        DARK_MINIMAL,
  'saas':                SAAS_CLEAN,
  'lovable-beater':      LOVABLE_BEATER,
  'emergent-beater':     EMERGENT_BEATER,
  'wearebrand-approach': WEAREBRAND_APPROACH,
}

export class DesignRulesEngine {

  /**
   * Returns the design rules for a given template + complexity.
   * Agents call this and inject the result into their system prompt.
   */
  getRules(template: string, complexity: ProjectComplexity = 'standard'): DesignRules {
    const map: Record<string, string> = {
      'saas':        'emergent-beater',     // beat Emergent on SaaS
      'web3':        'dark-3d',
      '3d-landing':  'dark-3d',
      'ecommerce':   'lovable-beater',      // beat Lovable on ecommerce
      'dashboard':   'saas',
      'portfolio':   'wearebrand-approach',  // beat WEAREBRAND on portfolios
      'ai-tool':     'emergent-beater',      // beat Emergent on AI tools
      'blog':        'dark-minimal',
      'landing':     'lovable-beater',       // beat Lovable on landing pages
      'marketing':   'wearebrand-approach',
    }
    const presetKey = map[template] ?? 'dark-premium'
    return PRESETS[presetKey] ?? DARK_PREMIUM
  }

  /**
   * Produces a system prompt injection string for a given agent.
   * Paste the return value into the agent's system prompt to enforce rules.
   */
  toPromptSection(rules: DesignRules, template = 'saas'): string {
    return `
## MANDATORY DESIGN SYSTEM — read before writing a single line of code

### THE REAL FORMULA (do not deviate)
Layout 40% + Typography 25% + Spacing 20% + Motion 10% + Effects 5%
Most AI-generated UI fails because it gets this backwards. Reverse it and you fail.

### LAYOUT SYSTEM (40% of quality — most important)
- Max content width: ${rules.maxWidth} with mx-auto — ALWAYS
- Container padding: ${rules.containerPadding}
- Hero section: min-h-screen flex flex-col items-center justify-center text-center
- Features section: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8
- Every section needs: <section className="relative py-20 md:py-28 lg:py-36">
- Semantic structure required: <main> wraps all, <section> for each content block
- NEVER: full-width chaos, random widths, no max-w constraint

### TYPOGRAPHY SYSTEM (25% of quality)
- H1 (hero headline): text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05]
- H2 (section title): text-3xl md:text-4xl font-bold tracking-tight
- H3 (card title): text-xl font-semibold
- Body text: text-base md:text-lg text-zinc-400 leading-relaxed max-w-2xl
- Caption: text-sm text-zinc-500
- MAX 2 font families — one display (bold), one body (regular)
- Font: ${rules.fontPrimary}
- NEVER: random font sizes, light font weights on dark backgrounds, uncontrolled line-height

### SPACING SYSTEM (20% of quality) — 8px grid, no exceptions
- Base unit: 8px (Tailwind p-2)
- Scale: 8 16 24 32 48 64 80 96 128 (p-2 p-4 p-6 p-8 p-12 p-16 p-20 p-24 p-32)
- Section vertical padding: py-20 md:py-28 minimum
- Between sections: mt-24 md:mt-32
- Card internal: p-6 md:p-8
- Between cards: gap-6 md:gap-8
- NEVER: arbitrary values like p-[13px] mt-[7px] — these destroy rhythm

### COLOR SYSTEM (part of effects — 5%)
- Background: ${rules.colorBackground}
- Surface (cards): ${rules.colorSurface}
- Border: border-white/[0.08]
- Accent: ${rules.colorAccent}
- Text primary: ${rules.colorTextPrimary}
- Text secondary: ${rules.colorTextSecondary}
- Text muted: ${rules.colorTextMuted}
- MAX 10 unique hex values in entire codebase — count them
- NEVER: white backgrounds, light themes, rainbow color chaos

### MOTION SYSTEM (10% of quality — intentional, not decorative)
- Rule: animation should be FELT not NOTICED
- Duration: ${rules.durationNormal} for most, ${rules.durationFast} for hover
- Easing: ${rules.easing}
- Entry: whileInView={{ opacity:1, y:0 }} initial={{ opacity:0, y:20 }} viewport={{ once:true }}
- Hover: scale(1.02) maximum — NEVER scale(1.1) or higher
- Stagger: children delay 0.05s apart maximum
- Total animations per page: ${rules.maxAnimationsPerPage} maximum
- Section entry, feature cards, CTA button — that is enough
- NEVER: animations on every element, loops, bouncing, spinning, chaos

### EFFECTS SYSTEM (5% of quality — use sparingly)
- Glassmorphism: bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm rounded-xl
- Gradient text (hero only): bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent
- Accent glow (CTA only): shadow-[0_0_40px_${rules.colorAccentGlow}]
- Noise texture (hero bg): bg-[url(/noise.png)] opacity-[0.025]
- NEVER: multiple glow effects, particles everywhere, Three.js unless explicitly requested

### COMPONENT CHECKLIST (every build must include ALL of these)
- Sticky navbar: bg-zinc-950/80 backdrop-blur-md border-b border-white/[0.06]
- Hero: full-screen, gradient headline, subtitle, 2 CTAs, subtle glow blob behind
- Social proof: logos or testimonials with glass card style
- Features: 3-column grid, icon + title + description, card with border
- CTA section: high contrast, accent background or strong gradient
- Footer: simple, muted text, links, no heavy styling

### WHAT SEPARATES TOP UI FROM AVERAGE UI
Top UI removes everything unnecessary. It is:
- consistent (same rounding, same spacing, same shadow everywhere)
- restrained (3 colors, not 12)
- intentional (every pixel has a reason)
- fast-feeling (minimal repaints, hardware-accelerated transforms only)
Average AI UI adds more. Top UI removes more.

### 3D / PARTICLES
- 3D allowed: ${rules.allow3D}
- Particles allowed: ${rules.allowParticles}
${!rules.allow3D ? '- DO NOT add Three.js, @react-three/fiber, or any 3D library' : '- If adding 3D: hero section only, low-poly, < 50k triangles, fallback for mobile'}
${!rules.allowParticles ? '- DO NOT add particle systems, confetti, or floating elements' : ''}
${template === 'ai-tool' ? `
### TEXT RENDERING (for AI tools with chat/virtualized lists)
- For 1000+ message lists: npm install @chenglou/pretext
- prepare(text, font) — one-time measurement, no DOM reflow
- layout(prepared, maxWidth, lineHeight) — pure arithmetic height
- Use ONLY for: chat UI, markdown renderer, virtualized message list
` : ''}
`
  }
}
