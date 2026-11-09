import { streamStructuredJSON, streamFromLLM } from "../engine/NetworkNode";
import type { ToolSchema } from "../engine/NetworkNode";
import { DesignBlueprint } from "./DesignAgent";
import type { PlannerContext } from '../engine/AgentContext';
import { classifyTask, classificationToPromptHint, type TaskClassification } from '../engine/TaskClassifier';
import { validateManifest, formatManifestScore } from '../engine/ManifestValidator';

export interface ProjectPlan {
  projectName: string;
  techStack: string[];
  framework: "nextjs" | "react" | "vue" | "vanilla";
  filesToCreate: string[];
  terminalCommands: string[];
  folderStructure: string;
  estimatedComponents: number;
  // ── New fields from governor ──────────────────────────────────────────────
  taskType?: string;          // classified task type (dashboard, landing, etc.)
  fileBudgetUsed?: number;    // actual files after manifest validation
  fileBudgetAllowed?: number; // budget that was set before planning
  fileEfficiency?: number;    // ManifestValidator score
}

// ─── Tool schema — maxItems is API-enforced, model cannot exceed it ──────────
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
          maxItems: maxFiles,  // ← API ENFORCED LIMIT — model cannot exceed this
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

// ─── System prompt — governor-aware ─────────────────────────────────────────
function buildSystemPrompt(classification: TaskClassification): string {
  const maxFiles = classification.fileBudget;
  const classificationHint = classificationToPromptHint(classification);

  return `You are ZOZO's Planner agent.

${classificationHint}

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

# CONSOLIDATION — CRITICAL
Hard limit: ${maxFiles} files. If you think you need more:
1. Put page-specific UI INLINE in the page.tsx for that page
2. Merge simple, related components into one file
3. Put all shared types inline in the file that uses them — no separate types/ folder
4. Never create index.ts barrel exports — use direct imports
5. Never create a hook file for a hook used in only one place

Multi-page example: dashboard with 4 pages → ONE Sidebar.tsx, ONE Layout.tsx,
page-specific widgets inline inside each app/pagename/page.tsx.
Total files for 4-page dashboard: ~15 files (not 40).
`;
}

export async function runPlannerAgent(
  userPrompt: string,
  template: string,
  blueprint: DesignBlueprint,
  provider: string,
  apiKey: string,
  mode: string = 'express'
): Promise<ProjectPlan> {

  // ── GOVERNOR: classify task and set budget BEFORE planning ───────────────
  const classification = classifyTask(userPrompt);
  const maxFiles = classification.fileBudget;

  console.log(
    `[PLANNER] TaskClassifier: ${classification.type} → budget ${maxFiles} files | ${classification.reason}`
  );

  const systemPrompt = buildSystemPrompt(classification);

  const userMessage = `USER REQUEST: ${userPrompt}
TEMPLATE: ${template}
TASK TYPE: ${classification.type.toUpperCase()}
FILE BUDGET: ${maxFiles} files MAXIMUM (API-enforced)
DESIGN: ${JSON.stringify(blueprint, null, 2)}`;

  // ── Try structured output (tool_use) — schema enforces maxItems ──────────
  try {
    const tool = buildPlannerTool(maxFiles);
    const parsed = await streamStructuredJSON<ProjectPlan>(
      userMessage, provider, apiKey, systemPrompt, tool
    );

    return applyGovernorToResult(parsed, classification, userPrompt, maxFiles);

  } catch (structuredErr) {
    console.log(`[PLANNER] Structured output failed, falling back to text: ${
      structuredErr instanceof Error ? structuredErr.message : String(structuredErr)
    }`);

    // ── Fallback: text-based parsing ──────────────────────────────────────
    const raw = await streamFromLLM(userMessage + '\n\nRespond with JSON only.', provider, apiKey, systemPrompt);

    let clean = raw.replace(/<analysis>[\s\S]*?<\/analysis>/g, '');
    const planMatch = clean.match(/<plan>\s*([\s\S]*?)\s*<\/plan>/);
    if (planMatch) clean = planMatch[1];
    clean = clean.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) clean = clean.substring(start, end + 1);

    const parsed = JSON.parse(clean) as ProjectPlan;
    return applyGovernorToResult(parsed, classification, userPrompt, maxFiles);
  }
}

/**
 * Apply governor post-processing to any parsed plan:
 * 1. Defaults
 * 2. Multi-page injection
 * 3. ManifestValidator (removes hallucinations, checks budget)
 * 4. Hard-cap
 */
function applyGovernorToResult(
  parsed: ProjectPlan,
  classification: TaskClassification,
  userPrompt: string,
  maxFiles: number
): ProjectPlan {
  // Defaults
  parsed.projectName       = parsed.projectName || "zozo-app";
  parsed.techStack         = parsed.techStack || ["next", "react", "typescript", "tailwindcss"];
  parsed.techStack         = parsed.techStack.filter(pkg => !pkg.startsWith('@fontsource'));
  parsed.framework         = parsed.framework || "nextjs";
  parsed.filesToCreate     = parsed.filesToCreate || [];
  parsed.terminalCommands  = parsed.terminalCommands || [];
  parsed.folderStructure   = parsed.folderStructure || "";
  parsed.estimatedComponents = parsed.estimatedComponents || parsed.filesToCreate.length;

  // Multi-page injection: detect pages from prompt
  const pageKeywords = [
    'dashboard','analytics','users','settings','profile',
    'billing','reports','home','about','pricing','contact',
  ];
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

  // ── ManifestValidator — remove hallucinations + check budget ─────────────
  const { cleaned, score } = validateManifest(parsed.filesToCreate, maxFiles);
  console.log(formatManifestScore(score));
  parsed.filesToCreate = cleaned;

  // Hard-cap after manifest validation (safety net)
  if (parsed.filesToCreate.length > maxFiles) {
    console.log(`[PLANNER] ⚠️  Trimming ${parsed.filesToCreate.length} → ${maxFiles} (${classification.type} budget)`);
    parsed.filesToCreate = parsed.filesToCreate.slice(0, maxFiles);
  }

  // Attach governor metrics to plan for Orchestrator and EvalScorecard
  parsed.taskType        = classification.type;
  parsed.fileBudgetUsed  = parsed.filesToCreate.length;
  parsed.fileBudgetAllowed = maxFiles;
  parsed.fileEfficiency  = score.fileEfficiency;

  console.log(
    `[PLANNER] ✅ Final plan: ${parsed.filesToCreate.length} files | ` +
    `efficiency ${score.fileEfficiency}% | budget ${parsed.filesToCreate.length}/${maxFiles}`
  );

  return parsed;
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
