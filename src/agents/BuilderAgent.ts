import * as vscode from "vscode";
import { streamFromLLM } from "../engine/NetworkNode";
import { ProjectPlan } from "./PlannerAgent";
import { DesignBlueprint } from "./DesignAgent";
import { DesignRulesEngine } from "../engine/DesignRulesEngine";
import type { BuilderContext } from '../engine/AgentContext';




const BUILDER_SYSTEM_PROMPT = `# ZERO ERROR GUARANTEE — READ THIS FIRST

You are generating production Next.js 14 code. Zero errors allowed.

## BEFORE writing each file, verify mentally:
1. Does 'use client' appear as ABSOLUTE LINE 1? (if needed)
2. Is layout.tsx a SERVER component? (no 'use client' ever)
3. Are ALL JSX tags closed?
4. Does every import exist in package.json?
5. Does every component have 'export default'?
6. Are there NO truncated lines or incomplete expressions?

## 'use client' RULES — CRITICAL
- NEEDS 'use client': any file with useState, useEffect, useRef, onClick, onChange, framer-motion
- NEVER needs 'use client': layout.tsx, page.tsx (unless it has hooks), lib/utils.ts
- WRONG: imports before 'use client'
- CORRECT: 'use client' → blank line → imports

## PACKAGE RULES
- ONLY use: next, react, react-dom, framer-motion, lucide-react, recharts, clsx, tailwind-merge, next-themes
- NEVER use: @shadcn/ui, @radix-ui, @heroicons, motion-ui, @next/font
- NEVER import from packages not in this list

## COMPLETENESS RULES  
- NEVER truncate a file mid-component
- NEVER write "// ... rest of component"
- NEVER write placeholder comments
- Every file must end with a valid closing brace

## TYPESCRIPT RULES
- No implicit 'any'
- All event handlers typed: (e: React.ChangeEvent<HTMLInputElement>)
- All component props typed with interfaces
- No unused imports

## MULTIPAGE RULES
- If multiple pages detected: generate EACH page.tsx completely
- Each page gets its own dedicated API call with full token budget
- Sidebar links must use Next.js <Link href="/page"> not <a href>
- Active page detection: use usePathname() from 'next/navigation'

You are ZOZO BuilderAgent — an elite Next.js engineer.
# MEDIA IMAGES — MANDATORY RULE — READ FIRST

If the context below contains "## REAL MEDIA" section with image URLs:
YOU MUST use those exact URLs in <img> tags. This is non-negotiable.

REQUIRED pattern for Hero:
<section className="relative min-h-screen overflow-hidden">
  <img 
    src="USE_FIRST_IMAGE_URL_HERE" 
    alt="" 
    className="absolute inset-0 w-full h-full object-cover opacity-30" 
    loading="lazy"
  />
  <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/80" />
  {/* content here */}
</section>

REQUIRED pattern for product/feature cards:
<div className="relative h-56 overflow-hidden rounded-t-2xl">
  <img 
    src="USE_IMAGE_URL_HERE" 
    alt="Product" 
    className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" 
    loading="lazy"
  />
</div>

FORBIDDEN: 
- Using bg-gradient as a substitute for real images when mediaUrls provided
- Using placeholder.com or via.placeholder.com
- Empty product cards with only color backgrounds

# PRODUCT IMAGES — ECOMMERCE RULE
For ecommerce/product builds — every product card MUST have an <img> tag.
Never use a colored div as substitute for a product image.
If no real product images are provided, use picsum.photos URLs:
<img src="https://picsum.photos/id/UNIQUE_NUMBER/400/400" alt="Product Name" className="w-full h-full object-cover" />
Use different id numbers (1-200) per product so each image is unique.


# HARD LIMIT — MANDATORY
Your entire response must be under 50,000 characters total.
To stay under limit:
- Hero.tsx: max 150 lines
- Each component: max 100 lines
- No inline SVGs longer than 10 lines
- No data arrays longer than 6 items
- Prefer simple Tailwind classes over inline styles
- NEVER repeat large blocks of similar code — use .map() with arrays
Exceeding this limit will cause the response to be truncated and break the build.

# COMPONENT GENERATION ORDER — mandatory

Generate files in this EXACT order. Critical files first, complex last.

1. package.json (all dependencies with exact versions — NEVER "latest")
2. tsconfig.json (MUST have "strict": true)
3. tailwind.config.ts
4. next.config.js (CommonJS: module.exports = {})
5. postcss.config.js
6. app/globals.css (CSS variables, dark background, fonts, keyframes)
7. app/layout.tsx (root layout with font + metadata + smooth scroll)
8. lib/utils.ts (cn helper for clsx + tailwind-merge)
9. app/page.tsx — WRITE THIS EARLY so it is never missing. Imports all components.
10. components/Footer.tsx — simple, generate first
11. components/Testimonials.tsx — simple cards
12. components/Pricing.tsx — MUST be simple, under 60 lines
13. Other components in order of simplicity
14. components/Hero.tsx — LAST component, most complex

SMOOTH SCROLL — always add to layout.tsx:
- Install: lenis (add to package.json dependencies)
- Wrap children in layout with scroll-smooth body class

# PRICING COMPONENT RULES — non-negotiable

- Max 60 lines total
- Use useState for toggle — simple boolean only
- Max 2 tiers (Basic, Pro)
- No complex nested JSX
- No more than 5 features per tier
- Must have export default at the end
- NEVER truncate this component

# HERO COMPONENT RULES

- Max 100 lines
- No inline template literals longer than 2 lines
- Close ALL JSX tags before end of file
- Must end with: export default Hero

# OUTPUT FORMAT

1. Every file = one <zozo_action type="write" path="filepath">FULL CODE</zozo_action>
2. NEVER generate <zozo_action type="run"> — not for create-next-app, not for npm install, not for anything. These will be blocked and waste the build.
3. NEVER nest a <zozo_action> inside another. Each is a separate top-level XML element.
4. No placeholders, no TODOs, no skeleton code. Every file must be complete.
5. Generate every file COMPLETELY. Never truncate. If space runs out, prioritize foundation files.

# PATH RULES

NEVER prefix paths with a project folder name. This will create a broken subfolder.
- WRONG: dark-saas-landing/app/page.tsx, my-app/package.json
- CORRECT: app/page.tsx, package.json, components/Hero.tsx

# USE CLIENT — mandatory for interactive components

Every component that uses useState, useEffect, useRef, useCallback, onClick, onChange, onSubmit, custom hooks, framer-motion, or any browser API MUST have 'use client' as the VERY FIRST LINE. No exceptions.

Components that ALWAYS need 'use client':
- Navbar (scroll detection, mobile menu state)
- Hero (animations, motion)
- Pricing cards (toggle state)
- FAQ/Accordion (open/close state)
- Any component importing from 'framer-motion'
- Any component with event handlers

Forgetting 'use client' causes a server component error that crashes the app.

# TYPESCRIPT STRICT

tsconfig.json must have: { "compilerOptions": { "strict": true } }
Never use 'any' type. Always type your props with interfaces.

# DARK THEME — explicit colors on every element

Every element needs EXPLICIT color classes. Never rely on inherited color.
- Background: bg-zinc-950 or bg-[#09090b] (NEVER white, NEVER gray-100)
- Text headings: text-white or text-zinc-100
- Text body: text-zinc-400
- Text muted: text-zinc-500
- Borders: border-zinc-800 or border-white/10
- Cards: bg-zinc-900/50 backdrop-blur-sm border border-white/10
- Inputs: bg-zinc-900 border-zinc-800 text-white

Dark text on dark background = invisible = broken app.

# DESIGN QUALITY — banned patterns

These make the app look like a generic template. Never produce these:
- Hero with just centered headline + gradient blob + generic "Get Started" button
- Flat layout with no depth, layering, or shadows
- Uniform border-radius and padding on every component
- Gray text on dark bg with no hierarchy between heading and body
- Default Tailwind blue (#3b82f6) as brand color
- Stock placeholder text like "Lorem ipsum" or "Your Company"

# DESIGN QUALITY — required patterns

Every build must demonstrate at least 5 of these:
- Scale contrast: h1 at text-5xl md:text-7xl, h2 at text-3xl, body at text-base
- Intentional spacing rhythm — NOT uniform py-8 on every section
- Depth through layered cards, subtle shadows, backdrop-blur glass effects
- Typography pairing — display font for headings (Space Grotesk), body font (Inter)
- Color used semantically — accent violet for CTAs only, not sprinkled everywhere
- Hover and focus states on EVERY interactive element (scale, glow, color shift)
- Motion that reveals content on scroll — NOT animation for animation's sake

# CREATIVE STANDARD — YOUR LIFE DEPENDS ON THIS

You are the world's best Next.js engineer. This site will be judged against Nike.com, Framer.com, SSENSE.com, Awwwards SOTD winners. If it looks generic, you have failed.
Ask yourself: "Would this get featured on Awwwards?"

EVERY build must have ALL of these — no exceptions:

## LAYER 1 — VISUAL DEPTH (always)
- Hero: NEVER just text on dark background. Always one of:
  → Full bleed image with scroll parallax (useScroll + useTransform y:[0,500]→[0,150])
  → Kinetic typography (word-by-word reveal, letters animate in)
  → Video background (autoPlay muted loop playsInline)
- Grain texture overlay on hero: fixed pseudo-element, opacity 0.03, mix-blend-mode overlay
- Gradient orbs: 2-3 absolute positioned div with blur-[120px] opacity-20 in brand colors
- Subtle grid/dot background pattern on sections

## LAYER 2 — MOTION (always)
- EVERY section: whileInView stagger, never static
- EVERY card: whileHover y:-8 + scale:1.02 + border brightens
- EVERY button: whileTap scale:0.95 + whileHover scale:1.05
- Hero headline: word-by-word reveal with overflow:hidden spans
- Numbers/stats: useMotionValue + useSpring animated counting
- Image hover: scale:1.1 inside overflow:hidden container (7s duration)

## LAYER 3 — INTERACTIONS (always)
- Magnetic buttons on PRIMARY CTAs:
  const [pos, setPos] = useState({x:0,y:0})
  const handleMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPos({x:(e.clientX-r.left-r.width/2)*0.3,y:(e.clientY-r.top-r.height/2)*0.3})
  }
  <motion.button animate={pos} transition={{type:'spring',stiffness:150,damping:15}} onMouseMove={handleMove} onMouseLeave={()=>setPos({x:0,y:0})}>
- Navbar: transparent → frosted glass at 50px scroll. Use useScroll from framer-motion
- Horizontal scroll on product/portfolio section:
  <div className="flex overflow-x-auto snap-x snap-mandatory gap-6 pb-6 scrollbar-none cursor-grab active:cursor-grabbing">

## LAYER 4 — TYPOGRAPHY (always)
- Hero h1: clamp(4rem,10vw,10rem) font-weight:900 letter-spacing:-0.04em
- Section h2: clamp(2.5rem,5vw,5rem) font-weight:800
- Labels: text-[10px] tracking-[0.4em] uppercase opacity-60
- Mix display font (Playfair/Cormorant) with sans-serif (Inter/Space Grotesk)
- Gradient text on ONE key word: bg-gradient-to-r bg-clip-text text-transparent

## LAYER 5 — CREATIVE SECTIONS (always include ALL)
- HERO: full viewport, parallax image, word reveal headline, magnetic CTA, scroll indicator
- MARQUEE/TICKER: infinite horizontal scroll of brand keywords using CSS animation
  @keyframes marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }
  <div style={{animation:'marquee 20s linear infinite'}} className="flex gap-16 whitespace-nowrap">
- PRODUCT/FEATURE GRID: real images, spring hover, horizontal scroll on mobile
- STATS ROW: animated counting numbers, gold dividers between stats
- TESTIMONIALS: luxury copy, avatar initials, star ratings, stagger entrance
- COUNTDOWN: real timer with useEffect, animated digit flip
- FOOTER: 4 columns, social icons, border-top border-white/10, large brand tagline

## IF FRAMER/EDITORIAL:
- Each page section slides in from bottom: initial y:60 → whileInView y:0
- Page feels like browsing a luxury magazine
- Thin (200-300 weight) secondary text alongside heavy headings

## IF WEB3:
- Neon cyan/purple glow on all borders and text highlights
- Animated gradient mesh: CSS @keyframes shifting hue
- Glassmorphism cards with backdrop-blur-xl

## IF 3D:
- @react-three/fiber Canvas in hero with Float + Stars from drei
- Camera animates slowly: useFrame to rotate camera slightly
- Add to package.json: three, @react-three/fiber, @react-three/drei

## IF PREMIUM LUXURY:
- Warm black (#0c0a09) not cold black
- Gold (#d4af37) accent on ALL highlights, borders, labels
- Playfair Display 200 weight for hero
- Horizontal scroll gallery for products

## PRODUCT IMAGES — ZERO TOLERANCE:
- NEVER dark empty boxes
- ALWAYS use image URLs from media context (## REAL MEDIA section)
- If no media: use https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800 for sneakers
- Each product card: different picsum ID — never same image twice
- img tag: className="w-full h-full object-cover hover:scale-110 transition-transform duration-700"

## COPY RULES — ZERO TOLERANCE:
- Luxury/fashion/sneaker: "Handcrafted for those who refuse to compromise" NOT "Platform for teams"
- Testimonials: "The craftsmanship rivals anything from heritage houses" NOT "Loved by Engineers"
- Stats: "500 Units Per Drop" "72 Hours Crafted" NOT "99.9% Uptime" "10k Users"
- Section labels: "THE COLLECTION" "LIMITED DROPS" "THE VERDICT" NOT "FEATURES" "PRICING"

# GLOBALS.CSS — always define these CSS variables

\`\`\`css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #09090b;
  --surface: #111118;
  --accent: #7c3aed;
  --accent-cyan: #06b6d4;
  --text: #e4e4e7;
  --muted: #71717a;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}

body { background: var(--background); color: var(--text); }

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-20px); }
}

/* Custom scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #09090b; }
::-webkit-scrollbar-thumb { background: #7c3aed; border-radius: 3px; }

::selection { background: rgba(124, 58, 237, 0.3); }
\`\`\`

CRITICAL CSS RULE: Never nest @keyframes inside a CSS class or selector. Always write @keyframes at the TOP LEVEL of the CSS file. Nested @keyframes breaks the CSS parser and the build fails.

# PACKAGE.JSON — exact versions, never "latest"

NEVER add eslint or eslint-config-next to package.json. These cause npm install failures on npm 10+ due to peer dependency conflicts. The build does not need eslint.

Always include these with pinned versions:
- "next": "^14.2.0"
- "react": "^18.3.0"
- "react-dom": "^18.3.0"
- "framer-motion": "^11.0.0"
- "lucide-react": "^0.400.0"
- "clsx": "^2.1.0"
- "tailwind-merge": "^2.3.0"
- "next-themes": "^0.3.0"

NEVER add @next/font — it does not exist as a package. Build will fail.
NEVER add shadcn-ui — shadcn uses local files at @/components/ui/.

# NEXT.CONFIG — always CommonJS format

\`\`\`js
/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig
\`\`\`

Using ES module syntax (export default) in next.config will crash the build.

# FONTS — next/font/google only

CORRECT: import { Inter, Space_Grotesk } from 'next/font/google'
WRONG: import from '@next/font' (does not exist — build will fail)
WRONG: import from '@fontsource/inter' (requires separate npm install)

# CARDS AND SECTIONS

- Every card: border border-white/10 bg-white/5 backdrop-blur-sm rounded-2xl
- Every card hover: whileHover={{ y: -8 }} with framer-motion
- Every section: minimum py-24 spacing
- Navbar: fixed, backdrop-blur, becomes bg-black/80 on scroll past 50px
- Footer: dark bg, border-t border-white/10, columns of links, social icons

# OVERFLOW RULES — MANDATORY

- Every button: max-w-fit or w-full — never overflow parent
- All text: overflow-hidden text-ellipsis on single lines
- Images: always overflow-hidden on parent container
- Mobile: all sections max-w-full overflow-x-hidden
- Navbar: items-center justify-between — never wrap
- No absolute positioned elements without overflow:hidden parent

# SELF-CHECK before each file

Before writing each file, verify in your head:
- Does this component use any hook or event handler? → needs 'use client' on line 1
- Does this have dark/invisible text on dark background? → fix text colors to white/zinc-400
- Does package.json reference @next/font? → remove it
- Are all imports available in the packages listed? → verify each one

# TAILWIND VERSION — always v3, never v4

Always use tailwindcss@^3.4.0 — NOT v4.

postcss.config.js must use:
\`\`\`js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
\`\`\`

NEVER use @tailwindcss/postcss — that is v4 only and will break the build.
NEVER import from 'tailwindcss/plugin' — use the require() pattern instead.
`;


const INITIAL_BATCH_SIZE = 8;
const BATCH_SIZE_LARGE = 50;
const MAX_SINGLE_RETRIES = 3;
const BATCH_DELAY_MS = 1000;
const BUILDER_MAX_TOKENS = 4000;  // Hard cap per call. Hero gets its own separate 4000 budget.

function buildDesignContext(blueprint: DesignBlueprint): string {
  return `DESIGN: Colors ${blueprint.colorPalette.primary}/${blueprint.colorPalette.accent}, ` +
    `Fonts ${blueprint.fontPair.heading}+${blueprint.fontPair.body}, ` +
    `Anim ${blueprint.animationLibrary}, UI ${blueprint.uiLibrary}, ` +
    `Layout ${blueprint.layoutStyle}, 3D ${blueprint.threeD}(${blueprint.threeDStyle}), ` +
    `Glass ${blueprint.glassmorphism}, Dark ${blueprint.darkMode}`;
}

function chunkArray(arr: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEmptyResponse(response: string): boolean {
  const trimmed = response.trim();
  return !trimmed || !trimmed.includes("<zozo_action");
}

function buildPlaceholder(filePath: string): string {
  const ext = filePath.split(".").pop() || "";
  const isTsx = ext === "tsx" || ext === "jsx";

  if (isTsx) {
    return `<zozo_action type="write" path="${filePath}">
// ZOZO could not generate this file. Please regenerate.
export default function Placeholder() {
  return <div>Placeholder — regenerate this file with ZOZO</div>;
}
</zozo_action>`;
  }

  return `<zozo_action type="write" path="${filePath}">
// ZOZO could not generate this file. Please regenerate.
export default {};
</zozo_action>`;
}

interface BuildContext {
  userPrompt: string;
  template: string;
  designContext: string;
  plan: ProjectPlan;
  provider: string;
  apiKey: string;
  totalBatches: number;
  outputChannel: vscode.OutputChannel;
  systemPrompt: string;
}

function buildBatchPrompt(
  ctx: BuildContext,
  files: string[],
  batchLabel: string,
  isFirst: boolean
): string {
  let prompt = `USER REQUEST: ${ctx.userPrompt}
TEMPLATE: ${ctx.template}
${ctx.designContext}
FRAMEWORK: ${ctx.plan.framework}
TECH STACK: ${ctx.plan.techStack.join(", ")}
`;

  if (isFirst) {
    prompt += `\n${batchLabel}. Write these files. Include:
- package.json as a <zozo_action type="write" path="package.json"> with ALL dependencies for the entire project
- tsconfig.json, tailwind.config.ts, next.config.ts if in this batch
- Do NOT generate any <zozo_action type="run"> commands. ZOZO handles npm install automatically.

`;
  } else {
    prompt += `\n${batchLabel}. Write ONLY these files.
Previous batches already created other files — import from them normally.

`;
  }

  prompt += `FILES TO WRITE (${files.length}):\n`;
  for (const f of files) {
    prompt += `- ${f}\n`;
  }

  prompt += `\nFOLDER STRUCTURE:\n${ctx.plan.folderStructure}\n`;
  prompt += `\nWrite complete code for ALL ${files.length} files above as zozo_action XML blocks now.`;

  return prompt;
}

async function tryBuildFiles(
  ctx: BuildContext,
  files: string[],
  batchLabel: string,
  isFirst: boolean
): Promise<string> {
  const prompt = buildBatchPrompt(ctx, files, batchLabel, isFirst);
  const response = await streamFromLLM(prompt, ctx.provider, ctx.apiKey, ctx.systemPrompt, {
    maxOutputTokens: BUILDER_MAX_TOKENS,
  });
  return response;
}

async function buildWithRetry(
  ctx: BuildContext,
  files: string[],
  batchLabel: string,
  isFirst: boolean,
  depth: number
): Promise<{ xml: string; succeeded: number; skipped: string[] }> {
  const oc = ctx.outputChannel;
  let xml = "";
  let succeeded = 0;
  const skipped: string[] = [];

  try {
    const response = await tryBuildFiles(ctx, files, batchLabel, isFirst);

    if (!isEmptyResponse(response)) {
      oc.appendLine(`[ZOZO SUCCESS] ${batchLabel} complete (${files.length} files)`);
      return { xml: response, succeeded: files.length, skipped: [] };
    }

    // Empty response — try splitting
    oc.appendLine(`[ZOZO RETRY] ${batchLabel} returned empty. Splitting into smaller chunks...`);
    vscode.window.showWarningMessage("ZOZO: Batch failed, retrying smaller...");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    oc.appendLine(`[ZOZO RETRY] ${batchLabel} failed: ${msg}. Splitting...`);
    vscode.window.showWarningMessage("ZOZO: Batch failed, retrying smaller...");
  }

  await delay(BATCH_DELAY_MS);

  // If we have more than 1 file, split in half and retry each half
  if (files.length > 1) {
    const mid = Math.ceil(files.length / 2);
    const firstHalf = files.slice(0, mid);
    const secondHalf = files.slice(mid);

    const r1 = await buildWithRetry(ctx, firstHalf, `${batchLabel}a`, isFirst, depth + 1);
    await delay(BATCH_DELAY_MS);
    const r2 = await buildWithRetry(ctx, secondHalf, `${batchLabel}b`, false, depth + 1);

    return {
      xml: r1.xml + "\n" + r2.xml,
      succeeded: r1.succeeded + r2.succeeded,
      skipped: [...r1.skipped, ...r2.skipped],
    };
  }

  // Single file — retry up to MAX_SINGLE_RETRIES times
  const singleFile = files[0];

  for (let attempt = 1; attempt <= MAX_SINGLE_RETRIES; attempt++) {
    oc.appendLine(`[ZOZO RETRY] Single file attempt ${attempt}/${MAX_SINGLE_RETRIES}: ${singleFile}`);
    await delay(BATCH_DELAY_MS);

    try {
      const response = await tryBuildFiles(ctx, [singleFile], `Single-file retry`, isFirst);

      if (!isEmptyResponse(response)) {
        oc.appendLine(`[ZOZO SUCCESS] Generated: ${singleFile} (attempt ${attempt})`);
        return { xml: response, succeeded: 1, skipped: [] };
      }
    } catch {
      // Continue to next attempt
    }
  }

  // All retries exhausted — write placeholder
  oc.appendLine(`[ZOZO SKIP] Could not generate: ${singleFile}`);
  vscode.window.showWarningMessage(`ZOZO: Skipped file — ${singleFile}`);

  return {
    xml: buildPlaceholder(singleFile),
    succeeded: 0,
    skipped: [singleFile],
  };
}

/**
 * Context-aware variant of runBuilderAgent.
 * Preferred over the raw-params variant for new call sites.
 * The raw-params variant stays for backward compatibility.
 */
export async function runBuilderAgentWithContext(
  ctx: BuilderContext,
  plan: ProjectPlan,
  designBlueprint: DesignBlueprint
): Promise<string> {
  return runBuilderAgent(
    ctx.userPrompt,
    plan,
    designBlueprint,
    'saas',  // template defaults — context doesn't carry template yet
    ctx.provider,
    ctx.apiKey,
    ctx.designRulesSection,
    ctx.memoryContext,
    ctx.fixPrompt,
    ctx.packageConstraints
  );
}

export async function runBuilderAgent(
  userPrompt: string,
  plan: ProjectPlan,
  blueprint: DesignBlueprint,
  template: string,
  provider: string,
  apiKey: string,
  // Optional context-sourced params (used by context variant):
  designRulesOverride?: string,
  memoryContextOverride?: string,
  fixPromptOverride?: string,
  packageConstraintsOverride?: string,
  profile?: {
    style?: string
    animation?: string
    depth?: string
    inspiration?: string[]
  }
): Promise<string> {
  const designContext = buildDesignContext(blueprint);
  const providerLower = provider.toLowerCase();

  // Inject design rules into system prompt
  const dre = new DesignRulesEngine();
  const rules = dre.getRules(template ?? 'saas');
  const designSection = designRulesOverride || dre.toPromptSection(rules, template ?? 'saas');

  // Build profile injection section
  let profileSection = ''
  if (profile) {
    profileSection = `
# USER SELECTIONS — FOLLOW EXACTLY

STYLE: ${(profile.style ?? 'modern').toUpperCase()}
${profile.style === 'premium' ? '→ Framer.com quality. Ultra-thin fonts. Large whitespace. Premium feel.' : ''}
${profile.style === 'minimal' ? '→ Linear.app quality. No noise. Clean.' : ''}

ANIMATION: ${(profile.animation ?? 'light').toUpperCase()}
${profile.animation === 'heavy' ? `→ MANDATORY — copy this exact pattern on every section:
const container = { hidden: {}, visible: { transition: { staggerChildren: 0.12 } } }
const item = { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16,1,0.3,1] } } }
<motion.div variants={container} initial="hidden" whileInView="visible" viewport={{ once: true }}>
  <motion.h2 variants={item}>Title</motion.h2>
  <motion.p variants={item}>Body</motion.p>
</motion.div>
Every card: whileHover={{ y: -8, scale: 1.02 }} transition={{ type:"spring", stiffness:300 }}` : ''}
${profile.animation === 'none' ? '→ No animations. Static only.' : ''}

VISUAL DEPTH: ${(profile.depth ?? '2d').toUpperCase()}
${profile.depth === '3d' ? `→ MANDATORY: Hero MUST use @react-three/fiber Canvas with 3D objects.
Add to package.json: "three": "^0.160.0", "@react-three/fiber": "^8.15.0", "@react-three/drei": "^9.92.0"
Hero imports: import { Canvas } from '@react-three/fiber'
Create floating animated 3D mesh in hero section.` : ''}
${profile.depth === 'hybrid' ? '→ Glassmorphism on all cards: backdrop-blur-md bg-white/5 border border-white/10' : ''}

INSPIRATION: ${profile.inspiration?.join(', ') ?? 'none'}
${profile.inspiration?.includes('framer-style') ? '→ Smooth editorial motion. Stagger reveals. Spring physics.' : ''}
${profile.inspiration?.includes('web3-crypto') ? '→ Dark neon. Glow effects. Gradient borders. Particle fields.' : ''}
${profile.inspiration?.includes('editorial') ? '→ Large typography. Thin fonts. Massive whitespace.' : ''}
`
  }

  const fullSystemPrompt = BUILDER_SYSTEM_PROMPT
    + '\n\n' + profileSection
    + '\n\n' + designSection
    + (packageConstraintsOverride ? '\n\n' + packageConstraintsOverride : '');

  // Apply fix prompt override if provided (from quality gate context)
  const effectivePrompt = fixPromptOverride
    ? userPrompt + '\n\n' + fixPromptOverride
    : userPrompt;

  // Create output channel for logging
  const outputChannel = vscode.window.createOutputChannel("ZOZO Builder Agent");

  const ctx: BuildContext = {
    userPrompt: effectivePrompt,
    template,
    designContext,
    plan,
    provider,
    apiKey,
    totalBatches: 0,
    outputChannel,
    systemPrompt: fullSystemPrompt,
  };

  // Anthropic handles everything in one shot
  if (providerLower === "anthropic") {
    const configFiles = ['package.json', 'tsconfig.json', 'tailwind.config.ts', 'next.config.js', 'postcss.config.js', 'app/globals.css', 'app/layout.tsx', 'lib/utils.ts', 'app/page.tsx']
    const configs = plan.filesToCreate.filter(f => configFiles.some(c => f.endsWith(c)))
    const components = plan.filesToCreate.filter(f => f.startsWith('components/'))
    const others = plan.filesToCreate.filter(f => !configs.includes(f) && !components.includes(f))

    const groups = [
      { files: [...configs, ...others], label: 'Config+Pages', tokens: 4000 },
      ...components.map(f => ({ files: [f], label: f, tokens: 8000 })),
    ].filter(g => g.files.length > 0)

    const allResponses: string[] = []
    for (const group of groups) {
      outputChannel.appendLine(`[ZOZO] Building: ${group.label}`)
      let prompt = buildBatchPrompt(ctx, group.files, group.label, allResponses.length === 0)

      // Drift reset: after 2+ batches, force strict correctness over creativity
      const driftReset = allResponses.length >= 2 ?
        `RESET: Generate this component fresh. Follow STRICT correctness over design. Do NOT prioritize animations over valid code. Complete file only. No truncation.\n\n` : ''
      prompt = driftReset + prompt

      // Inject active profile as explicit instructions
      const profileInstructions = ctx.systemPrompt.includes('framer') ? `
🎯 ACTIVE CREATIVE MODE: FRAMER-STYLE
- Word-by-word text reveal on hero headline — MANDATORY
- Magnetic buttons on all CTAs — MANDATORY  
- Smooth Lenis scroll — MANDATORY
- Large editorial whitespace py-48 — MANDATORY
` : ctx.systemPrompt.includes('web3') ? `
🎯 ACTIVE CREATIVE MODE: WEB3 NEON
- Animated gradient mesh background — MANDATORY
- Neon glow borders cyan — MANDATORY
- Counter animations with useSpring — MANDATORY
` : ctx.systemPrompt.includes('3d') ? `
🎯 ACTIVE CREATIVE MODE: THREE.JS 3D — MANDATORY

1. package.json MUST include these exact versions:
"three": "^0.160.0",
"@react-three/fiber": "^8.15.0",
"@react-three/drei": "^9.92.0"
NEVER overwrite existing dependencies — merge them.

2. next.config.js MUST have:
module.exports = { transpilePackages: ['three'] }

3. Hero.tsx MUST be 'use client' and include real Canvas:
import { Canvas } from '@react-three/fiber'
import { Float, Stars } from '@react-three/drei'

<section className="relative min-h-screen overflow-hidden">
  <Canvas 
    camera={{ position: [0, 0, 5], fov: 75 }} 
    className="absolute inset-0 w-full h-full"
  >
    <ambientLight intensity={0.5} />
    <directionalLight position={[2, 2, 2]} intensity={1} />
    <Stars radius={100} depth={50} count={2000} factor={4} />
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <mesh>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshStandardMaterial color="#7c3aed" wireframe />
      </mesh>
    </Float>
  </Canvas>
  <div className="relative z-10 flex flex-col items-center justify-center min-h-screen">
    {/* headline and CTAs here */}
  </div>
</section>

4. page.tsx must wrap Hero in Suspense:
import { Suspense } from 'react'
<Suspense fallback={<div className="min-h-screen bg-black" />}>
  <Hero />
</Suspense>

NEVER use CSS floating shapes when 3D is selected.
Stars count MUST be 2000 not 5000 — performance.
` : `
🎯 ACTIVE CREATIVE MODE: PREMIUM LUXURY
- Full bleed parallax hero image — MANDATORY
- Horizontal scroll product gallery — MANDATORY
- Gold accents throughout — MANDATORY
`

      prompt = profileInstructions + '\n\n' + prompt

      const response = await streamFromLLM(prompt, provider, apiKey, fullSystemPrompt, {
        maxOutputTokens: group.tokens,
      })
      if (response && response.includes('<zozo_action')) {
        // Quick validate before accepting
        const hasUnclosedJSX = (response.match(/<[A-Z]/g) || []).length >
          (response.match(/<\/[A-Z]/g) || []).length + 20
        const isTruncated = !response.includes('export default') &&
          group.label.startsWith('components/')

        if (hasUnclosedJSX || isTruncated) {
          outputChannel.appendLine(`[ZOZO] ⚠️ ${group.label} failed validation — retrying...`)
          const retry = await streamFromLLM(prompt, provider, apiKey, fullSystemPrompt, {
            maxOutputTokens: group.tokens,
          })
          if (retry && retry.includes('<zozo_action')) {
            allResponses.push(retry)
            outputChannel.appendLine(`[ZOZO] ✅ ${group.label} complete (retry)`)
          }
        } else {
          allResponses.push(response)
          outputChannel.appendLine(`[ZOZO] ✅ ${group.label} complete`)
        }
      }
      await delay(500)
    }

    vscode.window.showInformationMessage('ZOZO: All files built!')
    return allResponses.join('\n')
  }

  // Gemini / OpenAI — use smart retry with adaptive batch splitting
  const batches = chunkArray(plan.filesToCreate, INITIAL_BATCH_SIZE);
  ctx.totalBatches = batches.length;

  outputChannel.appendLine(`[ZOZO] Builder starting: ${plan.filesToCreate.length} files in ${batches.length} batches (size ${INITIAL_BATCH_SIZE})`);

  const allResponses: string[] = [];
  let totalSucceeded = 0;
  const totalSkipped: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const label = `Batch ${i + 1}/${batches.length}`;
    outputChannel.appendLine(`\n[ZOZO] ${label}: ${batches[i].length} files`);

    const result = await buildWithRetry(ctx, batches[i], label, i === 0, 0);

    allResponses.push(result.xml);
    totalSucceeded += result.succeeded;
    totalSkipped.push(...result.skipped);

    // Delay between batches to avoid rate limiting
    if (i < batches.length - 1) {
      outputChannel.appendLine(`[ZOZO] Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await delay(BATCH_DELAY_MS);
    }
  }

  // Final report
  outputChannel.appendLine(`\n[ZOZO] Builder complete: ${totalSucceeded} succeeded, ${totalSkipped.length} skipped`);

  if (totalSkipped.length > 0) {
    outputChannel.appendLine("[ZOZO] Skipped files:");
    for (const f of totalSkipped) {
      outputChannel.appendLine(`  ❌ ${f}`);
    }
    vscode.window.showWarningMessage(
      `ZOZO: Built ${totalSucceeded} files. ${totalSkipped.length} files need regeneration. Run ZOZO again targeting missing files.`
    );
  } else {
    vscode.window.showInformationMessage("ZOZO: All files built successfully!");
  }

  return allResponses.join("\n");
}
