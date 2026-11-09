import * as vscode from "vscode";
import { streamFromLLM } from "../engine/NetworkNode";
import { ProjectPlan } from "./PlannerAgent";
import { DesignBlueprint } from "./DesignAgent";
import { DesignRulesEngine } from "../engine/DesignRulesEngine";
import type { BuilderContext } from '../engine/AgentContext';
import { PipelineEventBus } from '../engine/PipelineEventBus';




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

# CREATIVE STANDARD

Judged against Nike.com, Framer.com, SSENSE.com, Awwwards SOTD. Generic = failed.

VISUAL DEPTH: Hero must use parallax image OR kinetic typography OR video bg. Add grain overlay (opacity 0.03), gradient orbs (blur-[120px] opacity-20), grid/dot bg patterns.

MOTION: Every section whileInView stagger. Every card whileHover y:-8 scale:1.02. Every button whileTap scale:0.95. Hero headline word-by-word reveal. Stats use useMotionValue+useSpring counting.

INTERACTIONS: Magnetic buttons on primary CTAs (useState pos, getBoundingClientRect, motion.button animate). Navbar transparent→frosted glass at 50px scroll. Horizontal snap scroll on product sections.

TYPOGRAPHY: Hero h1 clamp(4rem,10vw,10rem) weight:900 tracking:-0.04em. Section h2 clamp(2.5rem,5vw,5rem). Labels text-[10px] tracking-[0.4em] uppercase. Mix display+sans fonts. Gradient text on ONE key word.

SECTIONS (include ALL): Hero (full viewport, parallax, magnetic CTA, scroll indicator), Marquee/Ticker (CSS translateX(-50%) infinite), Product Grid (real images, spring hover), Stats Row (animated counting), Testimonials (luxury copy, stagger), Footer (4 columns, social icons, border-top).

PRODUCT IMAGES — NEVER dark empty boxes. Use media context URLs if provided. Fallback: picsum.photos with unique IDs per card. img: w-full h-full object-cover hover:scale-110 transition-transform duration-700.

COPY: Match brand tone (luxury→"Handcrafted for those who refuse to compromise", not "Platform for teams"). Stats→"500 Units Per Drop" not "99.9% Uptime".

# GLOBALS.CSS RULES

Define CSS variables: --background:#09090b, --surface:#111118, --accent:#7c3aed, --accent-cyan:#06b6d4, --text:#e4e4e7, --muted:#71717a, --ease-out-expo:cubic-bezier(0.16,1,0.3,1).
Include @keyframes shimmer and float at TOP LEVEL (never nested inside selectors — nested @keyframes breaks CSS parser).
Custom scrollbar (6px, brand color thumb). Selection highlight in accent.

CRITICAL: Never nest @keyframes inside a CSS class. Always write @keyframes at the TOP LEVEL.

# PACKAGE.JSON — exact versions, never "latest"

NEVER add eslint or eslint-config-next (peer dependency conflicts). NEVER add @next/font (doesn't exist). NEVER add shadcn-ui (use @/components/ui/ paths).
Required: "next":"^14.2.0", "react":"^18.3.0", "react-dom":"^18.3.0", "framer-motion":"^11.0.0", "lucide-react":"^0.400.0", "clsx":"^2.1.0", "tailwind-merge":"^2.3.0", "next-themes":"^0.3.0"

# NEXT.CONFIG — CommonJS only: module.exports = {}. ES module export default crashes the build.

# FONTS — import from 'next/font/google' only. NEVER '@next/font' or '@fontsource/*'.

# CARDS: border border-white/10 bg-white/5 backdrop-blur-sm rounded-2xl. Hover: whileHover y:-8. Sections: min py-24. Navbar: fixed backdrop-blur bg-black/80 on scroll.

# OVERFLOW: Buttons max-w-fit. Text overflow-hidden text-ellipsis. Images overflow-hidden parent. Mobile max-w-full overflow-x-hidden. No absolute without overflow:hidden parent.

# SELF-CHECK: 'use client' if hooks/events? Dark text on dark bg? @next/font references? All imports exist in packages?

# TAILWIND v3 ONLY — tailwindcss@^3.4.0, NOT v4.
postcss.config.js: module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }
NEVER use @tailwindcss/postcss (v4 only). NEVER import from 'tailwindcss/plugin' — use require().
`;


const INITIAL_BATCH_SIZE = 2;          // Was 4 — 2 files per batch gives each file ~8x more token budget
const BATCH_SIZE_LARGE = 50;
const MAX_SINGLE_RETRIES = 3;
const BATCH_DELAY_MS = 1000;
const BUILDER_MAX_TOKENS = 16384;      // Was 8192 — doubled to prevent mid-component truncation

function buildDesignContext(blueprint: DesignBlueprint): string {
  return `DESIGN: Colors ${blueprint.colorPalette.primary}/${blueprint.colorPalette.accent}, ` +
    `Fonts ${blueprint.fontPair.heading}+${blueprint.fontPair.body}, ` +
    `Anim ${blueprint.animationLibrary}, UI ${blueprint.uiLibrary}, ` +
    `Layout ${blueprint.layoutStyle}, 3D ${blueprint.threeD}(${blueprint.threeDStyle}), ` +
    `Glass ${blueprint.glassmorphism}, Dark ${blueprint.darkMode}`;
}

// ─── Adaptive Token Budget ────────────────────────────────────────────────────
// Gives complex files more tokens than simple ones, matching real-world complexity.

function getTokenBudget(filePath: string): number {
  // Config files are tiny
  if (/package\.json$/i.test(filePath)) return 3000;
  if (/tsconfig\.json$/i.test(filePath)) return 1500;
  if (/tailwind\.config/i.test(filePath)) return 2000;
  if (/next\.config/i.test(filePath)) return 1500;
  if (/postcss\.config/i.test(filePath)) return 1000;

  // CSS files — need room for keyframes and variables
  if (/globals\.css$/i.test(filePath)) return 4000;

  // Layout is medium — defines fonts, metadata, structure
  if (/layout\.tsx$/i.test(filePath)) return 5000;

  // Utils are small
  if (/lib\//i.test(filePath)) return 2000;

  // Page files import all components — need to list them
  if (/page\.tsx$/i.test(filePath)) return 8000;

  // Components by complexity
  if (/Hero|Header/i.test(filePath)) return 12000;   // Most complex — parallax, animations, 3D
  if (/Navbar/i.test(filePath)) return 8000;          // Scroll detection, mobile menu
  if (/Footer/i.test(filePath)) return 5000;          // Simple columns
  if (/Pricing|FAQ|Accordion/i.test(filePath)) return 6000;  // Toggle state
  if (/Testimonial/i.test(filePath)) return 6000;     // Cards + stagger

  return 8000;  // Default for other components
}

// ─── Context Extraction ───────────────────────────────────────────────────────
// Extracts a compact summary of generated code for context chaining.
// Only keeps: exports, prop types/interfaces, and import lines.
// This prevents the context window from exploding while ensuring
// subsequent files reference correct prop names, exports, and paths.

function extractExportsAndProps(code: string, filePath: string): string {
  const lines = code.split('\n');
  const summary: string[] = [`// ${filePath}`];

  // For config files (JSON, CSS, JS configs), include full content since they're small
  if (/\.(json|css)$/.test(filePath) || /config\.(js|ts|mjs)$/.test(filePath)) {
    // Cap at 60 lines for safety
    return code.split('\n').slice(0, 60).join('\n');
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Keep import lines (shows what this file depends on)
    if (trimmed.startsWith('import ')) {
      summary.push(trimmed);
      continue;
    }

    // Keep interface/type definitions (shows prop shapes)
    if (/^(export\s+)?(interface|type)\s+\w+/.test(trimmed)) {
      // Capture the full interface block
      const startIdx = lines.indexOf(line);
      let depth = 0;
      let endIdx = startIdx;
      for (let j = startIdx; j < lines.length; j++) {
        depth += (lines[j].match(/\{/g) || []).length;
        depth -= (lines[j].match(/\}/g) || []).length;
        endIdx = j;
        if (depth <= 0 && j > startIdx) break;
      }
      summary.push(lines.slice(startIdx, endIdx + 1).join('\n'));
      continue;
    }

    // Keep export default and named exports (shows what this file provides)
    if (trimmed.startsWith('export default ') || trimmed.startsWith('export function ') || trimmed.startsWith('export const ')) {
      // Just the signature, not the body
      const sig = trimmed.replace(/\{[\s\S]*$/, '{...}');
      summary.push(sig);
      continue;
    }

    // Keep 'use client' directive
    if (trimmed === "'use client'" || trimmed === '"use client"') {
      summary.push(trimmed);
      continue;
    }
  }

  return summary.join('\n');
}

// ─── File Grouping for Sequential Generation ─────────────────────────────────
// Groups files into a smart execution order where each group can see
// the output of all previous groups.

interface FileGroup {
  files: string[];
  label: string;
  totalTokenBudget: number;
  thinking: boolean;  // Enable extended thinking for complex groups
}

function buildFileGroups(filesToCreate: string[]): FileGroup[] {
  const groups: FileGroup[] = [];

  // Config files — always generated together (small, interdependent)
  const configPatterns = [/package\.json$/, /tsconfig\.json$/, /tailwind\.config/, /next\.config/, /postcss\.config/];
  const configFiles = filesToCreate.filter(f => configPatterns.some(p => p.test(f)));
  if (configFiles.length > 0) {
    const budget = configFiles.reduce((sum, f) => sum + getTokenBudget(f), 0);
    groups.push({ files: configFiles, label: 'Config files', totalTokenBudget: budget, thinking: false });
  }

  // Foundation: globals.css + layout.tsx + lib/utils.ts
  const foundationFiles = filesToCreate.filter(f =>
    /globals\.css$/.test(f) || /layout\.tsx$/.test(f) || /lib\//.test(f)
  );
  if (foundationFiles.length > 0) {
    const budget = foundationFiles.reduce((sum, f) => sum + getTokenBudget(f), 0);
    groups.push({ files: foundationFiles, label: 'Foundation files', totalTokenBudget: budget, thinking: false });
  }

  // page.tsx — after components so it knows what to import
  // But we generate it before components and then regenerate if needed
  const pageFiles = filesToCreate.filter(f => /page\.tsx$/.test(f));

  // Components — one per call, with thinking enabled for complex ones
  const componentFiles = filesToCreate.filter(f =>
    f.startsWith('components/') || (f.endsWith('.tsx') && !pageFiles.includes(f) && !foundationFiles.includes(f))
  );

  // Sort components: simple first (Footer, Nav), complex last (Hero)
  const complexityOrder = (f: string): number => {
    if (/Footer/i.test(f)) return 1;
    if (/Testimonial/i.test(f)) return 2;
    if (/Pricing|FAQ/i.test(f)) return 3;
    if (/Features|Stats/i.test(f)) return 4;
    if (/Navbar|Nav/i.test(f)) return 5;
    if (/Hero|Header/i.test(f)) return 6;  // Last — most complex, needs most context
    return 3;
  };
  componentFiles.sort((a, b) => complexityOrder(a) - complexityOrder(b));

  for (const comp of componentFiles) {
    const budget = getTokenBudget(comp);
    const isComplex = /Hero|Header|Navbar/i.test(comp);
    groups.push({ files: [comp], label: comp, totalTokenBudget: budget, thinking: isComplex });
  }

  // Page files last — they import all components, so they need the full context
  if (pageFiles.length > 0) {
    for (const page of pageFiles) {
      groups.push({ files: [page], label: page, totalTokenBudget: getTokenBudget(page), thinking: true });
    }
  }

  // Any remaining files
  const allGrouped = new Set(groups.flatMap(g => g.files));
  const remaining = filesToCreate.filter(f => !allGrouped.has(f));
  for (const f of remaining) {
    groups.push({ files: [f], label: f, totalTokenBudget: getTokenBudget(f), thinking: false });
  }

  return groups;
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
      // Truncation detection — check for incomplete files (missing export default, unclosed JSX)
      const hasExportDefault = response.includes('export default');
      const openTags = (response.match(/<[A-Z][a-zA-Z]*[^/\n>]*>/g) || []).length;
      const closeTags = (response.match(/<\/[A-Z][a-zA-Z]*>/g) || []).length;
      const selfClosing = (response.match(/<[A-Z][a-zA-Z]*[^>]*\/>/g) || []).length;
      const hasUnclosedJSX = (openTags - selfClosing) > (closeTags + 5);
      const hasComponentFiles = files.some(f => f.startsWith('components/') || f.endsWith('.tsx'));

      if (hasComponentFiles && (!hasExportDefault || hasUnclosedJSX)) {
        oc.appendLine(`[ZOZO TRUNCATION] ${batchLabel} detected truncated output (export default: ${hasExportDefault}, unclosed JSX: ${hasUnclosedJSX}). Retrying...`);
        // Fall through to retry logic below
      } else {
        oc.appendLine(`[ZOZO SUCCESS] ${batchLabel} complete (${files.length} files)`);
        return { xml: response, succeeded: files.length, skipped: [] };
      }
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
    ctx.template ?? 'saas',  // use real detected template — was hardcoded 'saas', breaks all retries
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

  // ── ANTHROPIC — Sequential generation with context chaining ──────────────
  if (providerLower === "anthropic") {
    const groups = buildFileGroups(plan.filesToCreate);
    const allResponses: string[] = [];
    const generatedCode: Map<string, string> = new Map();

    outputChannel.appendLine(`[ZOZO] Anthropic sequential: ${plan.filesToCreate.length} files in ${groups.length} groups`);

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      outputChannel.appendLine(`[ZOZO] [${gi + 1}/${groups.length}] Building: ${group.label} (${group.totalTokenBudget} tokens, thinking: ${group.thinking})`);

      // Build context from previously generated files
      let contextSection = '';
      if (generatedCode.size > 0) {
        contextSection = '\n## PREVIOUSLY GENERATED FILES — use these exact exports and props\n\n';
        for (const [filePath, code] of generatedCode) {
          const summary = extractExportsAndProps(code, filePath);
          contextSection += `### ${filePath}\n\`\`\`\n${summary}\n\`\`\`\n\n`;
        }
      }

      let prompt = contextSection + buildBatchPrompt(ctx, group.files, group.label, gi === 0);
      if (gi >= 2) {
        prompt = `RESET: Generate this component fresh. STRICT correctness over design. Complete file only. No truncation.\n\n` + prompt;
      }

      // Emit file_generating to sidebar before starting
      const _bus = PipelineEventBus.getInstance();
      const _sid = _bus.getCurrentSessionId();
      _bus.emit({ type: 'file_generating', sessionId: _sid, filePath: group.label, agentName: 'builder' });

      const response = await streamFromLLM(prompt, provider, apiKey, fullSystemPrompt, {
        maxOutputTokens: group.totalTokenBudget,
        thinking: group.thinking,
        thinkingBudget: group.thinking ? 8192 : undefined,
        onChunk: (chunk) => _bus.emit({ type: 'build_chunk', sessionId: _sid, chunk, filePath: group.label }),
      });

      if (response && response.includes('<zozo_action')) {
        // Truncation check
        const openTags = (response.match(/<[A-Z][a-zA-Z]*[^/\n>]*>/g) || []).length;
        const closeTags = (response.match(/<\/[A-Z][a-zA-Z]*>/g) || []).length;
        const selfClosing = (response.match(/<[A-Z][a-zA-Z]*[^>]*\/>/g) || []).length;
        const hasUnclosedJSX = (openTags - selfClosing) > (closeTags + 5);
        const isTruncated = !response.includes('export default') && group.label.startsWith('components/');

        if (hasUnclosedJSX || isTruncated) {
          outputChannel.appendLine(`[ZOZO] ⚠️ ${group.label} truncated — retrying with thinking...`);
          const retry = await streamFromLLM(prompt, provider, apiKey, fullSystemPrompt, {
            maxOutputTokens: group.totalTokenBudget,
            thinking: true,
            thinkingBudget: 8192,
          });
          if (retry && retry.includes('<zozo_action')) {
            allResponses.push(retry);
            for (const f of group.files) {
              const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const fileMatch = retry.match(new RegExp(`<zozo_action[^>]*path="${escaped}"[^>]*>([\\s\\S]*?)</zozo_action>`));
              if (fileMatch) generatedCode.set(f, fileMatch[1]);
            }
            _bus.emit({ type: 'file_complete', sessionId: _sid, filePath: group.label, lineCount: retry.split('\n').length });
            outputChannel.appendLine(`[ZOZO] ✅ ${group.label} complete (retry)`);
          }
        } else {
          allResponses.push(response);
          for (const f of group.files) {
            const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const fileMatch = response.match(new RegExp(`<zozo_action[^>]*path="${escaped}"[^>]*>([\\s\\S]*?)</zozo_action>`));
            if (fileMatch) generatedCode.set(f, fileMatch[1]);
          }
          _bus.emit({ type: 'file_complete', sessionId: _sid, filePath: group.label, lineCount: response.split('\n').length });
          outputChannel.appendLine(`[ZOZO] ✅ ${group.label} complete`);
        }
      } else {
        outputChannel.appendLine(`[ZOZO] ⚠️ ${group.label} returned empty — writing placeholder`);
        for (const f of group.files) allResponses.push(buildPlaceholder(f));
      }
      await delay(500);
    }

    outputChannel.appendLine(`[ZOZO] Anthropic sequential complete: ${generatedCode.size}/${plan.filesToCreate.length} files with context chaining`);
    vscode.window.showInformationMessage('ZOZO: All files built!');
    return allResponses.join('\n');
  }

  // ── GEMINI / OPENAI — Sequential generation with context chaining ───────
  const groups = buildFileGroups(plan.filesToCreate);
  const allResponses: string[] = [];
  const generatedCode: Map<string, string> = new Map();
  let totalSucceeded = 0;
  const totalSkipped: string[] = [];

  outputChannel.appendLine(`[ZOZO] ${providerLower} sequential: ${plan.filesToCreate.length} files in ${groups.length} groups`);

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    outputChannel.appendLine(`\n[ZOZO] [${gi + 1}/${groups.length}] Building: ${group.label} (${group.totalTokenBudget} tokens, thinking: ${group.thinking})`);

    // Build context from previously generated files
    let contextSection = '';
    if (generatedCode.size > 0) {
      contextSection = '\n## PREVIOUSLY GENERATED FILES — use these exact exports and props\n\n';
      for (const [filePath, code] of generatedCode) {
        const summary = extractExportsAndProps(code, filePath);
        contextSection += `### ${filePath}\n\`\`\`\n${summary}\n\`\`\`\n\n`;
      }
    }

    let prompt = contextSection + buildBatchPrompt(ctx, group.files, group.label, gi === 0);
    if (gi >= 2) {
      prompt = `RESET: Generate this component fresh. STRICT correctness over design. Complete file only. No truncation.\n\n` + prompt;
    }

    // Emit file_generating before each group starts
    const bus2 = PipelineEventBus.getInstance();
    const sid2 = bus2.getCurrentSessionId();
    bus2.emit({ type: 'file_generating', sessionId: sid2, filePath: group.label, agentName: 'builder' });

    try {
      const response = await streamFromLLM(prompt, ctx.provider, ctx.apiKey, fullSystemPrompt, {
        maxOutputTokens: group.totalTokenBudget,
        thinking: group.thinking,
        thinkingBudget: group.thinking ? 4096 : undefined,
        onChunk: (chunk) => bus2.emit({ type: 'build_chunk', sessionId: sid2, chunk, filePath: group.label }),
      });

      if (!isEmptyResponse(response)) {
        // Truncation detection
        const hasExportDefault = response.includes('export default');
        const openTags = (response.match(/<[A-Z][a-zA-Z]*[^/\n>]*>/g) || []).length;
        const closeTags = (response.match(/<\/[A-Z][a-zA-Z]*>/g) || []).length;
        const selfClosing = (response.match(/<[A-Z][a-zA-Z]*[^>]*\/>/g) || []).length;
        const hasUnclosedJSX = (openTags - selfClosing) > (closeTags + 5);
        const hasComponentFiles = group.files.some(f => f.startsWith('components/') || f.endsWith('.tsx'));

        if (hasComponentFiles && (!hasExportDefault || hasUnclosedJSX)) {
          outputChannel.appendLine(`[ZOZO TRUNCATION] ${group.label} truncated — retrying with thinking...`);

          const retry = await streamFromLLM(prompt, ctx.provider, ctx.apiKey, fullSystemPrompt, {
            maxOutputTokens: group.totalTokenBudget,
            thinking: true,
            thinkingBudget: 4096,
          });

          if (!isEmptyResponse(retry)) {
            allResponses.push(retry);
            totalSucceeded += group.files.length;
            // Extract code for context chaining
            for (const f of group.files) {
              const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const fileMatch = retry.match(new RegExp(`<zozo_action[^>]*path="${escaped}"[^>]*>([\\s\\S]*?)</zozo_action>`));
              if (fileMatch) generatedCode.set(f, fileMatch[1]);
            }
            bus2.emit({ type: 'file_complete', sessionId: sid2, filePath: group.label, lineCount: retry.split('\n').length });
          outputChannel.appendLine(`[ZOZO SUCCESS] ${group.label} complete (retry with thinking)`);
          } else {
            // Retry failed too — use placeholder
            for (const f of group.files) {
              allResponses.push(buildPlaceholder(f));
              totalSkipped.push(f);
            }
          }
        } else {
          allResponses.push(response);
          totalSucceeded += group.files.length;
          // Extract code for context chaining
          for (const f of group.files) {
            const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const fileMatch = response.match(new RegExp(`<zozo_action[^>]*path="${escaped}"[^>]*>([\\s\\S]*?)</zozo_action>`));
            if (fileMatch) generatedCode.set(f, fileMatch[1]);
          }
          bus2.emit({ type: 'file_complete', sessionId: sid2, filePath: group.label, lineCount: response.split('\n').length });
          outputChannel.appendLine(`[ZOZO SUCCESS] ${group.label} complete`);
        }
      } else {
        // Empty response — placeholder
        outputChannel.appendLine(`[ZOZO SKIP] ${group.label} returned empty`);
        for (const f of group.files) {
          allResponses.push(buildPlaceholder(f));
          totalSkipped.push(f);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[ZOZO ERROR] ${group.label}: ${msg}`);
      for (const f of group.files) {
        allResponses.push(buildPlaceholder(f));
        totalSkipped.push(f);
      }
    }

    // Delay between groups to avoid rate limiting
    if (gi < groups.length - 1) {
      await delay(BATCH_DELAY_MS);
    }
  }

  // Final report
  outputChannel.appendLine(`\n[ZOZO] ${providerLower} sequential complete: ${totalSucceeded} succeeded, ${totalSkipped.length} skipped, ${generatedCode.size} files with context chaining`);

  if (totalSkipped.length > 0) {
    outputChannel.appendLine("[ZOZO] Skipped files:");
    for (const f of totalSkipped) {
      outputChannel.appendLine(`  ❌ ${f}`);
    }
    vscode.window.showWarningMessage(
      `ZOZO: Built ${totalSucceeded} files. ${totalSkipped.length} files need regeneration.`
    );
  } else {
    vscode.window.showInformationMessage("ZOZO: All files built successfully!");
  }

  return allResponses.join("\n");
}


