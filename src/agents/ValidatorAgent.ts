import { streamFromLLM } from "../engine/NetworkNode";
import { ProjectPlan } from "./PlannerAgent";
import type { ValidatorContext } from '../engine/AgentContext';

export interface ValidationReport {
  status: "clean" | "has_issues";
  issues: Array<{ file: string; line: string; problem: string; fix: string }>;
  missingPackages: string[];
  missingFiles: string[];
  fixedCode: string;
}

const VALIDATOR_SYSTEM_PROMPT = `You are the Validator Agent, a senior TypeScript engineer and code reviewer.
You will receive generated application code as XML blocks.
Your job: find and FIX all issues.

CHECK FOR:
1. Missing imports (component used but not imported)
2. Wrong import paths (../components vs ./components)
3. Packages used in code but missing from package.json
4. TypeScript type errors (missing types, any usage without reason)
5. React hooks rules violations
6. Missing 'use client' directive on client components
7. Files referenced but not created
8. Tailwind classes that don't exist
9. Missing required props on components
10. Broken Next.js App Router patterns

Output ONLY valid JSON (no markdown fences):
{
  "status": "clean" | "has_issues",
  "issues": [{"file": "string", "line": "string", "problem": "string", "fix": "string"}],
  "missingPackages": ["string"],
  "missingFiles": ["string"],
  "fixedCode": "<zozo_action type='write'> blocks with corrected files only"
}
CRITICAL: fixedCode must ONLY contain <zozo_action type="write"> blocks. NEVER type="run". ZOZO handles npm install automatically.
If status is clean, fixedCode is empty string.`;

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1) return raw.substring(start, end + 1);
  return raw.trim();
}

export async function runValidatorAgent(
  generatedXML: string,
  plan: ProjectPlan,
  provider: string,
  apiKey: string
): Promise<ValidationReport> {
  const userMessage = `Review this generated code and validate it.

EXPECTED FILES (from plan): ${plan.filesToCreate.join(", ")}
EXPECTED PACKAGES (from plan): ${plan.terminalCommands.join(", ")}

GENERATED CODE:
${generatedXML.substring(0, 6000)}

Validate thoroughly and output the JSON report.`;

  const raw = await streamFromLLM(userMessage, provider, apiKey, VALIDATOR_SYSTEM_PROMPT);

  try {
    const jsonStr = extractJson(raw);
    const parsed = JSON.parse(jsonStr) as ValidationReport;

    // Ensure required fields have defaults
    parsed.status = parsed.status || "clean";
    parsed.issues = parsed.issues || [];
    parsed.missingPackages = parsed.missingPackages || [];
    parsed.missingFiles = parsed.missingFiles || [];
    parsed.fixedCode = parsed.fixedCode || "";

    // Missing packages are handled by DependencyReconciler — NOT by injecting run actions
    // Just log them for the pipeline to pick up
    if (parsed.missingPackages.length > 0) {
      console.log(`[VALIDATOR] Missing packages detected: ${parsed.missingPackages.join(', ')} — DependencyReconciler will handle`);
    }

    return parsed;
  } catch {
    // If we can't parse the JSON, check if there are any zozo_action blocks in the raw response
    const hasActions = raw.includes("<zozo_action");
    return {
      status: hasActions ? "has_issues" : "clean",
      issues: [],
      missingPackages: [],
      missingFiles: [],
      fixedCode: hasActions ? raw : "",
    };
  }
}

/**
 * Context-aware variant of runValidatorAgent.
 */
export async function runValidatorAgentWithContext(
  ctx: ValidatorContext,
  plan: ProjectPlan
): Promise<ValidationReport> {
  return runValidatorAgent(ctx.builderOutput, plan, ctx.provider, ctx.apiKey);
}
