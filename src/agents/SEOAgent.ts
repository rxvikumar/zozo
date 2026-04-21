import { streamFromLLM } from "../engine/NetworkNode";
import { ProjectPlan } from "./PlannerAgent";
import type { SEOContext } from '../engine/AgentContext';

const SEO_SYSTEM_PROMPT = `You are the SEO Agent, an expert in Next.js SEO and web performance.
For the built application, generate these files as zozo_action XML:

1. Complete Next.js metadata in app/layout.tsx:
   - title, description, keywords, openGraph, twitter card
   - All dynamic and relevant to what was built
   - Include viewport, themeColor, manifest link
   - Use Next.js Metadata API (export const metadata: Metadata)

2. public/robots.txt:
   User-agent: *
   Allow: /
   Sitemap: https://yoursite.com/sitemap.xml

3. app/sitemap.ts:
   Next.js 14 sitemap generator returning all static routes
   Export default async function sitemap(): Promise<MetadataRoute.Sitemap>
   Include all page routes with lastModified, changeFrequency, priority

4. app/manifest.ts:
   PWA manifest for installability
   Export default function manifest(): MetadataRoute.Manifest
   Include: name, short_name, description, start_url, display, background_color, theme_color, icons

5. Update next.config.ts:
   Add image domains (unsplash, picsum, etc.), compression headers
   Add security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
   Enable experimental optimizePackageImports for large packages

Make all metadata REAL and relevant to the actual app built. Use the project name and description.
Output ONLY zozo_action XML blocks.`;

export async function runSEOAgent(
  plan: ProjectPlan,
  userPrompt: string,
  provider: string,
  apiKey: string
): Promise<string> {
  const userMessage = `Generate SEO, PWA, and performance config files for this application.

PROJECT: ${plan.projectName}
USER REQUEST: ${userPrompt}
FRAMEWORK: ${plan.framework}
TECH STACK: ${plan.techStack.join(", ")}
ROUTES/FILES: ${plan.filesToCreate.filter((f: string) => f.includes("app/") && f.endsWith("/page.tsx")).join(", ")}

Generate all SEO files as zozo_action XML now.`;

  try {
    const response = await streamFromLLM(userMessage, provider, apiKey, SEO_SYSTEM_PROMPT);
    return response;
  } catch {
    // SEO is non-critical
    return "";
  }
}

/**
 * Context-aware variant of runSEOAgent.
 */
export async function runSEOAgentWithContext(
  ctx: SEOContext,
  plan: ProjectPlan
): Promise<string> {
  return runSEOAgent(plan, ctx.userPrompt, ctx.provider, ctx.apiKey);
}
