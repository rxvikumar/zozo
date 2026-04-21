import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { streamFromLLM } from "../engine/NetworkNode";
import { runOrchestration } from "../engine/Orchestrator";
import { PipelineEventBus } from '../engine/PipelineEventBus';

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface DetectedIntent {
  type: "generate_file" | "fix_file" | "explain" | "install" | "build_full" | "chat";
  path?: string;
  packages?: string[];
  reasoning?: string;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Constants Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "out", "dist", ".next", "build", ".turbo", "coverage",
]);
const INCLUDED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html", ".md",
]);
const MAX_CONTEXT_CHARS = 8000;

const INTENT_SYSTEM_PROMPT = `You are ZOZO intent detector. Analyze the user message and workspace context.
You MUST output ONLY valid JSON Ã¢â‚¬â€ no markdown, no explanation, no fences.
{
  "type": "generate_file|fix_file|explain|install|build_full|chat",
  "path": "file path if relevant, relative to workspace root",
  "packages": ["pkg1", "pkg2"] if type is install,
  "reasoning": "one line why you chose this intent"
}

Intent rules:
- "generate_file": user asks to create/add/write a new file or component
- "fix_file": user asks to fix/update/change/debug an existing file
- "explain": user asks to explain code, architecture, or concepts
- "install": user explicitly asks to install packages/dependencies
- "build_full": user asks to build a complete app/website/project from scratch
- "chat": general conversation, questions, or anything else`;

const GENERATE_SYSTEM_PROMPT = `You are a senior full-stack developer. Generate ONLY the complete file content.
No XML tags. No explanation. No markdown fences. Just the raw code.
Rules:
- TypeScript strict mode
- Tailwind CSS for styling
- Use framer-motion for animations
- Dark cyberpunk theme: background #0a0a0a, glass cards, gradients
- Add 'use client' if the file uses React hooks or framer-motion
- Export BOTH named and default exports
- All imports must be correct and complete
- No placeholders, no TODOs`;

const FIX_SYSTEM_PROMPT = `You are a senior developer fixing code. Return ONLY the complete fixed file content.
No explanation. No XML tags. No markdown fences. Just the corrected code.
Keep the same file structure, imports, and exports. Only fix what the user asked for.`;

const CHAT_SYSTEM_PROMPT = `You are ZOZO, an expert full-stack developer assistant embedded in VS Code.
You know the user's entire codebase from the workspace context provided.
Be conversational, helpful, and concise. If you see issues in their code, mention them.
You can suggest commands to run. Use markdown formatting for code snippets.
Keep responses under 300 words unless the user asks for detail.`;

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Chat Panel Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export class ZOZOChatPanel {
  private history: ChatMessage[] = [];
  private workspaceRoot: string;
  private provider: string;
  private apiKey: string;
  private outputChannel: vscode.OutputChannel;
  private panel: vscode.WebviewPanel;

  constructor(
    workspaceRoot: string,
    provider: string,
    apiKey: string,
    outputChannel: vscode.OutputChannel
  ) {
    this.workspaceRoot = workspaceRoot;
    this.provider = provider;
    this.apiKey = apiKey;
    this.outputChannel = outputChannel;

    this.panel = vscode.window.createWebviewPanel(
      "zozoChat",
      "ZOZO Chat",
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getChatHTML();

    this.panel.webview.onDidReceiveMessage(
      async (msg: { type: string; text: string; command?: string }) => {
        if (msg.type === "userMessage" && msg.text.trim()) {
          await this.handleMessage(msg.text.trim());
        }
        if (msg.command === 'cancelBuild') {
          PipelineEventBus.getInstance().cancel();
        }
      }
    );

    // Subscribe to pipeline events and forward to webview
    const bus = PipelineEventBus.getInstance();
    const unsubscribe = bus.subscribe(event => {
      this.panel.webview.postMessage({ type: 'pipeline_event', event });
    });

    this.panel.onDidDispose(() => {
      unsubscribe();
    });

    this.outputChannel.appendLine("[ZOZO CHAT] Panel opened.");
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Main Message Handler Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  async handleMessage(userMessage: string): Promise<void> {
    this.history.push({ role: "user", content: userMessage });
    this.outputChannel.appendLine(`[ZOZO CHAT] User: ${userMessage}`);

    // Show typing indicator
    this.sendToWebview("thinking", "");

    try {
      // Step 1: Scan workspace for context
      const context = this.scanWorkspace();

      // Step 2: Detect intent
      const intent = await this.detectIntent(userMessage, context);
      this.outputChannel.appendLine(`[ZOZO CHAT] Intent: ${intent.type} | ${intent.reasoning || ""}`);

      // Step 3: Act based on intent
      switch (intent.type) {
        case "generate_file":
          await this.generateSingleFile(intent.path || "", userMessage, context);
          break;
        case "fix_file":
          await this.fixExistingFile(intent.path || "", userMessage, context);
          break;
        case "install":
          await this.runInstall(intent.packages || []);
          break;
        case "build_full":
          await this.buildFull(userMessage);
          break;
        case "explain":
        case "chat":
        default:
          await this.justChat(userMessage, context);
          break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[ZOZO CHAT] Error: ${msg}`);
      this.sendToWebview("response", `Ã¢ÂÅ’ Error: ${msg.substring(0, 300)}`);
      this.history.push({ role: "assistant", content: `Error: ${msg.substring(0, 200)}` });
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Intent Detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  async detectIntent(message: string, context: string): Promise<DetectedIntent> {
    const prompt = `Workspace files:\n${context.substring(0, 2000)}\n\nUser message: "${message}"\n\nOutput ONLY the JSON object:`;

    try {
      const raw = await streamFromLLM(prompt, this.provider, this.apiKey, INTENT_SYSTEM_PROMPT);

      // Extract JSON from response
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const start = jsonStr.indexOf("{");
      const end = jsonStr.lastIndexOf("}");
      if (start !== -1 && end !== -1) jsonStr = jsonStr.substring(start, end + 1);

      const parsed = JSON.parse(jsonStr) as DetectedIntent;
      parsed.type = parsed.type || "chat";
      return parsed;
    } catch {
      // Fallback: simple keyword detection
      const lower = message.toLowerCase();
      if (lower.includes("create") || lower.includes("generate") || lower.includes("add file") || lower.includes("write")) {
        return { type: "generate_file", path: this.guessFilePath(message), reasoning: "keyword match" };
      }
      if (lower.includes("fix") || lower.includes("debug") || lower.includes("update") || lower.includes("change")) {
        return { type: "fix_file", path: this.guessFilePath(message), reasoning: "keyword match" };
      }
      if (lower.includes("install") || lower.includes("npm") || lower.includes("add package")) {
        return { type: "install", packages: this.guessPackages(message), reasoning: "keyword match" };
      }
      if (lower.includes("build") && (lower.includes("app") || lower.includes("website") || lower.includes("project"))) {
        return { type: "build_full", reasoning: "keyword match" };
      }
      if (lower.includes("explain") || lower.includes("what is") || lower.includes("how does")) {
        return { type: "explain", reasoning: "keyword match" };
      }
      return { type: "chat", reasoning: "default fallback" };
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Actions Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  async generateSingleFile(filePath: string, instruction: string, context: string): Promise<void> {
    if (!filePath) {
      this.sendToWebview("response", "Ã¢Ââ€œ What file should I generate? Give me the path like `components/Navbar.tsx`");
      return;
    }

    this.sendToWebview("status", `Ã°Å¸â€Â¨ Generating ${filePath}...`);

    const prompt = `Workspace context:\n${context.substring(0, 4000)}\n\nGenerate file: ${filePath}\nUser instruction: ${instruction}`;
    const code = await streamFromLLM(prompt, this.provider, this.apiKey, GENERATE_SYSTEM_PROMPT);

    // Strip markdown fences if present
    const cleanCode = code.replace(/^```[\w]*\s*\n?|\n?```\s*$/g, "").trim();

    const fullPath = path.join(this.workspaceRoot, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, cleanCode, "utf8");

    const response = `Ã¢Å“â€¦ Generated: \`${filePath}\`\n\nFile written with ${cleanCode.split("\n").length} lines.`;
    this.sendToWebview("response", response);
    this.history.push({ role: "assistant", content: `Generated ${filePath}` });
    this.outputChannel.appendLine(`[ZOZO CHAT] Generated: ${filePath}`);

    // Open the file in editor
    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  }

  async fixExistingFile(filePath: string, instruction: string, context: string): Promise<void> {
    if (!filePath) {
      this.sendToWebview("response", "Ã¢Ââ€œ Which file should I fix? Give me the path.");
      return;
    }

    const fullPath = path.join(this.workspaceRoot, filePath);
    if (!fs.existsSync(fullPath)) {
      this.sendToWebview("response", `Ã¢ÂÅ’ File not found: \`${filePath}\`. Did you mean to generate it?`);
      return;
    }

    this.sendToWebview("status", `Ã°Å¸â€Â§ Fixing ${filePath}...`);

    const existingCode = fs.readFileSync(fullPath, "utf8");
    const prompt = `File: ${filePath}\nCurrent code:\n\`\`\`\n${existingCode.substring(0, 6000)}\n\`\`\`\n\nUser instruction: ${instruction}\n\nWorkspace context:\n${context.substring(0, 2000)}`;
    const fixedCode = await streamFromLLM(prompt, this.provider, this.apiKey, FIX_SYSTEM_PROMPT);

    const cleanCode = fixedCode.replace(/^```[\w]*\s*\n?|\n?```\s*$/g, "").trim();
    fs.writeFileSync(fullPath, cleanCode, "utf8");

    const response = `Ã¢Å“â€¦ Fixed: \`${filePath}\`\n\nUpdated with ${cleanCode.split("\n").length} lines.`;
    this.sendToWebview("response", response);
    this.history.push({ role: "assistant", content: `Fixed ${filePath}` });
    this.outputChannel.appendLine(`[ZOZO CHAT] Fixed: ${filePath}`);

    // Refresh in editor
    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  }

  async justChat(message: string, context: string): Promise<void> {
    const conversationSnippet = this.history.slice(-6).map(
      (m) => `${m.role}: ${m.content.substring(0, 200)}`
    ).join("\n");

    const prompt = `Conversation:\n${conversationSnippet}\n\nWorkspace:\n${context.substring(0, 3000)}\n\nUser: ${message}`;
    const response = await streamFromLLM(prompt, this.provider, this.apiKey, CHAT_SYSTEM_PROMPT);

    this.history.push({ role: "assistant", content: response });
    this.sendToWebview("response", response);
    this.outputChannel.appendLine(`[ZOZO CHAT] Response sent (${response.length} chars)`);
  }

  async runInstall(packages: string[]): Promise<void> {
    if (packages.length === 0) {
      this.sendToWebview("response", "Ã¢Ââ€œ What packages should I install?");
      return;
    }

    const cmd = `npm install ${packages.join(" ")} --legacy-peer-deps`;
    this.sendToWebview("status", `Ã°Å¸â€œÂ¦ Running: \`${cmd}\``);

    try {
      const output = execSync(cmd, {
        cwd: this.workspaceRoot,
        stdio: "pipe",
        maxBuffer: 1024 * 1024 * 10,
        encoding: "utf-8",
        timeout: 120000,
      });
      this.sendToWebview("response", `Ã¢Å“â€¦ Installed: ${packages.join(", ")}\n\n\`\`\`\n${(output || "").substring(0, 500)}\n\`\`\``);
      this.history.push({ role: "assistant", content: `Installed ${packages.join(", ")}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendToWebview("response", `Ã¢ÂÅ’ Install failed: ${msg.substring(0, 300)}`);
    }
  }

  async buildFull(userMessage: string): Promise<void> {
    this.sendToWebview("status", "Ã°Å¸Å¡â‚¬ Starting full build orchestration...");
    this.sendToWebview("response", "Ã°Å¸Â§Â  Starting ZOZO multi-agent pipeline. Watch the **ZOZO Builder** output channel for details.\n\nThis may take 1-3 minutes depending on project size.");

    try {
      await runOrchestration(
        userMessage,
        this.provider,
        this.apiKey,
        this.workspaceRoot,
        this.outputChannel
      );
      this.sendToWebview("response", "Ã¢Å“â€¦ Full build complete! Check `localhost:3000`.");
      this.history.push({ role: "assistant", content: "Full build completed successfully." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendToWebview("response", `Ã¢ÂÅ’ Build failed: ${msg.substring(0, 300)}`);
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Workspace Scanner Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  scanWorkspace(): string {
    const files: Array<{ filePath: string; content: string }> = [];

    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (INCLUDED_EXTENSIONS.has(ext)) {
            const fullPath = path.join(dir, entry.name);
            try {
              const content = fs.readFileSync(fullPath, "utf-8");
              const relPath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, "/");
              files.push({ filePath: relPath, content });
            } catch { /* skip */ }
          }
        }
      }
    };

    walk(this.workspaceRoot);

    let contextXml = "<files>\n";
    let totalChars = contextXml.length;

    for (const { filePath, content } of files) {
      const block = `<file path="${filePath}">\n${content}\n</file>\n`;
      if (totalChars + block.length > MAX_CONTEXT_CHARS) break;
      contextXml += block;
      totalChars += block.length;
    }

    contextXml += "</files>";
    return contextXml;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Utilities Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  guessFilePath(message: string): string {
    // Try to find a file path in the message
    const pathMatch = message.match(/(?:^|\s)([\w\-/]+\.(?:tsx?|jsx?|css|json|html|md))(?:\s|$)/i);
    if (pathMatch) return pathMatch[1];
    // Try to find component name
    const compMatch = message.match(/(?:component|file|page)\s+(?:called\s+|named\s+)?['"]?(\w+)['"]?/i);
    if (compMatch) return `components/${compMatch[1]}.tsx`;
    return "";
  }

  guessPackages(message: string): string[] {
    const pkgMatch = message.match(/install\s+([\w\s@\-/]+)/i);
    if (pkgMatch) {
      return pkgMatch[1].trim().split(/\s+/).filter(
        (p) => p.length > 1 && !["and", "or", "the", "a", "with"].includes(p.toLowerCase())
      );
    }
    return [];
  }

  sendToWebview(type: string, text: string): void {
    this.panel.webview.postMessage({ type, text });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Chat UI Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  getChatHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0a0a0f;
    --surface:  #111118;
    --border:   rgba(255,255,255,0.06);
    --accent:   #7c3aed;
    --text:     #e4e4e7;
    --muted:    #71717a;
    --success:  #4ec9b0;
    --warn:     #dcdcaa;
    --error:    #f48771;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
    font-size: 13px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* \\u2500\\u2500 TOP BAR \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500 */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }
  .topbar-left { display: flex; align-items: center; gap: 8px; }
  .logo {
    font-size: 12px; font-weight: 700; letter-spacing: .06em; color: var(--accent);
  }
  .mode-toggle {
    display: flex; background: var(--bg); border: 1px solid var(--border);
    border-radius: 6px; overflow: hidden;
  }
  .mode-btn {
    padding: 3px 12px; font-size: 11px; cursor: pointer; border: none;
    background: transparent; color: var(--muted); transition: all .15s;
  }
  .mode-btn.active { background: var(--accent); color: #fff; }
  #btn-max.active {
    background: linear-gradient(90deg, #dc2626, #ea580c);
    color: #fff;
  }
  #btn-ultra.active {
    background: var(--accent);
    color: #fff;
  }
  .model-chip {
    font-size: 10px; padding: 2px 8px;
    background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
    border-radius: 10px; color: #a78bfa; cursor: pointer;
  }

  /* \\u2500\\u2500 MAIN LAYOUT \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500 */
  .main { display: flex; flex: 1; overflow: hidden; }

  /* \\u2500\\u2500 PIPELINE SIDEBAR \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500 */
  .pipeline-sidebar {
    width: 180px; border-right: 1px solid var(--border);
    display: flex; flex-direction: column; flex-shrink: 0;
    overflow-y: auto; padding: 10px 8px; gap: 2px;
  }
  .sidebar-label {
    font-size: 9px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); padding: 4px 4px 8px;
  }
  .step-item {
    display: flex; align-items: center; gap: 6px; padding: 5px 6px;
    border-radius: 6px; font-size: 11px; color: var(--muted); transition: background .15s;
  }
  .step-item.active { background: rgba(124,58,237,0.12); color: var(--text); }
  .step-item.done { color: var(--success); }
  .step-item.failed { color: var(--error); }
  .step-dot {
    width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0;
  }
  .step-dot.spinning { animation: spin .8s linear infinite; }

  /* \\u2500\\u2500 CHAT AREA \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500 */
  .chat-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .messages {
    flex: 1; overflow-y: auto; padding: 16px 12px;
    display: flex; flex-direction: column; gap: 12px;
  }

  /* Welcome */
  .welcome { padding: 24px 16px; max-width: 400px; margin: auto; text-align: center; }
  .welcome-icon { font-size: 32px; margin-bottom: 12px; }
  .welcome h2 { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
  .welcome p { font-size: 12px; color: var(--muted); line-height: 1.6; margin-bottom: 16px; }
  .examples { display: flex; flex-direction: column; gap: 6px; text-align: left; }
  .example {
    padding: 8px 12px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; font-size: 12px; cursor: pointer; transition: border-color .15s;
  }
  .example:hover { border-color: var(--accent); }
  .build-tags {
    display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
    margin-top: 14px; font-size: 10px; color: var(--muted);
  }

  /* Messages */
  .msg { display: flex; flex-direction: column; gap: 3px; }
  .msg.user { align-items: flex-end; }
  .msg.system { align-items: flex-start; }
  .bubble {
    max-width: 85%; padding: 8px 12px; border-radius: 12px;
    font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word;
  }
  .msg.user .bubble {
    background: var(--accent); color: #fff; border-bottom-right-radius: 3px;
  }
  .msg.system .bubble {
    background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 3px;
  }
  .msg-time { font-size: 10px; color: var(--muted); padding: 0 4px; }

  /* \\u2500\\u2500 PROGRESS \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500 */
  .progress-strip {
    display: none; padding: 8px 12px;
    border-top: 1px solid var(--border); background: var(--surface);
  }
  .progress-strip.visible { display: block; }
  .progress-header {
    display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
  }
  .progress-step-name { font-size: 11px; font-weight: 500; }
  .progress-badges { display: flex; gap: 6px; align-items: center; }
  .mode-badge {
    font-size: 9px; padding: 1px 7px; border-radius: 8px;
    background: rgba(124,58,237,0.15); border: 1px solid rgba(124,58,237,0.3); color: #a78bfa;
  }
  .cancel-btn {
    font-size: 10px; padding: 2px 8px; background: transparent;
    border: 1px solid var(--border); color: var(--muted);
    border-radius: 4px; cursor: pointer;
  }
  .cancel-btn:hover { border-color: var(--error); color: var(--error); }
  .bar-track { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .bar-fill {
    height: 100%; background: var(--accent); border-radius: 2px;
    width: 0%; transition: width .4s ease;
  }
  .quality-live { font-size: 10px; color: var(--muted); margin-top: 4px; display: none; }
  .stream-strip {
    font-size: 10px; color: var(--muted); font-family: monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-height: 16px; margin-top: 4px; opacity: .6;
  }

  /* \\u2500\\u2500 PROFILE BAR \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500 */
  .profile-bar {
    display: none; flex-wrap: wrap; gap: 6px; padding: 6px 12px;
    border-top: 1px solid var(--border); font-size: 10px;
  }
  .profile-bar.visible { display: flex; }
  .profile-chip {
    padding: 2px 7px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; color: var(--muted);
  }

  /* \\u2500\\u2500 INPUT \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500 */
  .input-area {
    padding: 8px 12px; border-top: 1px solid var(--border);
    display: flex; gap: 6px; align-items: flex-end;
    background: var(--surface); flex-shrink: 0;
  }
  .input-box {
    flex: 1; background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 7px 10px; color: var(--text);
    font-size: 12px; resize: none; min-height: 36px; max-height: 120px;
    outline: none; font-family: inherit; line-height: 1.5;
  }
  .input-box:focus { border-color: var(--accent); }
  .send-btn {
    background: var(--accent); border: none; color: #fff;
    border-radius: 7px; width: 32px; height: 32px; cursor: pointer;
    font-size: 14px; display: flex; align-items: center;
    justify-content: center; flex-shrink: 0;
  }
  .send-btn:hover { opacity: .85; }
  .send-btn:disabled { opacity: .4; cursor: not-allowed; }

  @keyframes spin { to { transform: rotate(360deg); } }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
</style>
</head>
<body>

<!-- TOP BAR -->
<div class="topbar">
  <div class="topbar-left">
    <span class="logo">\\u26A1 ZOZO</span>
    <div class="mode-toggle">
      <button class="mode-btn active" id="btn-normal" onclick="setMode('normal')" title="gemini-2.5-flash · 1500 req/day free · Fast">Normal</button>
      <button class="mode-btn" id="btn-ultra" onclick="setMode('ultra')" title="gemini-3.1-pro · Paid · ~$0.10-0.60/build">Ultra</button>
      <button class="mode-btn" id="btn-max" onclick="setMode('max')" title="gemini-3.1-pro ALL steps · Paid · ~$0.50-3.00/build">Max \uD83D\uDD25</button>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;">
    <span class="model-chip" id="model-chip" onclick="openSettings()">flash-2.5</span>
    <span id="cost-hint" style="display:none;font-size:10px;color:var(--warn);"></span>
  </div>
</div>

<!-- MAIN LAYOUT -->
<div class="main">

  <!-- PIPELINE SIDEBAR -->
  <div class="pipeline-sidebar">
    <div class="sidebar-label">Pipeline</div>
    <div id="step-list">
      <div class="step-item" id="step-supervisor"><div class="step-dot"></div>Supervisor</div>
      <div class="step-item" id="step-workspace"><div class="step-dot"></div>Workspace scan</div>
      <div class="step-item" id="step-plan"><div class="step-dot"></div>Planner</div>
      <div class="step-item" id="step-design"><div class="step-dot"></div>Design</div>
      <div class="step-item" id="step-resources"><div class="step-dot"></div>Resources</div>
      <div class="step-item" id="step-build"><div class="step-dot"></div>Builder</div>
      <div class="step-item" id="step-validate"><div class="step-dot"></div>Validate</div>
      <div class="step-item" id="step-security"><div class="step-dot"></div>Security</div>
      <div class="step-item" id="step-seo"><div class="step-dot"></div>SEO</div>
      <div class="step-item" id="step-perf"><div class="step-dot"></div>Performance</div>
      <div class="step-item" id="step-deps"><div class="step-dot"></div>Install deps</div>
      <div class="step-item" id="step-tsc"><div class="step-dot"></div>TypeScript</div>
      <div class="step-item" id="step-runtime"><div class="step-dot"></div>Runtime check</div>
      <div class="step-item" id="step-quality"><div class="step-dot"></div>Quality gate</div>
      <div class="step-item" id="step-deploy"><div class="step-dot"></div>Deploy</div>
    </div>
  </div>

  <!-- CHAT AREA -->
  <div class="chat-area">
    <div class="messages" id="messages">
      <div class="welcome" id="welcome">
        <div class="welcome-icon">\\u26A1</div>
        <h2>ZOZO \\u2014 Full-Stack AI Engineer</h2>
        <p>Type what to build. ZOZO asks your preferences,<br>then generates a working app.</p>
        <div class="examples">
          <div class="example" onclick="useExample(this)">build a dark SaaS landing page with pricing</div>
          <div class="example" onclick="useExample(this)">build a web3 NFT marketplace with wallet connect</div>
          <div class="example" onclick="useExample(this)">build an AI chat app with Supabase auth</div>
          <div class="example" onclick="useExample(this)">make the hero button purple</div>
        </div>
        <div class="build-tags">
          <span>\\u26A1 Express: ~2 min</span>
          <span>\\uD83D\\uDD0D Auto TypeScript fix</span>
          <span>\\uD83D\\uDE80 Auto deploy</span>
          <span>\\uD83E\\uDDE0 Learns your style</span>
        </div>
      </div>
    </div>

    <!-- Profile bar -->
    <div class="profile-bar" id="profile-bar"></div>

    <!-- Progress strip -->
    <div class="progress-strip" id="progress-strip">
      <div class="progress-header">
        <span class="progress-step-name" id="progress-step-name">Starting...</span>
        <div class="progress-badges">
          <span class="mode-badge" id="mode-badge" style="display:none"></span>
          <button class="cancel-btn" onclick="cancelBuild()">Cancel</button>
        </div>
      </div>
      <div class="bar-track"><div class="bar-fill" id="bar-fill"></div></div>
      <div class="quality-live" id="quality-live"></div>
      <div class="stream-strip" id="stream-strip"></div>
    </div>

    <!-- Input -->
    <div class="input-area">
      <textarea class="input-box" id="input" placeholder="Describe what to build..." rows="1"
        onkeydown="handleKey(event)"
        oninput="autoResize(this)"></textarea>
      <button class="send-btn" id="send-btn" onclick="send()">\\u2191</button>
    </div>
  </div>
</div>

<script>
var vscode = acquireVsCodeApi();
var currentMode = 'normal';
var currentStep = 0;
var TOTAL_STEPS = 15;

// Mode toggle
function setMode(mode) {
  currentMode = mode;
  document.getElementById('btn-normal').classList.toggle('active', mode === 'normal');
  document.getElementById('btn-ultra').classList.toggle('active', mode === 'ultra');
  document.getElementById('btn-max').classList.toggle('active', mode === 'max');

  // Update model chip based on mode
  var modelNames = {
    normal: 'flash-2.5',
    ultra:  '3.1-pro',
    max:    '3.1-pro \uD83D\uDD25',
  };
  document.getElementById('model-chip').textContent = modelNames[mode] || 'flash-2.5';

  // Show cost hint for high modes
  var costEl = document.getElementById('cost-hint');
  if (mode === 'max') {
    costEl.textContent = '\u26A0\uFE0F Est. $0.50\u2013$3.00 per build';
    costEl.style.color = '#f87171';
    costEl.style.display = 'block';
  } else if (mode === 'ultra') {
    costEl.textContent = 'Est. $0.10\u2013$0.60 per build';
    costEl.style.color = '#dcdcaa';
    costEl.style.display = 'block';
  } else {
    costEl.textContent = '1500 req/day free';
    costEl.style.color = '#4ec9b0';
    costEl.style.display = 'block';
  }

  vscode.postMessage({ command: 'setMode', mode: mode });
}

// Input
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
}
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
function send() {
  var input = document.getElementById('input');
  var text = input.value.trim();
  if (!text) return;
  addMessage('user', text);
  input.value = '';
  input.style.height = 'auto';
  var wel = document.getElementById('welcome');
  if (wel) wel.remove();
  vscode.postMessage({ command: 'sendMessage', text: text, mode: currentMode });
}
function useExample(el) {
  document.getElementById('input').value = el.textContent.trim();
  document.getElementById('input').focus();
}
function openSettings() { vscode.postMessage({ command: 'openSettings' }); }
function cancelBuild() { vscode.postMessage({ command: 'cancelBuild' }); }

// Messages
function addMessage(role, text) {
  var msgs = document.getElementById('messages');
  var div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = '<div class="bubble">' + escHtml(text) + '</div>' +
    '<span class="msg-time">' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '</span>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}
function escHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Profile display
function showProfile(profile) {
  var bar = document.getElementById('profile-bar');
  bar.innerHTML = [
    '<span class="profile-chip">\\u2699 ' + profile.complexity + '</span>',
    '<span class="profile-chip">\\uD83C\\uDFA8 ' + profile.uiStyle + '</span>',
    '<span class="profile-chip">\\u2728 ' + profile.animation + ' anim</span>',
    '<span class="profile-chip">\\uD83C\\uDF10 ' + profile.visualDepth + '</span>',
    (profile.inspiration || []).map(function(i) { return '<span class="profile-chip">' + i + '</span>'; }).join(''),
  ].join('');
  bar.classList.add('visible');
  document.getElementById('model-chip').textContent = (profile.selectedModel || '').split('-').slice(0,3).join('-');
}

// Pipeline steps
var STEP_MAP = {
  'supervisor':     'step-supervisor',
  'workspace':      'step-workspace',
  'workspace_scan': 'step-workspace',
  'plan':           'step-plan',
  'design':         'step-design',
  'resource':       'step-resources',
  'resource-fetch': 'step-resources',
  'build':          'step-build',
  'validate':       'step-validate',
  'security':       'step-security',
  'seo':            'step-seo',
  'performance':    'step-perf',
  'deps':           'step-deps',
  'ts_verify':      'step-tsc',
  'runtime':        'step-runtime',
  'runtime-check':  'step-runtime',
  'quality':        'step-quality',
  'deploy':         'step-deploy'
};
function setStepActive(name) {
  var id = STEP_MAP[name];
  if (!id && name) {
    var keys = Object.keys(STEP_MAP);
    for (var i = 0; i < keys.length; i++) {
      if (name.indexOf(keys[i]) >= 0) { id = STEP_MAP[keys[i]]; break; }
    }
  }
  if (!id) return;
  var items = document.querySelectorAll('.step-item');
  for (var j = 0; j < items.length; j++) items[j].classList.remove('active');
  var el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
    var dot = el.querySelector('.step-dot');
    if (dot) dot.classList.add('spinning');
  }
}
function setStepDone(name) {
  var id = STEP_MAP[name];
  if (!id) return;
  var el = document.getElementById(id);
  if (el) {
    el.classList.remove('active');
    el.classList.add('done');
    var dot = el.querySelector('.step-dot');
    if (dot) dot.classList.remove('spinning');
  }
}

// Progress
function showProgress() { document.getElementById('progress-strip').classList.add('visible'); }
function hideProgress() {
  document.getElementById('progress-strip').classList.remove('visible');
  document.getElementById('quality-live').style.display = 'none';
  document.getElementById('stream-strip').textContent = '';
  document.getElementById('mode-badge').style.display = 'none';
  document.getElementById('bar-fill').style.width = '0%';
  currentStep = 0;
  var items = document.querySelectorAll('.step-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove('active','done','failed');
    var dot = items[i].querySelector('.step-dot');
    if (dot) dot.classList.remove('spinning');
  }
}
function updateBar(pct) {
  document.getElementById('bar-fill').style.width = pct + '%';
}

// Events from extension
window.addEventListener('message', function(event) {
  var msg = event.data;

  // Profile capture result
  if (msg.type === 'profile_captured') {
    showProfile(msg.profile);
    addMessage('system', '\\u2699 Profile: ' + msg.profile.complexity + ' \\u00B7 ' +
      msg.profile.uiStyle + ' \\u00B7 ' + msg.profile.animation + ' animation');
    return;
  }

  // Chat responses
  if (msg.type === 'response') {
    addMessage('system', msg.text || '');
    return;
  }
  if (msg.type === 'status') {
    addMessage('system', msg.text || '');
    return;
  }

  if (msg.type !== 'pipeline_event') return;
  var e = msg.event;
  if (!e) return;

  switch (e.type) {
    case 'session_start':
      showProgress();
      updateBar(5);
      document.getElementById('progress-step-name').textContent = 'Starting...';
      break;

    case 'step_start':
      if (e.stepNumber === 0) {
        var badge = document.getElementById('mode-badge');
        badge.textContent = e.stepName || '';
        badge.style.display = 'inline';
      } else {
        document.getElementById('progress-step-name').textContent = e.stepName || '...';
        setStepActive(e.stepName || '');
      }
      break;

    case 'step_complete':
      currentStep = e.stepNumber || currentStep + 1;
      updateBar(Math.min(95, Math.round((currentStep / TOTAL_STEPS) * 90) + 5));
      setStepDone(e.stepName || '');
      break;

    case 'llm_chunk': {
      var strip = document.getElementById('stream-strip');
      var buf = (strip.dataset.buf || '') + (e.chunk || '');
      strip.dataset.buf = buf;
      strip.textContent = buf.length > 120 ? '\\u2026' + buf.slice(-120) : buf;
      break;
    }

    case 'quality_category':
      document.getElementById('quality-live').style.display = 'block';
      document.getElementById('quality-live').textContent = '\\uD83D\\uDD0D Checking ' + e.category + '...';
      break;

    case 'quality_complete':
      document.getElementById('quality-live').textContent =
        (e.qualityVerdict === 'WORLD_CLASS' ? '\\u2728' : e.qualityVerdict === 'ACCEPTABLE' ? '\\u2705' : '\\u26A0\\uFE0F') +
        ' Quality: ' + e.qualityVerdict + ' (' + e.qualityScore + '/100)';
      break;

    case 'build_complete':
      updateBar(100);
      document.getElementById('progress-step-name').textContent = '\\u2705 Done \\u2014 ' + (e.fileCount || 0) + ' files';
      setStepDone('deploy');
      addMessage('system', '\\u2705 Build complete \\u2014 ' + (e.fileCount || 0) + ' files. Run: npm run dev');
      setTimeout(hideProgress, 4000);
      var s = document.getElementById('stream-strip');
      s.dataset.buf = ''; s.textContent = '';
      break;

    case 'build_failed':
      document.getElementById('progress-step-name').textContent = '\\u274C Failed: ' + (e.error || 'unknown');
      addMessage('system', '\\u274C Build failed: ' + (e.error || 'unknown error'));
      setTimeout(hideProgress, 5000);
      break;

    case 'build_cancelled':
      document.getElementById('progress-step-name').textContent = '\\u23F9 Cancelled';
      addMessage('system', '\\u23F9 Build cancelled');
      setTimeout(hideProgress, 2000);
      break;

    case 'step_failed':
      if (e.error && e.error.indexOf('Rate limited') >= 0) {
        document.getElementById('progress-step-name').textContent = '\\u23F3 ' + e.error;
      }
      break;
  }
});
</script>
</body>
</html>`;
  }
}

