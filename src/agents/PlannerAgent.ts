import { streamStructuredJSON, streamFromLLM } from "../engine/NetworkNode";
import type { ToolSchema } from "../engine/NetworkNode";
import { DesignBlueprint } from "./DesignAgent";
import type { PlannerContext } from '../engine/AgentContext';

export interface ProjectPlan {
  projectName: string;
  techStack: string[];
  framework: "nextjs" | "react" | "vue" | "vanilla";
  filesToCreate: string[];
  terminalCommands: string[];
  folderStructure: string;
  estimatedComponents: number;
}

// ─── Mode → max file mapping ───────────────────────────────────────────────
const MODE_FILE_LIMITS: Record<string, number> = {
  express: 40,
  standard: 60,
  full: 80,
};

// ─── Tool schema for structured output ─────────────────────────────────────
// maxItems enforced by the API — model physically cannot exceed this.
function buildPlannerTool(maxFiles: number): ToolSchema {
  return {
    name: 'create_project_plan',
    description: 'Create a complete project plan with files, tech stack, and folder structure.',
    input_schema: {
      type: 'object',
      required: ['projectName', 'techStack', 'framework', 'filesToCreate', 'terminalCommands', 'folderStructure', 'estimatedComponents'],
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name (lowercase, hyphenated)',
        },
        techStack: {
          type: 'array',
          items: { type: 'string' },
          description: 'NPM packages used (e.g. next, react, framer-motion)',
        },
        framework: {
          type: 'string',
          enum: ['nextjs', 'react', 'vue', 'vanilla'],
        },
        filesToCreate: {
          type: 'array',
          items: { type: 'string' },
          maxItems: maxFiles,  // ← API ENFORCED LIMIT — cannot exceed this
          description: `All file paths to generate. MAXIMUM ${maxFiles} files. No project-name prefix (WRONG: my-app/app/page.tsx, CORRECT: app/page.tsx).`,
        },
        terminalCommands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Package names only (never scaffold commands like create-next-app)',
        },
        folderStructure: {
          type: 'string',
          description: 'ASCII tree representation of the project structure',
        },
        estimatedComponents: {
          type: 'integer',
          description: 'Total number of React components planned',
        },
      },
    },
  };
}

// ─── System prompt: # sections + consequences ──────────────────────────────
function buildSystemPrompt(mode: string): string {
  const maxFiles = MODE_FILE_LIMITS[mode] ?? 15;
  const modeLabel = mode.toUpperCase();

  return `You are ZOZO's Planner agent.

# File Count Rules
You are in ${modeLabel} mode.

- EXPRESS → plan exactly 12-15 files. Planning more than 15 files in express mode will cause the builder to truncate output and the app will be broken.
- STANDARD → plan 20-30 files maximum. Exceeding 30 will cause truncation.
- FULL → plan up to 50 files maximum.

You are in ${modeLabel} mode. Your limit is ${maxFiles} files.

# Required Files
Every plan MUST include these files. Omitting any will break the build:
- package.json, tsconfig.json, tailwind.config.ts, next.config.js, postcss.config.js
- app/layout.tsx, app/page.tsx, app/globals.css
- lib/utils.ts
- components/Navbar.tsx — ALWAYS required. Fixed top navbar with mobile menu.
- components/Footer.tsx — ALWAYS required. Multi-column footer with links.

# Package Rules
- NEVER include @next/font — it does not exist. Build will fail with "module not found."
- NEVER include shadcn-ui or @shadcn/ui — use @/components/ui path imports.
- ALWAYS include: next, react, react-dom, typescript, tailwindcss, framer-motion, lucide-react, clsx, tailwind-merge

# Path Rules
- NEVER prefix paths with a project folder name. This will create a broken subfolder.
- WRONG: my-app/app/page.tsx, dark-landing/components/Hero.tsx
- CORRECT: app/page.tsx, components/Hero.tsx

# Scaffold Rules
- terminalCommands = package names ONLY (e.g. "framer-motion", "lucide-react")
- NEVER include create-next-app, npx create, npm create. These will be blocked.

## FILE PLANNING — THINK LIKE A SENIOR DEVELOPER

Do NOT plan a fixed number of files. Plan EXACTLY what this project needs.

Rules:

* Simple landing page (1 section): 10–12 files
* Rich landing page (5+ sections): 15–20 files
* Portfolio with 3D: 18–25 files (needs separate 3D components)
* Dashboard with multiple pages: 25–40 files (one file per page + shared components)
* Full app with auth/data: 35–50 files

For THIS prompt, ask yourself:

1. How many distinct UI sections does it need?
2. Does it need multiple pages?
3. Does it need 3D? (separate file per 3D object)
4. Does it need utility hooks?
5. Does it need data/types files?

Generate EXACTLY the right number.
Do NOT use a fixed cap. But NEVER exceed what is realistically needed. If unsure, choose the smaller valid architecture.

## COMPLETENESS RULES — MANDATORY

* ALWAYS include Footer.tsx in filesToCreate
* ALWAYS include Footer in page.tsx imports and JSX
* If Footer.tsx exists but is not used in page.tsx → add it immediately
* NEVER leave empty black sections at bottom
* Every page must have: Navbar + at least 3 content sections + Footer

## MULTIPAGE DETECTION — MANDATORY

If the user mentions ANY of these words: dashboard, analytics, users, settings, profile, billing, reports, home, about, pricing, contact, blog, docs, admin, orders, products, inventory, notifications, messages, team, integrations, security, audit, logs, help

→ Generate a SEPARATE app/<pagename>/page.tsx for EACH mentioned page
→ Generate ONE shared components/Sidebar.tsx with navigation links to ALL pages
→ Generate ONE shared components/DashboardLayout.tsx that wraps all pages
→ page.tsx imports DashboardLayout and renders page-specific content
→ NEVER put all pages in one file

MINIMUM FILE COUNT for multipage apps: base files + (1 per detected page) + sidebar + layout wrapper`;
}

export async function runPlannerAgent(
  userPrompt: string,
  template: string,
  blueprint: DesignBlueprint,
  provider: string,
  apiKey: string,
  mode: string = 'express'
): Promise<ProjectPlan> {
  const maxFiles = MODE_FILE_LIMITS[mode] ?? 15;
  const systemPrompt = buildSystemPrompt(mode);

  const userMessage = `USER REQUEST: ${userPrompt}
TEMPLATE: ${template}
MODE: ${mode.toUpperCase()} (max ${maxFiles} files)
DESIGN: ${JSON.stringify(blueprint, null, 2)}`;

  // Try structured output (tool_use) first — schema-enforced
  try {
    const tool = buildPlannerTool(maxFiles);
    const parsed = await streamStructuredJSON<ProjectPlan>(
      userMessage, provider, apiKey, systemPrompt, tool
    );

    // Defaults
    parsed.projectName = parsed.projectName || "zozo-app";
    parsed.techStack = parsed.techStack || ["next", "react", "typescript", "tailwindcss"];
    parsed.techStack = parsed.techStack.filter(pkg => !pkg.startsWith('@fontsource'));
    parsed.framework = parsed.framework || "nextjs";
    parsed.filesToCreate = parsed.filesToCreate || [];
    parsed.terminalCommands = parsed.terminalCommands || [];
    parsed.folderStructure = parsed.folderStructure || "";
    parsed.estimatedComponents = parsed.estimatedComponents || parsed.filesToCreate.length;



    // Detect multiple pages from prompt like Claude Code does
    const pageKeywords = ['dashboard','analytics','users','settings','profile','billing','reports','home','about','pricing','contact'];
    const mentioned = pageKeywords.filter(p => userPrompt.toLowerCase().includes(p));
    if (mentioned.length > 1) {
      mentioned.forEach(page => {
        const pagePath = `app/${page}/page.tsx`;
        if (!parsed.filesToCreate.includes(pagePath)) {
          parsed.filesToCreate.push(pagePath);
        }
      });
      console.log(`[PLANNER] Multi-page detected: ${mentioned.join(', ')}`);
    }

    return parsed;
  } catch (structuredErr) {
    // Fallback: text-based parsing if structured output fails
    console.log(`[PLANNER] Structured output failed, falling back to text: ${structuredErr instanceof Error ? structuredErr.message : String(structuredErr)}`);

    const raw = await streamFromLLM(userMessage + '\n\nRespond with JSON only.', provider, apiKey, systemPrompt);

    // Strip fences and extract JSON
    let clean = raw.replace(/<analysis>[\s\S]*?<\/analysis>/g, '');
    const planMatch = clean.match(/<plan>\s*([\s\S]*?)\s*<\/plan>/);
    if (planMatch) clean = planMatch[1];
    clean = clean.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) clean = clean.substring(start, end + 1);

    const parsed = JSON.parse(clean) as ProjectPlan;
    parsed.projectName = parsed.projectName || "zozo-app";
    parsed.techStack = parsed.techStack || ["next", "react", "typescript", "tailwindcss"];
    parsed.techStack = parsed.techStack.filter(pkg => !pkg.startsWith('@fontsource'));
    parsed.framework = parsed.framework || "nextjs";
    parsed.filesToCreate = parsed.filesToCreate || [];
    parsed.terminalCommands = parsed.terminalCommands || [];
    parsed.folderStructure = parsed.folderStructure || "";
    parsed.estimatedComponents = parsed.estimatedComponents || parsed.filesToCreate.length;



    // Detect multiple pages from prompt like Claude Code does
    const pageKeywords2 = ['dashboard','analytics','users','settings','profile','billing','reports','home','about','pricing','contact'];
    const mentioned2 = pageKeywords2.filter(p => userPrompt.toLowerCase().includes(p));
    if (mentioned2.length > 1) {
      mentioned2.forEach(page => {
        const pagePath = `app/${page}/page.tsx`;
        if (!parsed.filesToCreate.includes(pagePath)) {
          parsed.filesToCreate.push(pagePath);
        }
      });
      console.log(`[PLANNER] Multi-page detected: ${mentioned2.join(', ')}`);
    }

    return parsed;
  }
}

/**
 * Context-aware variant of runPlannerAgent.
 */
export async function runPlannerAgentWithContext(
  ctx: PlannerContext,
  mode: string = 'express'
): Promise<ProjectPlan> {
  return runPlannerAgent(
    ctx.userPrompt,
    ctx.template,
    ctx.designBlueprint as DesignBlueprint,
    ctx.provider,
    ctx.apiKey,
    mode
  );
}
