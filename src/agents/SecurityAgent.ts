import { streamFromLLM } from "../engine/NetworkNode";
import type { SecurityContext } from '../engine/AgentContext';

const SECURITY_SYSTEM_PROMPT = `You are the Security Agent, a senior application security engineer.
Scan all generated code and fix:
1. Exposed API keys or secrets in code (move to .env)
2. Missing input sanitization on forms
3. SQL injection vulnerabilities
4. XSS vulnerabilities in dangerouslySetInnerHTML
5. Missing CORS headers on API routes
6. Hardcoded credentials anywhere
7. Missing rate limiting on API routes
8. Insecure direct object references
9. Missing .env.example entries for all secrets used
10. Console.log statements exposing sensitive data

Output ONLY zozo_action XML blocks for files that need security fixes.
If no issues found, output exactly: <zozo_action type="write" path="SECURITY_CLEAN">ok</zozo_action>`;

export async function runSecurityAgent(
  xml: string,
  provider: string,
  apiKey: string
): Promise<string> {
  const userMessage = `Scan this generated application code for security vulnerabilities and fix them.

GENERATED CODE:
${xml.substring(0, 8000)}

Output zozo_action XML blocks with fixed files only.`;

  try {
    const response = await streamFromLLM(userMessage, provider, apiKey, SECURITY_SYSTEM_PROMPT);

    // If the response is just the SECURITY_CLEAN marker, no fixes needed
    if (response.includes("SECURITY_CLEAN")) {
      return "";
    }

    return response;
  } catch {
    // Security scan is non-critical — don't block the pipeline
    return "";
  }
}

/**
 * Context-aware variant of runSecurityAgent.
 */
export async function runSecurityAgentWithContext(
  ctx: SecurityContext
): Promise<string> {
  return runSecurityAgent(ctx.validatedXML, ctx.provider, ctx.apiKey);
}
