import * as vscode from "vscode";
import { streamFromLLM } from "../engine/NetworkNode";
import { ProjectPlan } from "./PlannerAgent";

const SUGGESTION_SYSTEM_PROMPT = `You are the Innovation Agent for ZOZO. After an app is built, you suggest powerful additions the user never asked for.
Output ONLY a JSON array of 5 strings, each a specific feature suggestion.
Examples:
- "Add Stripe payment integration to the pricing page"
- "Add real-time notifications using Supabase subscriptions"
- "Add AI-powered search using OpenAI embeddings"
- "Add PWA support so users can install on mobile"
- "Add Google Analytics 4 with custom events"
Be specific to what was actually built. Output ONLY the JSON array.`;

function extractJsonArray(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end !== -1) return raw.substring(start, end + 1);
  return raw.trim();
}

export async function runSuggestionAgent(
  userPrompt: string,
  plan: ProjectPlan,
  provider: string,
  apiKey: string
): Promise<string[]> {
  const userMessage = `The user asked: "${userPrompt}"
We built a ${plan.framework} app called "${plan.projectName}" with these files: ${plan.filesToCreate.slice(0, 20).join(", ")}
Tech stack: ${plan.techStack.join(", ")}

Suggest 5 specific, powerful additions they would want. Output ONLY a JSON array of 5 strings.`;

  try {
    const raw = await streamFromLLM(userMessage, provider, apiKey, SUGGESTION_SYSTEM_PROMPT);
    const jsonStr = extractJsonArray(raw);
    const parsed = JSON.parse(jsonStr) as string[];

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 5);
    }
    return [];
  } catch {
    return [];
  }
}

export function showSuggestions(suggestions: string[]): void {
  for (const suggestion of suggestions) {
    vscode.window.showInformationMessage(`💡 ${suggestion}`);
  }
}
