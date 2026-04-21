import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ZozoVault } from "./security/Vault";
import { executeZozoStream } from "./engine/AntigravityWriter";
import { runOrchestration } from "./engine/Orchestrator";
import { ZOZOChatPanel } from "./chat/ChatPanel";
import { WorkspaceGuard } from "./engine/WorkspaceGuard";
import { PipelineEventBus } from './engine/PipelineEventBus';
import { BuildProfileCapture } from './engine/BuildProfile';
import { ChatSidebarProvider } from './chat/ChatSidebarProvider';

const PROVIDERS = ["Gemini", "OpenAI", "Anthropic"] as const;

const FAKE_AI_RESPONSE = `
<zozo_action type="write" path="src/test/hello.ts">
export function greet(name: string): string {
  return \`Hello, \${name}! Welcome to the ZOZO Antigravity Engine.\`;
}

console.log(greet("World"));
</zozo_action>
<zozo_action type="write" path="src/test/math.ts">
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

console.log("2 + 3 =", add(2, 3));
console.log("4 * 5 =", multiply(4, 5));
</zozo_action>
`;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const vault = new ZozoVault(context);

  // Dispose WorkspaceGuard on deactivation
  const guard = WorkspaceGuard.getInstance();
  context.subscriptions.push({ dispose: () => guard.dispose() });

  // ── Set API Key ────────────────────────────────────────────────────────────
  const setApiKeyCmd = vscode.commands.registerCommand(
    "zozo.setApiKey",
    async () => {
      const provider = await vscode.window.showQuickPick([...PROVIDERS], {
        placeHolder: "Select the AI provider to configure",
        ignoreFocusOut: true,
      });
      if (!provider) return;

      const apiKey = await vscode.window.showInputBox({
        prompt: `Enter your ${provider} API Key`,
        placeHolder:
          provider === "Anthropic" ? "sk-ant-..." : provider === "OpenAI" ? "sk-..." : "AI...",
        password: true,
        ignoreFocusOut: true,
      });

      if (apiKey?.trim()) {
        await vault.storeKey(provider, apiKey.trim());
      } else {
        vscode.window.showWarningMessage("⚠️ ZOZO: No API key provided. Operation cancelled.");
      }
    }
  );

  // ── Test Core Loop (hardcoded) ─────────────────────────────────────────────
  const testCoreLoopCmd = vscode.commands.registerCommand(
    "zozo.testCoreLoop",
    async () => {
      vscode.window.showInformationMessage("🧠 ZOZO Core Loop: Initiating deterministic write stream...");
      try {
        await executeZozoStream(FAKE_AI_RESPONSE);
        vscode.window.showInformationMessage("🎯 ZOZO Core Loop: Test complete.");
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `❌ ZOZO Core Loop failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  // ── Prompt AI — Full Orchestration ────────────────────────────────────────
  const promptAICmd = vscode.commands.registerCommand(
    "zozo.promptAI",
    async (cmdArgs?: { prompt?: string; resumeSessionId?: string; resumeFromStep?: number }) => {
      // 1. User prompt (use cmdArgs if passed from resumeBuild, otherwise ask user)
      const userPrompt = cmdArgs?.prompt ?? await vscode.window.showInputBox({
        prompt: "What do you want to build? Be specific.",
        placeHolder: "e.g. A SaaS dashboard with auth, Stripe payments, and an analytics page",
        ignoreFocusOut: true,
      });
      if (!userPrompt?.trim()) {
        vscode.window.showWarningMessage("⚠️ ZOZO: No prompt provided. Operation cancelled.");
        return;
      }

      // Prevent concurrent pipeline runs
      const pipelineGuard = WorkspaceGuard.getInstance();
      const currentSession = cmdArgs?.resumeSessionId ?? ('session-' + Date.now());
      if (!pipelineGuard.acquire(currentSession, userPrompt.trim())) {
        const lockInfo = pipelineGuard.getLockInfo();
        const msg = lockInfo
          ? `ZOZO is already running: "${lockInfo.prompt.slice(0, 40)}..." (started ${new Date(lockInfo.startedAt).toLocaleTimeString()})`
          : 'ZOZO is already running. Wait for it to finish.';
        vscode.window.showWarningMessage(msg);
        return;
      }

      try {
        // 2. Provider selection
        const provider = await vscode.window.showQuickPick([...PROVIDERS], {
          placeHolder: "Select which AI to use",
          ignoreFocusOut: true,
        });
        if (!provider) return;

        // 3. API key retrieval
        const apiKey = await vault.getKey(provider);
        if (!apiKey) {
          vscode.window.showErrorMessage(
            `❌ ZOZO: No ${provider} API key found. Run "ZOZO: Set API Key" and select ${provider}.`
          );
          return;
        }

        // 4. Workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showErrorMessage("❌ ZOZO: No workspace folder open.");
          return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // ── EDIT MODE: intercept simple edits before full pipeline ────────
        const { EditAgent } = await import('./engine/EditAgent');
        const editAgent = new EditAgent();
        const prompt = userPrompt.trim();

        if (editAgent.isEditRequest(prompt)) {
          const editPlan = await editAgent.plan(prompt, workspaceRoot, provider, apiKey);

          if (!editPlan.isFullRebuild && editPlan.confidence >= 60) {
            vscode.window.showInformationMessage(
              `ZOZO Edit mode: ${editPlan.description}`
            );

            const editResult = await editAgent.execute(editPlan, prompt, workspaceRoot, provider, apiKey);

            if (editResult.success) {
              vscode.window.showInformationMessage(
                `✅ ZOZO edited: ${editResult.description}`
              );
              return;  // Done — no need to run full Orchestrator
            }
            // If edit failed, fall through to full build
            vscode.window.showInformationMessage('Edit mode failed — running full build instead');
          }
        }

        // 5. Output channel
        const outputChannel = vscode.window.createOutputChannel("ZOZO Builder");
        outputChannel.show(true);
        outputChannel.appendLine(`⚡ ZOZO Orchestrator started`);
        outputChannel.appendLine(`Provider: ${provider}`);
        outputChannel.appendLine(`Prompt: ${userPrompt.trim()}\n`);

        // 5.5 Build Profile capture — 5 structured questions
        const profileCapture = new BuildProfileCapture();
        let buildProfile = await profileCapture.capture(prompt, provider);

        if (!buildProfile) {
          outputChannel.appendLine('Build profile cancelled by user');
          return;
        }

        // Efficient mode needs a Gemini key for free agents (Planner + Design)
        let geminiKeyForEfficient: string | undefined;
        if (buildProfile.efficient && provider.toLowerCase() !== 'gemini') {
          geminiKeyForEfficient = await vault.getKey('Gemini');
          if (!geminiKeyForEfficient) {
            // Prompt for Gemini key
            const geminiInput = await vscode.window.showInputBox({
              prompt: 'Efficient mode needs a Gemini API key (free at aistudio.google.com/apikey)',
              password: true,
              placeHolder: 'AIza...',
              ignoreFocusOut: true,
            });
            if (geminiInput?.trim()) {
              await vault.storeKey('Gemini', geminiInput.trim());
              geminiKeyForEfficient = geminiInput.trim();
            } else {
              // No Gemini key → fall back to Quality mode
              buildProfile = { ...buildProfile, efficient: false };
              outputChannel.appendLine('[ZOZO] No Gemini key — falling back to Quality mode');
              outputChannel.appendLine('[ZOZO] Get free key at: https://aistudio.google.com/apikey');
              outputChannel.appendLine('[ZOZO] Then run: Ctrl+Shift+P → ZOZO: Set Gemini API Key');
            }
          }
        }

        // Cost warning for high-cost modes
        if (buildProfile.complexity === 'ultra' || buildProfile.complexity === 'max') {
          const estimatedCost = buildProfile.complexity === 'max'
            ? '$0.50 – $3.00'
            : '$0.10 – $0.60';

          const modelName = buildProfile.selectedModel;
          const warning = buildProfile.complexity === 'max'
            ? `🔥 MAX mode uses ${modelName} for ALL pipeline steps.\nEvery agent (Planner, Builder, Validator, Security, SEO, DevOps) uses the top model.\n\nEstimated cost per build: ${estimatedCost}\n\nThis uses your personal API key. Continue?`
            : `⚡ Ultra mode uses ${modelName}.\n\nEstimated cost per build: ${estimatedCost}\n\nContinue?`;

          const confirm = await vscode.window.showWarningMessage(
            warning,
            { modal: true },
            'Yes, continue',
            'Switch to Normal',
            'Cancel'
          );

          if (!confirm || confirm === 'Cancel') return;

          if (confirm === 'Switch to Normal') {
            buildProfile = {
              ...buildProfile,
              complexity: 'normal' as any,
              efficient: false,
              selectedModel: provider.toLowerCase() === 'anthropic' ? 'claude-sonnet-4-6'
                : provider.toLowerCase() === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini',
              pipelineMode: 'express',
            };
            vscode.window.showInformationMessage('ZOZO: Switched to Normal mode.');
          }
        }

        // Show what was selected in status bar
        vscode.window.setStatusBarMessage(
          `ZOZO: ${buildProfile.complexity.toUpperCase()} · ${buildProfile.uiStyle} · ${buildProfile.animation} animation · ${buildProfile.visualDepth}`,
          8000
        );
        outputChannel.appendLine(`Profile: ${buildProfile.complexity} | ${buildProfile.uiStyle} | ${buildProfile.animation} | ${buildProfile.visualDepth}`);
        outputChannel.appendLine(`Model: ${buildProfile.selectedModel}`);
        outputChannel.appendLine(`Design preset: ${buildProfile.designPreset}\n`);

        // 6. Run orchestration with progress notification
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "🧠 ZOZO is architecting your application...",
            cancellable: false,
          },
          async (progress) => {
            try {
              progress.report({ message: "Running multi-agent pipeline..." });
              await runOrchestration(
                userPrompt.trim(),
                provider,
                apiKey,
                workspaceRoot,
                outputChannel,
                {
                  resumeSessionId: cmdArgs?.resumeSessionId,
                  resumeFromStep: cmdArgs?.resumeFromStep ?? 0,
                  buildProfile,
                  geminiKey: geminiKeyForEfficient,
                }
              );
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              outputChannel.appendLine(`\n❌ FATAL: ${message}`);
              vscode.window.showErrorMessage(`❌ ZOZO failed: ${message}`);
            }
          }
        );
      } finally {
        PipelineEventBus.getInstance().reset();
        pipelineGuard.release(currentSession);
      }
    }
  );

  // ── Chat — Conversational AI Assistant ─────────────────────────────────────
  const chatCmd = vscode.commands.registerCommand(
    "zozo.chat",
    async () => {
      // 1. Provider selection
      const provider = await vscode.window.showQuickPick([...PROVIDERS], {
        placeHolder: "Select which AI to use for chat",
        ignoreFocusOut: true,
      });
      if (!provider) return;

      // 2. API key retrieval
      const apiKey = await vault.getKey(provider);
      if (!apiKey) {
        vscode.window.showErrorMessage(
          `❌ ZOZO: No ${provider} API key found. Run "ZOZO: Set API Key" first.`
        );
        return;
      }

      // 3. Workspace root
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("❌ ZOZO: No workspace folder open.");
        return;
      }
      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      // 4. Create output channel and chat panel
      const outputChannel = vscode.window.createOutputChannel("ZOZO Chat");
      new ZOZOChatPanel(workspaceRoot, provider, apiKey, outputChannel);
    }
  );

  // ── Show Cost & Token Usage ────────────────────────────────────────────────
  const showCostCmd = vscode.commands.registerCommand(
    "zozo.showCost",
    async () => {
      const { TokenTracker } = await import("./engine/TokenTracker");
      const { SessionState } = await import("./engine/SessionState");
      const tokenTracker = new TokenTracker();
      const sessionState = new SessionState();

      const allTimeCost = tokenTracker.getAllTimeCostUsd();
      const recentSessions = sessionState.listRecent(5);
      const recentStats = tokenTracker.getRecentSessions(5);

      const lines: string[] = [
        `💰 All-time estimated cost: $${allTimeCost.toFixed(2)}`,
        ``,
        `Recent sessions:`,
      ];

      for (const stats of recentStats) {
        const session = recentSessions.find(s => s.id === stats.sessionId);
        const prompt = session?.prompt?.slice(0, 50) ?? stats.sessionId.slice(0, 8);
        lines.push(`  ${prompt}… → $${stats.estimatedCostUsd.toFixed(4)} (${stats.callCount} calls)`);
      }

      if (recentStats.length === 0) {
        lines.push("  No sessions recorded yet. Run zozo.promptAI first.");
      }

      vscode.window.showInformationMessage(lines.join("\n"), { modal: true });
    }
  );

  // ── Resume Build ────────────────────────────────────────────────────────
  const resumeBuildCmd = vscode.commands.registerCommand(
    'zozo.resumeBuild',
    async () => {
      const { SessionState } = await import('./engine/SessionState');
      const sessionState = new SessionState();
      const recent = sessionState.listRecent(10);

      if (recent.length === 0) {
        vscode.window.showInformationMessage('ZOZO: No past sessions found.');
        return;
      }

      const items = recent.map(s => {
        const lastStep = s.steps[s.steps.length - 1];
        const stepLabel = lastStep ? `→ ${lastStep.stepName}` : 'no steps recorded';
        const date = new Date(s.startedAt).toLocaleString();
        return {
          label: s.prompt.slice(0, 60),
          description: `${s.status} ${stepLabel} — ${date}`,
          detail: `Session ${s.id} | Provider: ${s.provider}`,
          sessionId: s.id,
          prompt: s.prompt,
          provider: s.provider,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a session to resume from last completed step',
        matchOnDescription: true,
      });

      if (!picked) return;

      const session = sessionState.load(picked.sessionId);
      if (!session) {
        vscode.window.showErrorMessage('ZOZO: Session data not found.');
        return;
      }

      const lastCompletedStep = sessionState.getLastCompletedStep(picked.sessionId);
      vscode.window.showInformationMessage(
        `ZOZO: Resuming from step ${lastCompletedStep + 1} — "${picked.prompt.slice(0, 40)}..."`
      );

      // Re-run the prompt with resume context
      await vscode.commands.executeCommand('zozo.promptAI', {
        prompt: picked.prompt,
        resumeSessionId: picked.sessionId,
        resumeFromStep: lastCompletedStep + 1,
      });
    }
  );

  // ── Force Unlock Pipeline ───────────────────────────────────────────────
  const forceUnlockCmd = vscode.commands.registerCommand(
    'zozo.forceUnlock',
    async () => {
      const { WorkspaceGuard } = await import('./engine/WorkspaceGuard');
      WorkspaceGuard.getInstance().forceUnlock();
    }
  );

  // ── Inspect Build (with session history picker) ────────────────────────
  const inspectBuildCmd = vscode.commands.registerCommand(
    'zozo.inspectBuild',
    async () => {
      const { SessionState } = await import('./engine/SessionState');
      const { TokenTracker } = await import('./engine/TokenTracker');
      const { SupervisorMemory } = await import('./engine/SupervisorMemory');

      const sessionState = new SessionState();
      const tokenTracker = new TokenTracker();
      const supervisorMemory = new SupervisorMemory();
      const memStats = supervisorMemory.getStats();
      const allRecent = sessionState.listRecent(10);

      if (allRecent.length === 0) {
        vscode.window.showInformationMessage('ZOZO: No builds found yet. Run zozo.promptAI first.');
        return;
      }

      // If only one session, skip the picker
      let lastSession = allRecent[0]!;

      if (allRecent.length > 1) {
        const items = allRecent.map((s, i) => {
          const buildStep = s.steps.find(st => st.stepName === 'build');
          const score = buildStep?.metrics?.qualityScore ?? '?';
          const verdict = buildStep?.metrics?.qualityVerdict ?? '';
          const date = new Date(s.startedAt).toLocaleString();
          return {
            label: `${i === 0 ? '$(star) ' : ''}${s.prompt.slice(0, 55)}`,
            description: `${verdict} ${score}/100 — ${date}`,
            detail: `Session ${s.id} | ${s.template || 'auto'} | ${s.status}`,
            session: s,
          };
        });

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a build to inspect (most recent first)',
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (!picked) return;
        lastSession = picked.session;
      }

      const selectedSessionId = lastSession.id;
      const stats = tokenTracker.getSessionTotal(lastSession.id);

      // Get quality metrics from the build step structured metrics
      const buildStep = lastSession.steps.find(s => s.stepName === 'build');
      const qualityScore  = buildStep?.metrics?.qualityScore  ?? 'N/A';
      const qualityVerdict = buildStep?.metrics?.qualityVerdict ?? 'N/A';
      const retryCount    = buildStep?.metrics?.retryCount    ?? 0;
      const codeScore     = buildStep?.metrics?.codeScore     ?? 'N/A';
      const designScore   = buildStep?.metrics?.designScore   ?? 'N/A';

      const panel = vscode.window.createWebviewPanel(
        'zozoBuildInspector',
        'ZOZO Build Inspector',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      const stepsHtml = lastSession.steps.map(s => {
        const duration = s.durationMs
          ? s.durationMs >= 60_000
            ? `${Math.round(s.durationMs / 60_000)}m ${Math.round((s.durationMs % 60_000) / 1000)}s`
            : `${Math.round(s.durationMs / 1000)}s`
          : '—';
        return `
          <tr>
            <td>${s.stepNumber}</td>
            <td>${s.stepName}</td>
            <td class="${s.status}">${s.status}</td>
            <td>${s.outputSummary}</td>
            <td>${new Date(s.completedAt).toLocaleTimeString()}</td>
            <td>${duration}</td>
          </tr>
        `;
      }).join('');

      // Calculate total duration from steps
      const totalMs = lastSession.steps
        .filter(s => s.durationMs)
        .reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

      const totalTime = totalMs >= 60_000
        ? `${Math.round(totalMs / 60_000)}m ${Math.round((totalMs % 60_000) / 1000)}s`
        : `${Math.round(totalMs / 1000)}s`;

      panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; }
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; margin: 0; }
  h2 { font-size: 14px; font-weight: 500; margin: 20px 0 8px; color: var(--vscode-descriptionForeground); }
  .verdict { font-size: 24px; font-weight: 700; margin: 8px 0; }
  .WORLD_CLASS { color: #4ec9b0; }
  .ACCEPTABLE  { color: #dcdcaa; }
  .NEEDS_WORK  { color: #f48771; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 12px 0; }
  .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; }
  .card-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .card-value { font-size: 22px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 500; }
  td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .complete { color: #4ec9b0; }
  .failed   { color: #f48771; }
  .prompt   { font-size: 13px; color: var(--vscode-descriptionForeground); margin: 4px 0 16px; font-style: italic; }
</style>
</head>
<body>

<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
  <h1 style="margin:0;">ZOZO Build Inspector</h1>
  <button id="refresh-btn" onclick="refresh()"
    style="padding:4px 12px;font-size:12px;cursor:pointer;
           background:var(--vscode-button-background);
           color:var(--vscode-button-foreground);
           border:none;border-radius:4px;">
    ↻ Refresh
  </button>
</div>
<div class="prompt" id="prompt-text">"${lastSession.prompt.replace(/"/g, '&quot;').slice(0, 100)}"</div>

<div class="verdict ${qualityVerdict}" id="verdict">${qualityVerdict} \u2014 ${qualityScore}/100</div>

<div class="grid">
  <div class="card">
    <div class="card-label">Code score</div>
    <div class="card-value" id="code-score">${codeScore}/100</div>
  </div>
  <div class="card">
    <div class="card-label">Design score</div>
    <div class="card-value" id="design-score">${designScore}/100</div>
  </div>
  <div class="card">
    <div class="card-label">Retries needed</div>
    <div class="card-value" id="retry-count">${retryCount}</div>
  </div>
  <div class="card">
    <div class="card-label">Est. cost</div>
    <div class="card-value" id="cost">$${stats.estimatedCostUsd.toFixed(4)}</div>
  </div>
  <div class="card">
    <div class="card-label">Input tokens</div>
    <div class="card-value" id="input-tokens">${stats.totalInputTokens.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card-label">Cache reads</div>
    <div class="card-value" id="cache-reads">${stats.totalCacheReadTokens.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card-label">Total build time</div>
    <div class="card-value" id="total-time">${totalTime}</div>
  </div>
</div>

<h2>Pipeline steps</h2>
<table>
  <thead><tr><th>#</th><th>Step</th><th>Status</th><th>Summary</th><th>Time</th><th>Duration</th></tr></thead>
  <tbody id="steps-body">${stepsHtml}</tbody>
</table>

<h2>Session</h2>
<table>
  <tbody>
    <tr><td>ID</td><td>${lastSession.id}</td></tr>
    <tr><td>Template</td><td>${lastSession.template || 'auto-detected'}</td></tr>
    <tr><td>Provider</td><td>${lastSession.provider}</td></tr>
    <tr><td>Status</td><td class="${lastSession.status}">${lastSession.status}</td></tr>
    <tr><td>Started</td><td>${new Date(lastSession.startedAt).toLocaleString()}</td></tr>
  </tbody>
</table>

<script>
const vscode = acquireVsCodeApi();

function refresh() {
  document.getElementById('refresh-btn').textContent = '↻ Refreshing...';
  vscode.postMessage({ command: 'refresh' });
}

window.addEventListener('message', event => {
  const { command, data } = event.data;
  if (command !== 'updateData') return;

  document.getElementById('code-score').textContent     = data.codeScore + '/100';
  document.getElementById('design-score').textContent   = data.designScore + '/100';
  document.getElementById('retry-count').textContent    = data.retryCount;
  document.getElementById('cost').textContent           = '$' + data.estimatedCost;
  document.getElementById('input-tokens').textContent   = data.inputTokens;
  document.getElementById('cache-reads').textContent    = data.cacheReads;
  document.getElementById('prompt-text').textContent    = '"' + data.prompt + '"';

  const verdictEl = document.getElementById('verdict');
  verdictEl.textContent   = data.qualityVerdict + ' \\u2014 ' + data.qualityScore + '/100';
  verdictEl.className     = 'verdict ' + data.qualityVerdict;

  const tbody = document.getElementById('steps-body');
  tbody.innerHTML = data.steps.map(s =>
    '<tr>' +
      '<td>' + s.num + '</td>' +
      '<td>' + s.name + '</td>' +
      '<td class="' + s.status + '">' + s.status + '</td>' +
      '<td>' + s.summary + '</td>' +
      '<td>' + s.time + '</td>' +
      '<td>' + s.duration + '</td>' +
    '</tr>'
  ).join('');

  document.getElementById('refresh-btn').textContent = '↻ Refresh';
});
</script>

${memStats.totalDecisions > 0 ? `
<h2>Supervisor Intelligence</h2>
<table>
  <tbody>
    <tr>
      <td>Total decisions</td>
      <td>${memStats.totalDecisions}</td>
    </tr>
    <tr>
      <td>Correct rate</td>
      <td>${memStats.correctRate}%
        <span style="font-size:10px;color:${memStats.correctRate >= 70 ? '#4ec9b0' : '#f48771'};">
          ${memStats.correctRate >= 70 ? '\u2713 learning well' : '\u26A0 needs more data'}
        </span>
      </td>
    </tr>
    <tr>
      <td>Avg score \u2014 express</td>
      <td>${memStats.avgScoreByMode.express > 0 ? memStats.avgScoreByMode.express + '/100' : '\u2014'}</td>
    </tr>
    <tr>
      <td>Avg score \u2014 standard</td>
      <td>${memStats.avgScoreByMode.standard > 0 ? memStats.avgScoreByMode.standard + '/100' : '\u2014'}</td>
    </tr>
    <tr>
      <td>Avg score \u2014 full</td>
      <td>${memStats.avgScoreByMode.full > 0 ? memStats.avgScoreByMode.full + '/100' : '\u2014'}</td>
    </tr>
  </tbody>
</table>
` : `
<h2>Supervisor Intelligence</h2>
<p style="font-size:12px;color:var(--vscode-descriptionForeground);">
  No data yet \u2014 run 3+ builds to see supervisor learning stats.
</p>
`}

</body>
</html>`;

      // Handle refresh requests from the webview
      panel.webview.onDidReceiveMessage(async message => {
        if (message.command !== 'refresh') return;

        // Re-read the selected session (not just latest)
        const freshSession = sessionState.load(selectedSessionId);
        if (!freshSession) return;

        const freshStats = tokenTracker.getSessionTotal(freshSession.id);
        const freshBuildStep = freshSession.steps.find(s => s.stepName === 'build');

        panel.webview.postMessage({
          command: 'updateData',
          data: {
            qualityScore:   freshBuildStep?.metrics?.qualityScore   ?? 'N/A',
            qualityVerdict: freshBuildStep?.metrics?.qualityVerdict ?? 'N/A',
            retryCount:     freshBuildStep?.metrics?.retryCount     ?? 0,
            codeScore:      freshBuildStep?.metrics?.codeScore      ?? 'N/A',
            designScore:    freshBuildStep?.metrics?.designScore    ?? 'N/A',
            estimatedCost:  freshStats.estimatedCostUsd.toFixed(4),
            inputTokens:    freshStats.totalInputTokens.toLocaleString(),
            cacheReads:     freshStats.totalCacheReadTokens.toLocaleString(),
            prompt:         freshSession.prompt.slice(0, 100),
            status:         freshSession.status,
            template:       freshSession.template || 'auto-detected',
            startedAt:      new Date(freshSession.startedAt).toLocaleString(),
            steps:          freshSession.steps.map(s => ({
              num:     s.stepNumber,
              name:    s.stepName,
              status:  s.status,
              summary: s.outputSummary,
              time:    new Date(s.completedAt).toLocaleTimeString(),
              duration: s.durationMs
                ? s.durationMs >= 60_000
                  ? `${Math.round(s.durationMs / 60_000)}m ${Math.round((s.durationMs % 60_000) / 1000)}s`
                  : `${Math.round(s.durationMs / 1000)}s`
                : '—',
            })),
          },
        });
      }, undefined, context.subscriptions);
    }
  );

  // ── Cancel Build ─────────────────────────────────────────────────────────
  const cancelBuildCmd = vscode.commands.registerCommand(
    'zozo.cancelBuild',
    () => {
      const bus = PipelineEventBus.getInstance();
      if (!bus.isCancelled()) {
        bus.cancel();
        vscode.window.showInformationMessage('ZOZO: Build cancellation requested. Stopping after current step...');
      } else {
        vscode.window.showInformationMessage('ZOZO: No build in progress.');
      }
    }
  );

  // ── Open Settings ───────────────────────────────────────────────────────
  const openSettingsCmd = vscode.commands.registerCommand(
    'zozo.openSettings',
    async () => {
      const cfg = vscode.workspace.getConfiguration('zozo');

      const currentProvider  = cfg.get<string>('provider', 'gemini');
      const currentModel     = cfg.get<string>('model', 'gemini-2.5-flash');
      const currentThreshold = cfg.get<number>('qualityThreshold', 65);

      // Check which keys are set
      const [hasGemini, hasAnthropic, hasOpenAI] = await Promise.all([
        vault.getKey('gemini').then(k => !!k),
        vault.getKey('anthropic').then(k => !!k),
        vault.getKey('openai').then(k => !!k),
      ]);

      const panel = vscode.window.createWebviewPanel(
        'zozoSettings', 'ZOZO Settings',
        vscode.ViewColumn.Active,
        { enableScripts: true }
      );

      const keyStatus = (set: boolean) =>
        set ? '<span style="color:#4ec9b0;font-size:11px;">\u2713 saved</span>'
            : '<span style="color:#f48771;font-size:11px;">\u2717 not set</span>';

      panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:28px;max-width:560px;}
  h1{font-size:17px;font-weight:600;margin:0 0 24px;}
  h2{font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;
     color:var(--vscode-descriptionForeground);margin:20px 0 10px;}
  label{font-size:13px;display:block;margin-bottom:4px;}
  input,select{width:100%;padding:5px 8px;font-size:13px;box-sizing:border-box;
    background:var(--vscode-input-background);color:var(--vscode-input-foreground);
    border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;margin-bottom:14px;}
  .row{display:flex;gap:8px;align-items:center;}
  .row input{margin-bottom:0;flex:1;}
  button{padding:5px 14px;font-size:13px;cursor:pointer;border-radius:3px;
    background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;}
  button:hover{opacity:.9;}
  .saved{font-size:12px;color:#4ec9b0;margin-top:10px;display:none;}
  .range-wrap{display:flex;align-items:center;gap:10px;}
  .range-wrap input{margin:0;flex:1;}
  #threshold-val{font-weight:600;min-width:28px;}
</style>
</head>
<body>
<h1>ZOZO Settings</h1>

<h2>API Keys</h2>

<label>Gemini API Key &nbsp;${keyStatus(hasGemini)}</label>
<div class="row">
  <input type="password" id="key-gemini" placeholder="Paste new key to update\u2026">
  <button onclick="saveKey('gemini')">Save</button>
</div>

<label>Anthropic API Key &nbsp;${keyStatus(hasAnthropic)}</label>
<div class="row">
  <input type="password" id="key-anthropic" placeholder="Paste new key to update\u2026">
  <button onclick="saveKey('anthropic')">Save</button>
</div>

<label>OpenAI API Key &nbsp;${keyStatus(hasOpenAI)}</label>
<div class="row">
  <input type="password" id="key-openai" placeholder="Paste new key to update\u2026">
  <button onclick="saveKey('openai')">Save</button>
</div>

<div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06)">
  <label style="font-size:11px;color:#a78bfa;letter-spacing:0.05em;text-transform:uppercase;font-weight:600">
    \uD83D\uDD25 Firecrawl API Key
    <span style="color:#71717a;font-weight:400;text-transform:none;letter-spacing:0"> — Optional</span>
  </label>
  <p style="font-size:11px;color:#71717a;margin:6px 0 8px">
    Enables real website extraction — ZOZO reads top-ranked sites and copies their exact design patterns. Free tier: 500 pages/month at <strong style="color:#a78bfa">firecrawl.dev</strong>
  </p>
  <div class="row">
    <input type="password" id="key-firecrawl" placeholder="fc-xxxxxxxx (optional — get free key at firecrawl.dev)">
    <button onclick="saveFirecrawl()">Save</button>
  </div>
  <p style="font-size:10px;color:#52525b;margin-top:6px">
    Without this key: ZOZO uses hardcoded design patterns (still premium). With key: ZOZO reads real award-winning sites.
  </p>
</div>

<h2>Model</h2>
<label>Default Provider</label>
<select id="provider">
  <option value="gemini"    ${currentProvider==='gemini'    ?'selected':''}>Gemini (free tier available)</option>
  <option value="anthropic" ${currentProvider==='anthropic' ?'selected':''}>Anthropic</option>
  <option value="openai"    ${currentProvider==='openai'    ?'selected':''}>OpenAI</option>
</select>

<label>Model</label>
<select id="model">
  <option value="gemini-2.5-flash"      ${currentModel==='gemini-2.5-flash'      ?'selected':''}>gemini-2.5-flash (FREE, recommended)</option>
  <option value="gemini-2.5-pro"        ${currentModel==='gemini-2.5-pro'        ?'selected':''}>gemini-2.5-pro (FREE, best quality)</option>
  <option value="gemini-3.1-pro-preview"${currentModel==='gemini-3.1-pro-preview'?'selected':''}>gemini-3.1-pro-preview (PAID)</option>
  <option value="claude-3-7-sonnet-20250219"${currentModel==='claude-3-7-sonnet-20250219'?'selected':''}>claude-3-7-sonnet (Anthropic)</option>
  <option value="gpt-4o"                ${currentModel==='gpt-4o'                ?'selected':''}>gpt-4o (OpenAI)</option>
</select>

<h2>Quality Gate</h2>
<label>Minimum score to pass (current: <strong>${currentThreshold}</strong>)</label>
<div class="range-wrap">
  <input type="range" id="threshold" min="50" max="95" step="5" value="${currentThreshold}"
    oninput="document.getElementById('threshold-val').textContent=this.value">
  <span id="threshold-val">${currentThreshold}</span>
</div>
<p style="font-size:11px;color:var(--vscode-descriptionForeground);margin:4px 0 14px;">
  65 = ACCEPTABLE (recommended) \u00B7 85 = WORLD_CLASS only
</p>

<button onclick="savePrefs()" style="margin-top:8px;">Save Preferences</button>
<div class="saved" id="saved-msg">\u2713 Saved</div>

<script>
var vscode = acquireVsCodeApi();

function saveKey(provider) {
  var el = document.getElementById('key-' + provider);
  var key = el.value.trim();
  if (!key) return;
  vscode.postMessage({ command: 'saveKey', provider: provider, key: key });
  el.value = '';
  el.placeholder = '\u2713 Key saved';
  setTimeout(function() { el.placeholder = 'Paste new key to update\u2026'; }, 2000);
}

function savePrefs() {
  vscode.postMessage({
    command: 'savePrefs',
    provider: document.getElementById('provider').value,
    model:    document.getElementById('model').value,
    threshold: parseInt(document.getElementById('threshold').value),
  });
  var msg = document.getElementById('saved-msg');
  msg.style.display = 'block';
  setTimeout(function() { msg.style.display = 'none'; }, 2000);
}
function saveFirecrawl() {
  var key = document.getElementById('key-firecrawl').value.trim();
  vscode.postMessage({ command: 'saveFirecrawl', key: key });
  var msg = document.getElementById('saved-msg');
  msg.style.display = 'block';
  setTimeout(function() { msg.style.display = 'none'; }, 2000);
}
</script>
</body></html>`;

      panel.webview.onDidReceiveMessage(async (msg: { command: string; provider?: string; key?: string; model?: string; threshold?: number }) => {
        if (msg.command === 'saveKey' && msg.provider && msg.key) {
          await vault.storeKey(msg.provider, msg.key);
          vscode.window.showInformationMessage(`ZOZO: ${msg.provider} API key saved.`);
        }
        if (msg.command === 'saveFirecrawl') {
          const target = vscode.ConfigurationTarget.Global;
          await vscode.workspace.getConfiguration('zozo').update('firecrawlApiKey', msg.key || '', target);
          vscode.window.showInformationMessage('ZOZO: Firecrawl API key saved.');
        }
        if (msg.command === 'savePrefs') {
          const target = vscode.ConfigurationTarget.Global;
          if (msg.provider) await cfg.update('provider',         msg.provider,  target);
          if (msg.model)    await cfg.update('model',            msg.model,     target);
          if (msg.threshold) await cfg.update('qualityThreshold', msg.threshold, target);
        }
      }, undefined, context.subscriptions);
    }
  );

  // ── Set Profile & Brand Colors ──────────────────────────────────────────
  const setProfileCmd = vscode.commands.registerCommand(
    'zozo.setProfile',
    async () => {
      const { UserProfile } = await import('./engine/UserProfile');
      const up = new UserProfile();

      const company = await vscode.window.showInputBox({
        prompt: 'Your company or project name (optional)',
        value: up.getProfile().companyName ?? '',
      });
      if (company !== undefined) up.setCompanyName(company);

      const colors = await vscode.window.showInputBox({
        prompt: 'Brand hex colors (comma-separated, e.g. #7c3aed,#06b6d4)',
        placeHolder: '#7c3aed,#06b6d4',
      });
      if (colors) {
        up.setBrandColors(colors.split(',').map(c => c.trim()).filter(c => c.startsWith('#')));
      }

      vscode.window.showInformationMessage('ZOZO: Profile saved. Future builds will use your preferences.');
    }
  );

  // ── Set Gemini API Key ──────────────────────────────────────────────────
  const setGeminiKeyCmd = vscode.commands.registerCommand(
    'zozo.setGeminiKey',
    async () => {
      const geminiKey = await vscode.window.showInputBox({
        prompt: 'Enter your Google Gemini API key (free at aistudio.google.com/apikey)',
        password: true,
        placeHolder: 'AIza...',
        ignoreFocusOut: true,
      });
      if (geminiKey?.trim()) {
        await vault.storeKey('Gemini', geminiKey.trim());
        vscode.window.showInformationMessage('✅ Gemini key saved — Efficient mode now uses free Gemini tier');
      }
    }
  );

  context.subscriptions.push(setApiKeyCmd, testCoreLoopCmd, promptAICmd, chatCmd, showCostCmd, resumeBuildCmd, forceUnlockCmd, inspectBuildCmd, cancelBuildCmd, openSettingsCmd, setProfileCmd, setGeminiKeyCmd);

  // Register ZOZO as a sidebar WebviewView (shows in activity bar)
  const chatSidebarProvider = new ChatSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('zozo.chatView', chatSidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  vscode.window.showInformationMessage("⚡ ZOZO Orchestrator activated. Multi-agent engine online.");

  // Idle status bar — shows ZOZO is ready when no build is running
  const idleBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  idleBar.text = '$(zap) ZOZO';
  idleBar.tooltip = 'ZOZO ready — click to open chat';
  idleBar.command = 'zozo.chat';
  idleBar.show();
  context.subscriptions.push(idleBar);

  // Hide idle bar during builds, show it after
  const idleBus = PipelineEventBus.getInstance();
  idleBus.subscribe(event => {
    if (event.type === 'session_start') idleBar.hide();
    if (event.type === 'build_complete' ||
        event.type === 'build_failed' ||
        event.type === 'build_cancelled') {
      setTimeout(() => idleBar.show(), 3500);
    }
  });

  // First-run onboarding — shows once, never again
  const hasOnboarded = context.globalState.get<boolean>('zozo.onboarded', false);
  if (!hasOnboarded) {
    await context.globalState.update('zozo.onboarded', true);
    const choice = await vscode.window.showInformationMessage(
      'Welcome to ZOZO! 👋 Type a prompt like "build a dark SaaS app" to generate a full production Next.js app.',
      'Open Settings',
      'Open Chat',
      'Dismiss'
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('zozo.openSettings');
    } else if (choice === 'Open Chat') {
      await vscode.commands.executeCommand('zozo.chat');
    }
  }

  // Dream runs after builds complete, not on startup
  // This is wired in Orchestrator.ts via a post-build trigger


  // ── Run Smoke Tests command ────────────────────────────────────────────────
  const runTestsCmd = vscode.commands.registerCommand(
    'zozo.runTests',
    async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace open');
        return;
      }

      const testFile = path.join(workspaceRoot, '__tests__', 'smoke.test.ts');
      if (!fs.existsSync(testFile)) {
        vscode.window.showInformationMessage('No smoke tests yet. Run a build first.');
        return;
      }

      const terminal = vscode.window.createTerminal('ZOZO Tests');
      terminal.show();
      terminal.sendText(`cd "${workspaceRoot}" && npx vitest run __tests__/smoke.test.ts`);

      vscode.window.showInformationMessage(
        'ZOZO: Running smoke tests in terminal...'
      );
    }
  );
  context.subscriptions.push(runTestsCmd);
}

export function deactivate(): void {
  // no-op
}
