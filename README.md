# ZOZO Orchestrator ⚡

> **Deterministic AI orchestrator living natively inside VS Code.**  
> Build production-ready Next.js & TypeScript web applications autonomously with multi-agent orchestration, self-healing code repair, real-time live preview, and intelligent clarification gates.

[![Version](https://img.shields.io/badge/version-0.2.2-blue.svg)](package.json)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC.svg?logo=visual-studio-code)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg?logo=typescript)](https://www.typescriptlang.org/)

---

## 📖 Overview

**ZOZO** is a deterministic, multi-agent AI engineering pipeline built directly into Visual Studio Code. Rather than relying on simple single-shot prompts, ZOZO coordinates specialized autonomous agents across design, architecture, code generation, validation, and self-healing.

Whether you're scaffolding a full-stack Next.js application from scratch, modifying component styles, fixing bugs, or streaming live component waves into your editor, ZOZO ensures high code quality, zero-leak credential security, and deterministic execution.

---

## ✨ Key Features

### 🤖 Multi-Agent Orchestration Pipeline
ZOZO decomposes software engineering tasks into specialized stages handled by dedicated agents:
- **ArchitectAgent**: Analyzes high-level product requirements, plans component trees, file layouts, and dependency manifests.
- **PlannerAgent**: Deconstructs feature roadmaps into ordered execution waves with dependency graphs.
- **BuilderAgent**: Synthesizes clean, typed TypeScript and React components using streaming generation.
- **DesignAgent**: Enforces modern visual standards, responsive layouts, Tailwind CSS schemes, and typography.
- **ValidatorAgent & ImportValidator**: Verifies syntax, imports, prop constraints, and prevents circular dependencies.
- **CodeGuard & CodeAdapter**: Self-healing runtime that automatically captures TypeScript errors and repairs broken code.
- **SecurityAgent**: Scans generated code for vulnerabilities, unsafe DOM injections, and exposed secrets.
- **Performance & SEO Agents**: Optimizes image assets, bundles, metadata, and OpenGraph configurations.
- **EditAgent**: Precision diff patching for incremental changes without rewriting entire files.

### 🧠 Follow-Up Intelligence & Intent Resolver
ZOZO understands contextual natural language follow-ups with an 8-way intent routing engine:
- `NEW_BUILD`: Greenfield application and project generation.
- `ADD_FEATURE`: Seamlessly adds new components or pages while preserving existing project files.
- `MODIFY_STYLE`: Updates visual themes, Tailwind palettes, and layout spacing.
- `MODIFY_LOGIC`: Modifies state, API hooks, and event handlers.
- `FIX_BUG`: Resolves specific runtime or compile-time issues.
- `EXPLAIN`: Explains architectural decisions without mutating source files.
- `UNDO`: Instant rollback to previous snapshots.
- `CHAT`: General conversational coding assistance.

### 🚦 ClarificationGate (4-Factor Decision Engine)
Never get interrupted by unnecessary questions or stuck with bad assumptions. ZOZO's `ClarificationGate` evaluates:
1. **Ambiguity Level**: Is the intent well-defined?
2. **Reversibility**: Can the action be easily undone?
3. **Sensible Defaults**: Is there an industry-standard modern pattern?
4. **User Impact**: Does this choice fundamentally alter application architecture?

If a sensible default exists, ZOZO proceeds autonomously; if a high-impact architectural choice is required, it presents clean multi-choice decisions.

### 🌊 ComponentWaveEngine & Live Preview
- Progressively renders UI components into an interactive live preview panel (`zozo.preview`).
- Real-time event streaming powered by the centralized `PipelineEventBus`.
- Inspect builds, token usage, and timeline execution live.

### 🔒 Zero-Leak Credential Security (ZozoVault)
- **Bring Your Own Key (BYOK)**: Supports Google Gemini, OpenAI, and Anthropic.
- **OS-Level Encryption**: All keys are stored securely using VS Code's native `SecretStorage` (`ZozoVault`).
- **No Disk Leaks**: API keys are never written to disk, git history, configuration files, or logs.
- Dedicated command `ZOZO: Delete API Key` allows instant credential purging.

---

## Supported AI Providers & Models

| Provider | Supported Models | Notes |
| :--- | :--- | :--- |
| **Google Gemini** | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-1.5-flash` | Free tier supported via Google AI Studio |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini` | High accuracy reasoning and structured outputs |
| **Anthropic** | `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` | Deep architectural and refactoring capability |

---

## 🚀 Getting Started

### Prerequisites
- [VS Code](https://code.visualstudio.com/) version `1.85.0` or higher
- [Node.js](https://nodejs.org/) `v18.0.0` or higher
- An API key for your preferred provider (e.g. Gemini, Anthropic, or OpenAI)

### Installation for Development
1. Clone this repository:
   ```bash
   git clone https://github.com/rxvikumar/zozo.git
   cd zozo
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Press `F5` in VS Code to launch the Extension Development Host window.

---

## ⌨️ Available Commands

Access these commands from the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Title | Description |
| :--- | :--- | :--- |
| `zozo.chat` | **ZOZO: Chat** | Opens the conversational agent in your active editor |
| `zozo.chatView.focus` | **ZOZO: Open Chat Panel** | Focuses the ZOZO sidebar panel |
| `zozo.promptAI` | **ZOZO: Prompt AI** | Trigger a direct build or edit prompt |
| `zozo.preview` | **ZOZO: Open Live Preview** | Opens the real-time live preview panel |
| `zozo.setGeminiKey` | **ZOZO: Set Gemini API Key (Free)** | Stores your Gemini API key in `ZozoVault` |
| `zozo.setApiKey` | **ZOZO: Set API Key** | Prompts for provider and stores key in secure vault |
| `zozo.deleteApiKey` | **ZOZO: Delete API Key** | Deletes a stored provider API key from the vault |
| `zozo.resumeBuild` | **ZOZO: Resume Last Build** | Continues an interrupted pipeline build |
| `zozo.inspectBuild` | **ZOZO: Inspect Last Build** | Inspects errors, logs, and agent artifacts |
| `zozo.cancelBuild` | **ZOZO: Cancel Current Build** | Safely halts the running build pipeline |
| `zozo.forceUnlock` | **ZOZO: Force Unlock Pipeline** | Recovery mechanism to clear pipeline locks |
| `zozo.showCost` | **ZOZO: Show Cost & Token Usage** | Shows real-time token tracking and cost metrics |
| `zozo.setProfile` | **ZOZO: Set Profile & Brand Colors** | Sets developer profile and default UI themes |
| `zozo.runTests` | **ZOZO: Run Smoke Tests** | Runs smoke test suite across generated code |
| `zozo.openSettings` | **ZOZO: Open Settings** | Jumps directly to ZOZO settings |

---

## ⚙️ Configuration Settings

Configure ZOZO in `Settings > Extensions > ZOZO`:

```json
{
  "zozo.provider": "gemini",
  "zozo.model": "gemini-2.5-flash",
  "zozo.qualityThreshold": 65,
  "zozo.firecrawlApiKey": "",
  "zozo.geminiApiKey": ""
}
```

- **`zozo.provider`**: Default LLM provider (`gemini`, `openai`, `anthropic`).
- **`zozo.model`**: Model identifier string.
- **`zozo.qualityThreshold`**: Minimum passing score for QualityGate before final delivery (range `50`–`95`, default `65`).
- **`zozo.firecrawlApiKey`**: *(Optional)* Firecrawl key for real-world website layout extraction.

---

## 📁 Project Architecture

```
ZOZO/
├── components/          # Shared UI elements & wallet integrations
├── media/               # Icons, branding assets, SVGs
├── src/
│   ├── agents/          # Specialized multi-agent implementations
│   │   ├── BuilderAgent.ts
│   │   ├── DesignAgent.ts
│   │   ├── DevOpsAgent.ts
│   │   ├── PerformanceAgent.ts
│   │   ├── PlannerAgent.ts
│   │   ├── SecurityAgent.ts
│   │   ├── SEOAgent.ts
│   │   └── ValidatorAgent.ts
│   ├── chat/            # Webview sidebar and interactive panels
│   │   ├── ChatPanel.ts
│   │   └── ChatSidebarProvider.ts
│   ├── engine/          # Core orchestration and execution engine
│   │   ├── ArchitectAgent.ts
│   │   ├── ClarificationGate.ts
│   │   ├── CodeGuard.ts
│   │   ├── ComponentWaveEngine.ts
│   │   ├── EditAgent.ts
│   │   ├── IntentResolver.ts
│   │   ├── LivePreview.ts
│   │   ├── NetworkNode.ts
│   │   ├── Orchestrator.ts
│   │   ├── PipelineEventBus.ts
│   │   ├── QualityGate.ts
│   │   └── ResourceAgent.ts
│   ├── lib/             # Multi-agent framework primitives & LLM adapters
│   ├── security/        # ZozoVault and credential isolation
│   └── extension.ts     # Main VS Code extension activation & commands
├── package.json         # Extension manifest, commands & configs
└── tsconfig.json        # TypeScript configuration
```

---

## 🛡️ Security & Privacy

1. **No Hardcoded Keys**: ZOZO contains zero hardcoded API keys. All credentials are provided by the user and encrypted by the operating system via VS Code's `SecretStorage`.
2. **Local Execution**: All agent planning, file writing, validation, and AST repairs execute entirely on your local machine.
3. **No Telemetry / Data Harvesting**: Your code and prompts are sent exclusively to your chosen AI provider endpoint.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
