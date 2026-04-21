import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSync, exec } from "child_process";
import { runCodeGuard } from "./CodeGuard";
// streamFromLLM removed — zero LLM calls in executor (saves API credits)
import { writeFile as antigravityWriteFile } from "./AntigravityWriter";

// ─── Robust XML Parser ──────────────────────────────────────────────────────
// Precise regex for write actions — matches type="write" and path="..." in any attribute order
const WRITE_ACTION_REGEX = /<zozo_action[^>]*type="write"[^>]*path="([^"]+)"[^>]*>([\s\S]*?)<\/zozo_action>/g;
const RUN_ACTION_REGEX = /<zozo_action[^>]*type="run"[^>]*(?:command="([^"]+)")?[^>]*>([\s\S]*?)<\/zozo_action>/g;
const SELF_CLOSING_REGEX = /<zozo_action\s+([^>]*)\s*\/>/g;
const ATTR_REGEX = /(\w+)="([^"]*)"/g;
const MARKDOWN_FENCE_REGEX = /^```[\w]*\s*\n?|\n?```\s*$/g;

interface ParsedAttributes {
  [key: string]: string;
}

function parseAttributes(attrString: string): ParsedAttributes {
  const attrs: ParsedAttributes = {};
  let match: RegExpExecArray | null;
  ATTR_REGEX.lastIndex = 0;
  while ((match = ATTR_REGEX.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/** Parse write actions with precise regex — prevents content corruption */
function parseWriteActions(xml: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  WRITE_ACTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WRITE_ACTION_REGEX.exec(xml)) !== null) {
    const filePath = match[1]!.trim();
    const content = match[2]!
      .replace(/^[\r\n]+/, '')  // trim leading newlines
      .replace(/[\r\n]+$/, '')  // trim trailing newlines
      .replace(/\r\n/g, '\n');  // normalize to LF always
    if (filePath && content.trim()) {
      results.push({ path: filePath, content });
    }
  }
  return results;
}

function stripMarkdownFences(code: string): string {
  return code.replace(MARKDOWN_FENCE_REGEX, "").trim();
}

// ─── SmartTerminal: deterministic error recovery ──────────────────────────────

const TERMINAL_FIX_PROMPT = `You are a terminal error fixer. A command failed during an automated build.
You must output ONLY a valid JSON array of exact fix commands. No explanation. No markdown.
Example: ["npm install missing-pkg", "npm cache clean --force"]
If no fix is possible, output: []`;

function extractJsonArray(raw: string): string[] {
  try {
    // Try direct parse first
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed.filter((s: unknown) => typeof s === "string");
  } catch { /* fallback */ }
  // Try to extract from markdown fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed.filter((s: unknown) => typeof s === "string");
    } catch { /* fallback */ }
  }
  // Try to find array in raw text
  const arrMatch = raw.match(/\[([\s\S]*?)\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(`[${arrMatch[1]}]`);
      if (Array.isArray(parsed)) return parsed.filter((s: unknown) => typeof s === "string");
    } catch { /* fallback */ }
  }
  return [];
}

async function smartRunCommand(
  command: string,
  workspaceRoot: string,
  outputChannel: vscode.OutputChannel,
  _provider?: string,
  _apiKey?: string
): Promise<{ success: boolean; output: string }> {
  try {
    const output = execSync(command, {
      cwd: workspaceRoot,
      stdio: "pipe",
      maxBuffer: 1024 * 1024 * 10,
      encoding: "utf-8",
      timeout: 120000,
    });
    return { success: true, output: output || "" };
  } catch (err: unknown) {
    const errorOutput = err instanceof Error
      ? (err as any).stderr || (err as any).stdout || err.message
      : String(err);
    const errorStr = typeof errorOutput === "string" ? errorOutput : String(errorOutput);

    outputChannel.appendLine(`[SMART-TERMINAL] ❌ Command failed: ${command}`);
    outputChannel.appendLine(`[SMART-TERMINAL] Error: ${errorStr.substring(0, 500)}`);

    // No LLM call — try --legacy-peer-deps automatically (zero API cost)
    if (command.includes('npm install') && !command.includes('--legacy-peer-deps')) {
      outputChannel.appendLine(`[SMART-TERMINAL] 🔧 Retrying with --legacy-peer-deps...`);
      try {
        const retryOutput = execSync(`${command} --legacy-peer-deps`, {
          cwd: workspaceRoot,
          stdio: "pipe",
          maxBuffer: 1024 * 1024 * 10,
          encoding: "utf-8",
          timeout: 120000,
        });
        outputChannel.appendLine(`[SMART-TERMINAL] ✅ Retry with --legacy-peer-deps succeeded!`);
        return { success: true, output: retryOutput || "" };
      } catch {
        outputChannel.appendLine(`[SMART-TERMINAL] ❌ Retry also failed.`);
      }
    }

    outputChannel.appendLine(`[SMART-TERMINAL] ⚠️ Fix manually: ${command} --legacy-peer-deps`);
    return { success: false, output: errorStr };
  }
}

// ─── Per-file validation (zero API cost) ──────────────────────────────────────
function validateWrittenFile(
  filePath: string,
  content: string,
  outputChannel: vscode.OutputChannel
): string {
  const ext = path.extname(filePath);

  // CSS: check for mismatched braces
  if (ext === '.css') {
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      content = content + '\n}'.repeat(openBraces - closeBraces);
      outputChannel.appendLine(`[EXECUTOR] 🔧 Fixed ${openBraces - closeBraces} unclosed brace(s) in ${path.basename(filePath)}`);
    }
  }

  // TS/TSX: check for broken imports and truncation
  if (ext === '.tsx' || ext === '.ts') {
    // Fix broken imports from corrupted XML
    if (content.match(/from "[^"]*">/)) {
      content = content.replace(/from "([^"]*)">$/gm, 'from "$1";');
      outputChannel.appendLine(`[EXECUTOR] \uD83D\uDD27 Fixed broken import in ${path.basename(filePath)}`);
    }

    // Fix page.tsx merged imports — import Component<JSX content> pattern
    if (filePath.endsWith('page.tsx') || filePath.endsWith('page.jsx')) {
      const mergedPattern = /import (\w+)<[^>]+>/g;
      if (mergedPattern.test(content)) {
        content = content.replace(/import (\w+)<[^>]+>/g, "import $1 from '@/components/$1'");
        outputChannel.appendLine(`[EXECUTOR] \uD83D\uDD27 Fixed merged import corruption in page.tsx`);
      }
    }

    // Warn about truncated files
    const hasImports = content.includes('import ');
    const hasExport = content.includes('export default') || content.includes('export {') || content.includes('export function') || content.includes('export const');
    if (hasImports && !hasExport) {
      outputChannel.appendLine(`[EXECUTOR] \u26A0\uFE0F WARNING: ${path.basename(filePath)} may be truncated (has imports but no exports)`);
    }
  }

  return content;
}

// ─── Pre-Write Safety Hook ───────────────────────────────────────────────────

/**
 * PreWriteHook
 * Safety checks before any file is written to disk.
 * Returns { safe: boolean, reason?: string }
 * From not-clawd-code coordinator pattern.
 */
function preWriteHook(
  filePath: string,
  content: string
): { safe: boolean; reason?: string } {

  // 1. Path traversal attack prevention
  const normalised = filePath.replace(/\\/g, '/')
  if (normalised.includes('../') || normalised.includes('..\\')) {
    return { safe: false, reason: `Path traversal detected in: ${filePath}` }
  }

  // 2. Never overwrite package.json root scripts without valid name
  if (filePath === 'package.json' || filePath.endsWith('/package.json')) {
    if (content.includes('"scripts"') && content.includes('"next"')) {
      // Allow — it's a valid Next.js package.json
    } else if (!content.includes('"name"')) {
      return { safe: false, reason: 'Invalid package.json — missing name field' }
    }
  }

  // 3. Never write empty files
  if (!content || content.trim().length < 10) {
    return { safe: false, reason: `Empty or near-empty file blocked: ${filePath}` }
  }

  // 4. Never write files outside safe extensions
  const SAFE_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.css', '.scss',
    '.json', '.md', '.env.example', '.gitignore',
    '.yaml', '.yml', '.toml', '.html', '.svg',
    '.prisma', '.sql',
  ]
  if (!SAFE_EXTENSIONS.some(s => filePath.endsWith(s))) {
    const ext = '.' + (filePath.split('.').pop()?.toLowerCase() ?? '')
    return { safe: false, reason: `Blocked unsafe extension: ${ext} in ${filePath}` }
  }

  // 5. Detect obvious injection patterns in generated code
  const DANGEROUS_PATTERNS = [
    /process\.env\.destroy/i,
    /fs\.rm.*recursive.*force/i,
    /exec\s*\(\s*['"`]rm\s+-rf/i,
    /eval\s*\(/,
    /child_process.*exec.*rm/i,
  ]
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      return { safe: false, reason: `Dangerous pattern blocked in ${filePath}` }
    }
  }

  return { safe: true }
}

// ─── Main Executor ───────────────────────────────────────────────────────────

export async function executeActions(
  xmlString: string,
  workspaceRoot: string,
  outputChannel: vscode.OutputChannel,
  provider?: string,
  apiKey?: string
): Promise<{ fileCount: number; filesWritten: string[] }> {
  let fileCount = 0;
  const writtenFiles: string[] = [];
  let runCount = 0;
  let deleteCount = 0;

  interface Action {
    type: string;
    attrs: ParsedAttributes;
    content: string;
  }

  // ── Parse write actions with robust regex (prevents content corruption) ──
  const writeActions = parseWriteActions(xmlString);

  // ── Parse run/self-closing actions with old parser (these are blocked anyway) ──
  const otherActions: Action[] = [];
  RUN_ACTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RUN_ACTION_REGEX.exec(xmlString)) !== null) {
    otherActions.push({
      type: "run",
      attrs: { type: "run", command: match[1] || match[2]?.trim() || "" },
      content: match[2] || "",
    });
  }
  SELF_CLOSING_REGEX.lastIndex = 0;
  while ((match = SELF_CLOSING_REGEX.exec(xmlString)) !== null) {
    const attrs = parseAttributes(match[1]);
    otherActions.push({ type: attrs.type || "", attrs, content: "" });
  }

  const totalActions = writeActions.length + otherActions.length;
  outputChannel.appendLine(`[EXECUTOR] Found ${totalActions} action(s) — ${writeActions.length} writes, ${otherActions.length} other.\n`);

  // ── Process write actions first (robust parser) ──
  for (const writeAction of writeActions) {
    let filePath = writeAction.path;

    // Strip project-name prefix if LLM hallucinated one (e.g. dark-saas-landing/app/page.tsx → app/page.tsx)
        const KNOWN_TOP_DIRS = ['app', 'components', 'lib', 'public', 'styles', 'hooks', 'utils', 'types', 'prisma', 'src']
        const firstSlash = filePath.indexOf('/')
        if (firstSlash > 0) {
          const firstSegment = filePath.slice(0, firstSlash)
          const secondSegment = filePath.slice(firstSlash + 1).split('/')[0] ?? ''
          // If first segment is NOT a known dir, but second segment IS → strip the prefix
          if (!KNOWN_TOP_DIRS.includes(firstSegment) && KNOWN_TOP_DIRS.includes(secondSegment)) {
            const stripped = filePath.slice(firstSlash + 1)
            outputChannel.appendLine(`[EXECUTOR] 🔧 Stripped project prefix: ${filePath} → ${stripped}`)
            filePath = stripped
          }
        }
        // Also strip prefix for root config files (package.json, tsconfig.json, etc.)
        const ROOT_CONFIG_FILES = ['package.json', 'tsconfig.json', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'tailwind.config.ts', 'tailwind.config.js', 'postcss.config.js', 'postcss.config.mjs', '.env.example', '.gitignore', 'README.md']
        if (firstSlash > 0 && ROOT_CONFIG_FILES.includes(filePath.slice(firstSlash + 1))) {
          const stripped = filePath.slice(firstSlash + 1)
          outputChannel.appendLine(`[EXECUTOR] 🔧 Stripped project prefix: ${filePath} → ${stripped}`)
          filePath = stripped
        }

        let content = stripMarkdownFences(writeAction.content);
        // LF already normalized by parseWriteActions, but belt-and-suspenders
        content = content.replace(/\r\n/g, '\n');
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(workspaceRoot, filePath);

        // ── Package.json validation ──────────────────────────────────
        const isPackageJson = path.basename(filePath) === "package.json";
        if (isPackageJson) {
          let isValid = true;

          // Check 1: Is it valid JSON?
          try {
            JSON.parse(content);
          } catch {
            outputChannel.appendLine("[EXECUTOR] ⚠️ package.json is not valid JSON. Using fallback.");
            isValid = false;
          }

          // Check 2: Does it contain placeholder text?
          if (isValid && (content.includes("// ZOZO") || content.includes("/* ZOZO") || content.includes("TODO"))) {
            outputChannel.appendLine("[EXECUTOR] ⚠️ package.json contains placeholder text. Using fallback.");
            isValid = false;
          }

          if (!isValid) {
            // Determine project name from folder
            const projectName = path.basename(workspaceRoot).toLowerCase().replace(/\s+/g, "-");
            content = JSON.stringify({
              name: projectName,
              version: "0.1.0",
              private: true,
              scripts: {
                dev: "next dev",
                build: "next build",
                start: "next start",
                lint: "next lint"
              },
              dependencies: {
                "next": "^14.2.3",
                "react": "^18.3.1",
                "react-dom": "^18.3.1",
                "framer-motion": "^11.0.0",
                "lucide-react": "^0.400.0",
                "clsx": "^2.1.0",
                "tailwind-merge": "^2.3.0",
                "next-themes": "^0.3.0",
                "class-variance-authority": "^0.7.0",
                "@radix-ui/react-slot": "^1.0.2"
              },
              devDependencies: {
                "typescript": "^5.4.0",
                "tailwindcss": "^3.4.0",
                "@types/node": "^20.0.0",
                "@types/react": "^18.3.0",
                "@types/react-dom": "^18.3.0",
                "postcss": "^8.4.0",
                "autoprefixer": "^10.4.0"
              }
            }, null, 2);
            outputChannel.appendLine("[EXECUTOR] ✅ Wrote fallback package.json with required deps.");
          } else {
            // Valid package.json — strip problematic packages
            try {
              const parsed = JSON.parse(content);
              const STRIP_PACKAGES = ['eslint', 'eslint-config-next', '@next/font', 'shadcn-ui'];
              let stripped = false;
              for (const pkg of STRIP_PACKAGES) {
                if (parsed.dependencies?.[pkg]) { delete parsed.dependencies[pkg]; stripped = true; }
                if (parsed.devDependencies?.[pkg]) { delete parsed.devDependencies[pkg]; stripped = true; }
              }
              // Ensure tailwindcss is pinned to v3
              if (parsed.devDependencies?.['tailwindcss'] && !parsed.devDependencies['tailwindcss'].startsWith('^3')) {
                parsed.devDependencies['tailwindcss'] = '^3.4.0';
                stripped = true;
              }
              if (stripped) {
                content = JSON.stringify(parsed, null, 2);
                outputChannel.appendLine("[EXECUTOR] 🔧 Stripped eslint/forbidden packages from package.json");
              }
            } catch {}
          }
        }

        // Pre-write safety check
        const hookResult = preWriteHook(filePath, content);
        if (!hookResult.safe) {
          outputChannel.appendLine(`[ZOZO] ⛔ PreWriteHook blocked: ${hookResult.reason}`);
          break;
        }

        // ── TypeScript/TSX content validation ────────────────────────
        if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
          // Fix broken import statements from corrupted XML (trailing ">")
          const brokenImportPattern = /^(import .+ from "[^"]+")">$/mg;
          if (brokenImportPattern.test(content)) {
            content = content.replace(/^(import .+ from "[^"]+")">$/mg, '$1";');
            outputChannel.appendLine(`[EXECUTOR] 🔧 Fixed broken import in ${filePath}`);
          }
        }

        // ── PostCSS: enforce Tailwind v3 format ─────────────────────
        if (filePath === 'postcss.config.js' || filePath === 'postcss.config.mjs') {
          if (content.includes('@tailwindcss/postcss')) {
            content = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`;
            outputChannel.appendLine(`[EXECUTOR] 🔧 Fixed postcss.config to use Tailwind v3 format`);
          }
        }

        await antigravityWriteFile(filePath, content);

        // Per-file validation — catches CSS braces, broken imports, truncation (zero API cost)
        const validatedContent = validateWrittenFile(filePath, content, outputChannel);
        if (validatedContent !== content) {
          // Re-write with validated content
          await antigravityWriteFile(filePath, validatedContent);
          content = validatedContent;
        }

        // Auto-rename next.config.ts → next.config.js for Next.js 14 compat
        if (path.basename(fullPath) === "next.config.ts") {
          const jsPath = fullPath.replace(/next\.config\.ts$/, "next.config.js");
          fs.renameSync(fullPath, jsPath);
          outputChannel.appendLine(`[EXECUTOR] 🔄 Renamed next.config.ts → next.config.js (Next.js 14 compat)`);
        }

        fileCount++;
        writtenFiles.push(filePath);
        outputChannel.appendLine(`[ZOZO WRITE] ${filePath}`);
        vscode.window.showInformationMessage(`ZOZO Built: ${filePath}`);
  }

  // ── Process other actions (run/delete/rename — mostly blocked) ──
  for (const action of otherActions) {
    switch (action.type) {
      case "run": {
        const command = action.attrs.command;
        if (!command) {
          outputChannel.appendLine("[EXECUTOR] ⚠️ Run action missing command attribute. Skipped.");
          break;
        }

        // Hard block — never execute scaffold commands. ZOZO writes files directly.
        const BLOCKED_COMMANDS = [
          'create-next-app',
          'create-react-app',
          'npx create-',
          'npm create',
          'yarn create',
          'shadcn-ui@latest init',
          'npx shadcn',
        ]
        if (BLOCKED_COMMANDS.some(cmd => command.includes(cmd))) {
          outputChannel.appendLine(`[EXECUTOR] ⛔ BLOCKED scaffold command: ${command.slice(0, 80)}`);
          outputChannel.appendLine(`[EXECUTOR] ZOZO writes files directly — scaffold commands are not needed`);
          break;
        }

        outputChannel.appendLine(`[ZOZO RUN] ${command}`);
        vscode.window.showInformationMessage(`ZOZO Running: ${command}`);

        // Deterministic retry — no LLM
        const result = await smartRunCommand(command, workspaceRoot, outputChannel);
        if (result.success) {
          if (result.output) outputChannel.appendLine(result.output.substring(0, 1000));
          runCount++;
          outputChannel.appendLine(`[ZOZO RUN] ✅ Done: ${command}`);
        } else {
          outputChannel.appendLine(`[ZOZO RUN] ❌ Failed: ${command}`);
          vscode.window.showWarningMessage(`ZOZO: Command failed — ${command}`);
        }
        break;
      }

      case "delete": {
        const filePath = action.attrs.path;
        if (!filePath) {
          outputChannel.appendLine("[EXECUTOR] ⚠️ Delete action missing path attribute. Skipped.");
          break;
        }

        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(workspaceRoot, filePath);

        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          deleteCount++;
          outputChannel.appendLine(`[ZOZO DELETE] ${filePath}`);
          vscode.window.showInformationMessage(`ZOZO Deleted: ${filePath}`);
        } else {
          outputChannel.appendLine(`[ZOZO DELETE] ⚠️ Not found: ${filePath}`);
        }
        break;
      }

      case "rename": {
        const fromPath = action.attrs.from;
        const toPath = action.attrs.to;
        if (!fromPath || !toPath) {
          outputChannel.appendLine("[EXECUTOR] ⚠️ Rename action missing from/to attributes. Skipped.");
          break;
        }

        const fullFrom = path.join(workspaceRoot, fromPath);
        const fullTo = path.join(workspaceRoot, toPath);

        if (fs.existsSync(fullFrom)) {
          fs.mkdirSync(path.dirname(fullTo), { recursive: true });
          fs.renameSync(fullFrom, fullTo);
          outputChannel.appendLine(`[ZOZO RENAME] ${fromPath} → ${toPath}`);
        } else {
          outputChannel.appendLine(`[ZOZO RENAME] ⚠️ Source not found: ${fromPath}`);
        }
        break;
      }

      default:
        outputChannel.appendLine(`[EXECUTOR] ⚠️ Unknown action type: "${action.type}". Skipped.`);
    }
  }

  // Summary
  const summary = `\n✅ ZOZO Executor Complete! Built ${fileCount} file(s), ran ${runCount} command(s), deleted ${deleteCount} file(s).`;
  outputChannel.appendLine(summary);

  // Post-execution: CodeGuard validation, install, dry-run, dev server, open browser
  if (fileCount > 0) {
    // 0. CodeGuard: 6-stage deterministic validation
    outputChannel.appendLine("\n[ZOZO POST] Running CodeGuard validation...");
    vscode.window.showInformationMessage("ZOZO: Validating generated code...");
    const guardResult = await runCodeGuard(workspaceRoot, outputChannel, provider, apiKey);

    // 1. npm install (with SmartTerminal if LLM available)
    outputChannel.appendLine("\n[ZOZO POST] Running npm install...");
    vscode.window.showInformationMessage("ZOZO: Installing dependencies...");
    if (provider && apiKey) {
      const installResult = await smartRunCommand("npm install", workspaceRoot, outputChannel, provider, apiKey);
      if (installResult.success) {
        outputChannel.appendLine("[ZOZO POST] ✅ npm install complete.");
      } else {
        outputChannel.appendLine("[ZOZO POST] ⚠️ npm install failed after SmartTerminal.");
        vscode.window.showWarningMessage("ZOZO: npm install failed. Check output for details.");
      }
    } else {
      try {
        const installOutput = execSync("npm install", {
          cwd: workspaceRoot,
          stdio: "pipe",
          maxBuffer: 1024 * 1024 * 10,
          encoding: "utf-8",
        });
        if (installOutput) outputChannel.appendLine(installOutput);
        outputChannel.appendLine("[ZOZO POST] ✅ npm install complete.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[ZOZO POST] ⚠️ npm install failed: ${msg}`);
      }
    }

    // 2. Dry-run build check — catch errors before dev server
    outputChannel.appendLine("\n[ZOZO POST] 🧪 Running build dry-run check...");
    vscode.window.showInformationMessage("ZOZO: Checking build for errors...");
    try {
      execSync("npx next build --no-lint 2>&1", {
        cwd: workspaceRoot,
        stdio: "pipe",
        maxBuffer: 1024 * 1024 * 10,
        encoding: "utf-8",
        timeout: 180000,
      });
      outputChannel.appendLine("[ZOZO POST] ✅ Build dry-run passed!");
    } catch (buildErr: unknown) {
      const buildOutput = buildErr instanceof Error
        ? (buildErr as any).stdout || (buildErr as any).stderr || buildErr.message
        : String(buildErr);
      const buildStr = typeof buildOutput === "string" ? buildOutput : String(buildOutput);
      outputChannel.appendLine(`[ZOZO POST] ❌ Build errors found.`);
      outputChannel.appendLine(buildStr.substring(0, 1000));

      // No LLM call for build errors — zero API cost
      outputChannel.appendLine(`[ZOZO POST] ⚠️ Build errors found. Fix manually or re-run build.`);
      outputChannel.appendLine(`[ZOZO POST] Try: npm run build — or check the errors above.`);
    }

    // 3. npm run dev (non-blocking background process)
    outputChannel.appendLine("\n[ZOZO POST] Starting dev server (npm run dev)...");
    vscode.window.showInformationMessage("ZOZO: Starting dev server...");

    const devProcess = exec("npm run dev", {
      cwd: workspaceRoot,
      maxBuffer: 1024 * 1024 * 10,
    });

    devProcess.stdout?.on("data", (data: string) => {
      outputChannel.appendLine(`[DEV] ${data.trim()}`);
    });

    devProcess.stderr?.on("data", (data: string) => {
      outputChannel.appendLine(`[DEV stderr] ${data.trim()}`);
    });

    devProcess.on("error", (err) => {
      outputChannel.appendLine(`[DEV] ⚠️ Dev server error: ${err.message}`);
    });

    // 4. Wait 4 seconds for dev server to boot
    await new Promise<void>((resolve) => setTimeout(resolve, 4000));

    // 5. Open browser at localhost:3000
    outputChannel.appendLine("[ZOZO POST] Opening preview at localhost:3000...");
    vscode.window.showInformationMessage("ZOZO: Opening preview at localhost:3000");
    await vscode.env.openExternal(vscode.Uri.parse("http://localhost:3000"));
  }

  return { fileCount, filesWritten: writtenFiles };
}
