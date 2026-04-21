/**
 * DesignPresets — zero LLM, zero API cost
 * Hardcoded Awwwards-level design patterns from top production sites.
 * Auto-configures fonts, palettes, animations based on app type.
 * Replaces manual user selection with intelligent auto-detection.
 */

// ─── Premium Design Patterns (from Awwwards winners) ─────────────────────────

export const PREMIUM_PATTERNS = {
  hero: {
    source: 'Linear.app inspired',
    pattern: `HERO DESIGN (Linear.app style):
- Pure black background #000000
- Massive headline: clamp(3rem, 8vw, 8rem), font-weight 900, letter-spacing -0.04em
- Gradient text on key word: bg-gradient-to-r from-white to-zinc-400 bg-clip-text
- Subtle grid/dot background: radial-gradient dots at 10% opacity
- Single strong CTA with subtle glow shadow
- Stats row with dividers below hero
- Framer Motion: stagger children 0.1s, y: 20 to 0, opacity 0 to 1`
  },
  cards: {
    source: 'Vercel dashboard inspired',
    pattern: `CARD DESIGN (Vercel style):
- Background: rgba(255,255,255,0.03)
- Border: 1px solid rgba(255,255,255,0.08)
- Hover: border brightens to rgba(255,255,255,0.15)
- Hover: subtle y: -4px transform with spring transition
- No box-shadow on default state — only subtle shadow on hover
- Inner content: icon + label + value hierarchy
- Rounded: rounded-2xl`
  },
  pricing: {
    source: 'Stripe pricing inspired',
    pattern: `PRICING DESIGN (Stripe style):
- 2-3 tiers in a row, center tier highlighted
- Middle tier: subtle border glow with brand accent
- Toggle: pill shape, smooth spring animation for monthly/yearly
- Feature list: checkmark icon + text, no heavy icons
- CTA: full width, high contrast, rounded-xl
- Max 5 features per tier, keep it scannable`
  },
  nav: {
    source: 'Framer.com inspired',
    pattern: `NAV DESIGN (Framer style):
- Transparent on load, frosted glass on scroll (backdrop-blur-xl)
- Logo left, links center, CTA right
- Links: text-sm font-medium tracking-wide
- Mobile: hamburger with slide-in menu using framer-motion
- Scroll trigger: backdrop-blur + bg-black/80 + border-bottom appears at 50px`
  },
  footer: {
    source: 'Vercel.com inspired',
    pattern: `FOOTER DESIGN (Vercel style):
- Dark bg, border-t border-white/10
- 4 columns of links, small text
- Logo + tagline at bottom
- Social icons row
- text-zinc-500 for links, hover:text-white transition`
  },
  testimonials: {
    source: 'Cal.com inspired',
    pattern: `TESTIMONIALS DESIGN:
- Grid of cards (2x3 or 3x2)
- Each card: avatar + name + role + quote
- Cards: bg-white/[0.03] border border-white/[0.08]
- Quote marks in brand accent color at 20% opacity
- Stagger entrance with framer-motion`
  },
} as const

// ─── Awwwards-Level References (from real award winners) ─────────────────

export const AWWWARDS_REFERENCES = {
  '3d-immersive': {
    source: 'threejs.paris + monolithstudio.com',
    pattern: `3D IMMERSIVE DESIGN (Awwwards winners):
- Full viewport WebGL canvas as hero background
- Floating geometric 3D objects with slow rotation
- Text overlaid on 3D scene with mix-blend-mode
- Dark background #000000 with subtle particle field
- Camera animates on scroll using drei/ScrollControls
- Uses @react-three/fiber + @react-three/drei + three`
  },
  'luxury-dark': {
    source: 'sutera.ch + utopiatokyo.com',
    pattern: `LUXURY DARK DESIGN (Awwwards winners):
- Ultra-thin typography — font-weight 200-300
- Large whitespace — section padding min 120px
- Gold/cream accents on pure black (#d4af37, #f5f0e1)
- Horizontal scroll sections for galleries
- Smooth page transitions with framer-motion AnimatePresence
- Images with subtle parallax on scroll using useScroll + useTransform`
  },
  'web3-neon': {
    source: 'tenbinlabs.xyz + laxspace.co',
    pattern: `WEB3 NEON DESIGN (Awwwards winners):
- Neon glow effects: shadow-[0_0_20px_rgba(6,182,212,0.3)] on borders and text
- Animated gradient backgrounds using CSS @keyframes
- Grid/mesh pattern overlays at 5% opacity
- Glassmorphism cards: bg-white/[0.05] backdrop-blur-xl border border-cyan-500/20
- Counter animations for stats using framer-motion useMotionValue
- Particle systems in hero using CSS or canvas`
  },
} as const

// ─── Color Palettes ─────────────────────────────────────────────────────────

export const COLOR_PALETTES = {
  'Pure Black Premium': {
    bg: '#000000', surface: '#0a0a0a', card: '#111111',
    accent: '#ffffff', accentAlt: '#a1a1aa',
    source: 'Linear.app'
  },
  'Dark Neon': {
    bg: '#09090b', surface: '#18181b', card: '#1c1c1e',
    accent: '#7c3aed', accentAlt: '#a78bfa',
    source: 'Vercel.com'
  },
  'Gym Brutalist': {
    bg: '#0a0a0a', surface: '#111111', card: '#1a1a1a',
    accent: '#E8FF00', accentAlt: '#d4e600',
    source: 'Nike.com'
  },
  'Web3 Dark': {
    bg: '#000000', surface: '#0d0d0d', card: '#141414',
    accent: '#06b6d4', accentAlt: '#22d3ee',
    source: 'Coinbase.com'
  },
  'Warm Dark': {
    bg: '#0c0a09', surface: '#1c1917', card: '#292524',
    accent: '#f97316', accentAlt: '#fb923c',
    source: 'Notion.so'
  },
  'Luxury Gold': {
    bg: '#000000', surface: '#0a0a08', card: '#141410',
    accent: '#d4af37', accentAlt: '#f5f0e1',
    source: 'sutera.ch'
  },
} as const

// ─── Font Pairs — ALL must be on Google Fonts ─────────────────────────────
// NEVER use Clash Display, Satoshi, Cabinet Grotesk, General Sans — not on Google Fonts

export const FONT_PAIRS = {
  'modern-tech': { heading: 'Space Grotesk', body: 'Inter', source: 'google' },
  'editorial': { heading: 'Playfair Display', body: 'Inter', source: 'google' },
  'clean-saas': { heading: 'Space Grotesk', body: 'Inter', source: 'google' },
  'premium-display': { heading: 'Cormorant Garamond', body: 'Inter', source: 'google' },
  'balanced': { heading: 'DM Sans', body: 'Inter', source: 'google' },
  'classic': { heading: 'Inter', body: 'Inter', source: 'google' },
} as const

// ─── App Type Auto-Config ─────────────────────────────────────────────────

export type AppType = 'landing' | 'saas' | 'web3' | 'portfolio' | 'ecommerce' | 'other'

export interface DesignConfig {
  style: 'premium' | 'modern' | 'clean'
  animation: 'heavy' | 'light' | 'none'
  fonts: { heading: string; body: string }
  palette: keyof typeof COLOR_PALETTES
  patterns: string
  inspiration: string[]
}

export const AUTO_CONFIG: Record<AppType, DesignConfig> = {
  landing: {
    style: 'premium',
    animation: 'heavy',
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
    palette: 'Pure Black Premium',
    inspiration: ['framer-style', 'editorial'],
    patterns: [PREMIUM_PATTERNS.hero.pattern, PREMIUM_PATTERNS.cards.pattern, PREMIUM_PATTERNS.nav.pattern].join('\n\n'),
  },
  saas: {
    style: 'modern',
    animation: 'light',
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
    palette: 'Dark Neon',
    inspiration: ['clean-saas'],
    patterns: [PREMIUM_PATTERNS.nav.pattern, PREMIUM_PATTERNS.pricing.pattern, PREMIUM_PATTERNS.cards.pattern].join('\n\n'),
  },
  web3: {
    style: 'premium',
    animation: 'heavy',
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
    palette: 'Web3 Dark',
    inspiration: ['web3-crypto', 'framer-style'],
    patterns: [PREMIUM_PATTERNS.hero.pattern, PREMIUM_PATTERNS.cards.pattern, AWWWARDS_REFERENCES['web3-neon'].pattern].join('\n\n'),
  },
  portfolio: {
    style: 'premium',
    animation: 'heavy',
    fonts: { heading: 'Playfair Display', body: 'Inter' },  // FIXED — was Clash Display
    palette: 'Luxury Gold',
    inspiration: ['editorial', 'framer-style'],
    patterns: [PREMIUM_PATTERNS.hero.pattern, PREMIUM_PATTERNS.testimonials.pattern, AWWWARDS_REFERENCES['luxury-dark'].pattern].join('\n\n'),
  },
  ecommerce: {
    style: 'modern',
    animation: 'light',
    fonts: { heading: 'DM Sans', body: 'Inter' },  // FIXED — was General Sans
    palette: 'Dark Neon',
    inspiration: ['clean-saas'],
    patterns: [PREMIUM_PATTERNS.cards.pattern, PREMIUM_PATTERNS.pricing.pattern].join('\n\n'),
  },
  other: {
    style: 'modern',
    animation: 'light',
    fonts: { heading: 'Inter', body: 'Inter' },
    palette: 'Dark Neon',
    inspiration: ['clean-saas'],
    patterns: [PREMIUM_PATTERNS.hero.pattern, PREMIUM_PATTERNS.cards.pattern].join('\n\n'),
  },
}

// ─── App Type Detection (from prompt) ─────────────────────────────────────

const APP_TYPE_KEYWORDS: Record<AppType, string[]> = {
  landing: ['landing', 'homepage', 'marketing', 'launch', 'about us', 'startup', 'gym', 'fitness', 'restaurant', 'agency', 'hotel', 'sneaker', 'shoe', 'brand', 'luxury'],
  saas: ['saas', 'dashboard', 'admin', 'crm', 'analytics', 'platform', 'tool', 'productivity'],
  web3: ['web3', 'crypto', 'blockchain', 'nft', 'defi', 'wallet', 'dao', 'token', 'mining'],
  portfolio: ['portfolio', 'personal', 'blog', 'resume', 'cv', 'freelance', 'photographer'],
  ecommerce: ['ecommerce', 'shop', 'store', 'product', 'cart', 'checkout', 'buy', 'sell', 'marketplace'],
  other: [],
}

export function detectAppType(prompt: string): AppType {
  const lower = prompt.toLowerCase()
  let bestMatch: AppType = 'landing'
  let bestScore = 0

  for (const [type, keywords] of Object.entries(APP_TYPE_KEYWORDS)) {
    if (type === 'other') continue
    const score = keywords.filter(kw => lower.includes(kw)).length
    if (score > bestScore) {
      bestScore = score
      bestMatch = type as AppType
    }
  }

  return bestMatch
}

// ─── Emil Kowalski Animation Patterns ────────────────────────────────────────
// Source: emilkowalski.net/craft — award-winning micro-interactions

export const EMIL_ANIMATION_PATTERNS = {
  springCard: `
// Emil Kowalski card — spring physics hover
const cardVariants = {
  rest: { scale: 1, y: 0 },
  hover: { scale: 1.02, y: -8, transition: { type: 'spring', stiffness: 400, damping: 25 } }
}
<motion.div variants={cardVariants} initial="rest" whileHover="hover" whileTap={{ scale: 0.98 }}>`,

  magneticButton: `
// Emil Kowalski magnetic button
const [position, setPosition] = useState({ x: 0, y: 0 })
const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = e.clientX - rect.left - rect.width / 2
  const y = e.clientY - rect.top - rect.height / 2
  setPosition({ x: x * 0.3, y: y * 0.3 })
}
const handleMouseLeave = () => setPosition({ x: 0, y: 0 })
<motion.button
  animate={{ x: position.x, y: position.y }}
  transition={{ type: 'spring', stiffness: 150, damping: 15 }}
  onMouseMove={handleMouseMove}
  onMouseLeave={handleMouseLeave}
>`,

  textReveal: `
// Emil Kowalski word-by-word reveal
const words = text.split(' ')
const container = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }
const wordVariant = {
  hidden: { y: '100%', opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 100, damping: 20 } }
}
<motion.h1 variants={container} initial="hidden" animate="visible">
  {words.map((word, i) => (
    <span key={i} style={{ overflow: 'hidden', display: 'inline-block', marginRight: '0.25em' }}>
      <motion.span variants={wordVariant} style={{ display: 'inline-block' }}>{word}</motion.span>
    </span>
  ))}
</motion.h1>`,

  smoothCounter: `
// Emil Kowalski smooth number counter
const count = useMotionValue(0)
const rounded = useTransform(count, v => Math.round(v).toLocaleString())
const springCount = useSpring(count, { stiffness: 100, damping: 30 })
useEffect(() => { count.set(targetNumber) }, [])
<motion.span>{rounded}</motion.span>`,

  tiltCard: `
// Emil Kowalski 3D tilt card
const x = useMotionValue(0)
const y = useMotionValue(0)
const rotateX = useTransform(y, [-100, 100], [10, -10])
const rotateY = useTransform(x, [-100, 100], [-10, 10])
const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
  const rect = e.currentTarget.getBoundingClientRect()
  x.set(e.clientX - rect.left - rect.width / 2)
  y.set(e.clientY - rect.top - rect.height / 2)
}
<motion.div
  style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
  onMouseMove={handleMouseMove}
  onMouseLeave={() => { x.set(0); y.set(0) }}
>`,

  pageTransition: `
// Emil Kowalski page transition
<AnimatePresence mode="wait">
  <motion.div
    key={pathname}
    initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
    exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
  >`,
}

// ─── Build Resource Context (for BuilderAgent) ────────────────────────────

export function buildResourceContext(appType: AppType): string {
  const config = AUTO_CONFIG[appType]
  const palette = COLOR_PALETTES[config.palette]

  const baseCtx = `## DESIGN REFERENCE (auto-selected for ${appType} app)

### APP TYPE: ${appType.toUpperCase()}
Style: ${config.style} | Animation: ${config.animation}

### FONTS — MANDATORY — import from 'next/font/google' ONLY. No CDN. No @fontsource.
- Heading font: ${config.fonts.heading}
- Body font: ${config.fonts.body}
- Correct import: import { ${config.fonts.heading.replace(/ /g, '_')} } from 'next/font/google'
- NEVER import Clash Display, Satoshi, Cabinet Grotesk, General Sans — not on Google Fonts

### COLOR PALETTE: ${config.palette} (inspired by ${palette.source})
- Background: ${palette.bg}
- Surface: ${palette.surface}
- Card: ${palette.card}
- Accent: ${palette.accent}
- Accent Alt: ${palette.accentAlt}
- Use these exact hex values in globals.css as CSS variables

### DESIGN PATTERNS (from Awwwards winners — follow exactly):
${config.patterns}

### ANIMATION APPROACH:
- Use framer-motion for ALL section entrances and interactions
- whileInView with viewport={{ once: true }} on every section
- Stagger children: staggerChildren: 0.08
- Cards: whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}

### PREMIUM DESIGN RULES (mandatory):
- Minimum section padding: py-24 md:py-32
- Hero headline: text-6xl md:text-8xl font-black tracking-tight
- Cards: bg-white/[0.03] border border-white/[0.08] backdrop-blur-sm rounded-2xl
- Hover cards: border-white/[0.15] -translate-y-1
- Buttons: rounded-xl px-8 py-4 font-semibold
- Dark backgrounds: use ${palette.bg}
- Always have clear visual hierarchy between heading/body/muted text

### IMAGE RULES — MANDATORY:
- If context contains REAL MEDIA URLs → use them in <img> tags with loading="lazy"
- Hero: <img src="URL" className="absolute inset-0 w-full h-full object-cover opacity-30" loading="lazy" />
- Product cards: <img src="URL" className="w-full h-full object-cover" loading="lazy" />
- NEVER use bg-gradient as substitute for a real product image
`

  // Add Emil Kowalski patterns for heavy animation builds
  if (config.animation === 'heavy') {
    return baseCtx + `
### EMIL KOWALSKI ANIMATION PATTERNS (copy these exactly):
These are from emilkowalski.net/craft — award-winning micro-interactions.

MAGNETIC BUTTON:
${EMIL_ANIMATION_PATTERNS.magneticButton}

WORD REVEAL:
${EMIL_ANIMATION_PATTERNS.textReveal}

SPRING CARD HOVER:
${EMIL_ANIMATION_PATTERNS.springCard}

3D TILT CARD:
${EMIL_ANIMATION_PATTERNS.tiltCard}

SMOOTH COUNTER:
${EMIL_ANIMATION_PATTERNS.smoothCounter}

Use these patterns on EVERY interactive element. This is what makes ZOZO beat Lovable.
`
  }

  return baseCtx
}