import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);
import { detectTemplate } from "./TemplateLibrary";
import { executeActions } from "./ActionExecutor";
import { sanitizeNestedActions } from "./CodeGuard";
import { RulesAgent } from "./RulesAgent";
import { detectAppType, buildResourceContext } from "./DesignPresets";
import { runPlannerAgent } from "../agents/PlannerAgent";
import { runPlannerAgentWithContext } from "../agents/PlannerAgent";
import { runDesignAgent } from "../agents/DesignAgent";
import { runBuilderAgent } from "../agents/BuilderAgent";
import { runBuilderAgentWithContext } from "../agents/BuilderAgent";
import { runValidatorAgent } from "../agents/ValidatorAgent";
import { runValidatorAgentWithContext } from "../agents/ValidatorAgent";
import { runSecurityAgent } from "../agents/SecurityAgent";
import { runSecurityAgentWithContext } from "../agents/SecurityAgent";
import { runSEOAgent } from "../agents/SEOAgent";
import { runSEOAgentWithContext } from "../agents/SEOAgent";
import { runPerformanceAgent } from "../agents/PerformanceAgent";
import { runPerformanceAgentWithContext } from "../agents/PerformanceAgent";
import { runDevOpsAgent } from "../agents/DevOpsAgent";
import { runDevOpsAgentWithContext } from "../agents/DevOpsAgent";
import { runSuggestionAgent, showSuggestions } from "../agents/SuggestionAgent";
import { QualityGate } from "./QualityGate";
import { SessionState, STEP } from "./SessionState";
import { TokenTracker } from "./TokenTracker";
import { WorkspaceGuard } from "./WorkspaceGuard";
import { DreamEngine } from "./DreamEngine";
import { PipelineLogger } from "./PipelineLogger";
import { AgentContextFactory } from "./AgentContext";
import { TaskQueue } from '../lib/multi-agent/task/queue';
import { createTask } from '../lib/multi-agent/task/task';
import { runPrioritized } from '../lib/multi-agent/scheduler';
import { PipelineEventBus } from './PipelineEventBus';
import { ResourceAgent, fetchMedia, buildMediaContext } from './ResourceAgent';
import { TemplateSelector } from './TemplateSelector';
import { CodeAdapter } from './CodeAdapter';
import { DesignRulesEngine } from './DesignRulesEngine';
import { SupervisorAgent, type PipelineDecision } from './SupervisorAgent';
import { ContextCompactor, OUTPUT_DISCIPLINE } from './ContextCompactor';
import { UIEngine } from './UIEngine';
import { CodeUnderstandingAgent } from './CodeUnderstandingAgent';
import { BuildVerifier } from './BuildVerifier';
import { DeployAgent } from './DeployAgent';
import { UserProfile } from './UserProfile';
import { RuntimeVerifier } from './RuntimeVerifier';
import { EnvHandler } from './EnvHandler';
import { DependencyReconciler } from './DependencyReconciler';
import { HealthCheck } from './HealthCheck';
import { PackageRegistry } from './PackageRegistry';
import { ImportValidator } from './ImportValidator';
import { PropConstraints } from './PropConstraints';
import { APIContractValidator } from './APIContractValidator';
import { SmokeTestGenerator } from './SmokeTestGenerator';
import { BuildProfileCapture, type BuildProfile } from './BuildProfile';
import { setModelOverrides, streamFromLLM } from './NetworkNode';
import { atomicWrite } from './AtomicWriter';
import { saveProjectState, buildProjectState, loadProjectState } from './ProjectMemory';


const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "out", "dist", ".next", "build", ".turbo", "coverage",
]);
const INCLUDED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html", ".md",
]);
const MAX_CONTEXT_CHARS = 12000;


// ─── Context Scanner ──────────────────────────────────────────────────────────

function scanWorkspace(root: string): string {
  const files: Array<{ filePath: string; content: string }> = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const fullName = entry.name;
        if (INCLUDED_EXTENSIONS.has(ext) || fullName === ".env.example") {
          const absolutePath = path.join(dir, entry.name);
          try {
            const content = fs.readFileSync(absolutePath, "utf-8");
            const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
            files.push({ filePath: relativePath, content });
          } catch {
            // skip unreadable
          }
        }
      }
    }
  }

  walk(root);

  let contextXml = "<existing_files>\n";
  let totalChars = contextXml.length;

  for (const { filePath, content } of files) {
    const block = `<file path="${filePath}">\n${content}\n</file>\n`;
    if (totalChars + block.length > MAX_CONTEXT_CHARS) break;
    contextXml += block;
    totalChars += block.length;
  }

  contextXml += "</existing_files>";
  return contextXml;
}

// ─── 13-Step Orchestration Pipeline ───────────────────────────────────────────

let _pipelineRunning = false;  // Prevent duplicate session runs

export async function runOrchestration(
  userPrompt: string,
  provider: string,
  apiKey: string,
  workspaceRoot: string,
  outputChannel: vscode.OutputChannel,
  options?: {
    resumeSessionId?: string
    resumeFromStep?: number
    buildProfile?: BuildProfile
    geminiKey?: string         // Gemini key for Efficient mode (Planner+Design use free tier)
  }
): Promise<void> {

  // Prevent duplicate session runs — a second trigger while building costs double
  if (_pipelineRunning) {
    outputChannel.appendLine('[ZOZO] \u26A0\uFE0F Build already running \u2014 ignoring duplicate trigger');
    return;
  }
  _pipelineRunning = true;

  try {

    const divider = "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550";

    const sessionState = new SessionState();
    sessionState.cleanup(100);
    const tokenTracker = new TokenTracker();
    const logger = new PipelineLogger(outputChannel);

    // Resume mode: load existing session or create new one
    let session = options?.resumeSessionId
      ? sessionState.load(options.resumeSessionId)
      : null;

    const resumeFromStep = options?.resumeFromStep ?? 0;

    // Never skip past step 3 — can’t restore full builder output from summaries
    const effectiveStartStep = session && resumeFromStep > 0
      ? Math.min(resumeFromStep, 3)
      : 0;

    if (session) {
      logger.info(`🔄 Resuming session ${session.id} from step ${effectiveStartStep}`);
      if (effectiveStartStep > 0) {
        logger.info(`⏭ Resume: skipping steps 1-${effectiveStartStep - 1}, starting from step ${effectiveStartStep}`);
      }
    } else {
      session = sessionState.create(userPrompt, provider);
      logger.info(`Session: ${session.id}`);
    }

    const bus = PipelineEventBus.getInstance()
    bus.startSession(session.id)
    const pipelineStartTime = Date.now()

    // ── [1] SUPERVISOR ───────────────────────────────────────────────────────
    const supervisor = new SupervisorAgent()
    let decision = await supervisor.decide(userPrompt, provider, apiKey)

    logger.step('ZOZO Build Started')
    logger.info(`Mode: ${decision.mode.toUpperCase()} | Est: ~${decision.estimatedMinutes} min`)
    logger.info(`Session: ${session.id}`)
    logger.info(`Prompt: "${userPrompt.slice(0, 60)}${userPrompt.length > 60 ? '...' : ''}"`)
    logger.info(`Reason: ${decision.reasoning}`)
    logger.info('─'.repeat(40))

    bus.emit({
      type: 'step_start',
      sessionId: session.id,
      stepNumber: 0,
      stepName: `${decision.mode} mode \u2014 ~${decision.estimatedMinutes} min`,
    })

    WorkspaceGuard.getInstance().updateStep(`${decision.mode.toUpperCase()} BUILD`)

    // Profile overrides supervisor decision if user provided one
    if (options?.buildProfile) {
      const profile = options.buildProfile

      // CRITICAL: rebuild the STEPS object from the profile's pipeline mode
      // Without this, supervisor's "full" steps leak through even when user picked Normal/Express
      const EXPRESS_STEPS = {
        resourceFetch: true,   // cheap HTTP call, no LLM — fetched templates prevent CSS bugs
        design: true,
        validate: false,
        security: false,
        seo: false,
        performance: false,
        devops: false,
        suggest: false,
      }
      const STANDARD_STEPS = {
        resourceFetch: true,
        design: true,
        validate: true,
        security: false,
        seo: true,
        performance: false,
        devops: false,
        suggest: true,
      }
      const FULL_STEPS = {
        resourceFetch: true,
        design: true,
        validate: true,
        security: true,
        seo: true,
        performance: true,
        devops: true,
        suggest: true,
      }

      const stepsMap = {
        express: EXPRESS_STEPS,
        standard: STANDARD_STEPS,
        full: FULL_STEPS,
      }

      decision = {
        ...decision,
        mode: profile.pipelineMode,
        steps: stepsMap[profile.pipelineMode] ?? EXPRESS_STEPS,
        reasoning: `User profile: ${profile.complexity} mode, ${profile.uiStyle} style`,
      }

      // Set model overrides for the user's selected provider
      // Efficient mode routing is handled by cheapCtxFactory (actual provider+key swap)
      const isGemini = profile.selectedProvider.toLowerCase() === 'gemini'
      const isAnthropic = profile.selectedProvider.toLowerCase() === 'anthropic'
      const isOpenAI = profile.selectedProvider.toLowerCase() === 'openai'

      setModelOverrides(
        isGemini ? profile.selectedModel : null,
        isAnthropic ? profile.selectedModel : null,
        isOpenAI ? profile.selectedModel : null,
      )
      if (profile.efficient && profile.complexity === 'normal') {
        logger.info(`\u26A1 EFFICIENT mode: Planner+Design \u2192 Gemini free tier`)
        logger.info(`\u26A1 EFFICIENT mode: Builder \u2192 ${profile.selectedModel} (${profile.selectedProvider})`)
      }
      const qualityLabel = profile.efficient ? 'Efficient \uD83D\uDD0B' : 'Quality'
      const costEstimate = profile.efficient
        ? '$0.08\u20130.13 (Efficient \u2014 Builder only paid)'
        : profile.complexity === 'normal' ? '$0.10\u20130.20 (Normal Quality)' : '$0.30\u20131.00+'
      logger.info(`Mode: ${decision.mode.toUpperCase()} | Quality: ${qualityLabel}`)
      logger.info(`\uD83D\uDCB0 Estimated cost: ${costEstimate}`)
      logger.info(`Pipeline steps: ${Object.entries(decision.steps).filter(([, v]) => v).map(([k]) => k).join(', ')}`)
      logger.info(`Profile: ${profile.complexity} \u00B7 ${profile.uiStyle} \u00B7 ${profile.animation} \u00B7 ${profile.visualDepth}`)
      logger.info(`Model: ${profile.selectedModel} (user selected)`)
      logger.info(`Design preset: ${profile.designPreset}`)
    }

    // User profile — personalization across builds
    const userProfile = new UserProfile()
    const userProfileHint = userProfile.toPromptHint()
    if (userProfileHint) {
      logger.info(`👤 User profile loaded (${userProfile.getProfile().buildCount} builds)`)
    }

    // Efficient mode: Planner+Design use Gemini free tier (different provider+key)
    const isEfficientMode = !!(options?.buildProfile?.efficient && options.geminiKey)
    const cheapProvider = isEfficientMode ? 'gemini' : provider
    const cheapApiKey = isEfficientMode ? options!.geminiKey! : apiKey

    // Agent context factory — provides isolated, immutable data slices per agent
    // In Efficient mode, create a separate cheap factory for Planner+Design
    const ctxFactory = new AgentContextFactory({
      sessionId: session.id,
      provider,
      apiKey,
      workspaceRoot,
      userPrompt,
    });

    // Cheap factory for Planner+Design in Efficient mode (uses Gemini free tier)
    const cheapCtxFactory = isEfficientMode
      ? new AgentContextFactory({
        sessionId: session.id,
        provider: cheapProvider,
        apiKey: cheapApiKey,
        workspaceRoot,
        userPrompt,
      })
      : ctxFactory;

    // ── [2] WORKSPACE SCAN + UNDERSTANDING ──────────────────────────────────
    let stepStart = Date.now();
    let contextXml = '';
    if (effectiveStartStep <= 1) {
      logger.step('Step 1 — Workspace Scan');
      contextXml = scanWorkspace(workspaceRoot);
      const existingFileCount = (contextXml.match(/<file path=/g) ?? []).length;
      logger.info(`Found ${existingFileCount} existing file(s) (${contextXml.length} chars).`);

      // If workspace is empty or near-empty, don't waste context budget on file contents
      // This gives Builder more output room and prevents truncation
      if (existingFileCount <= 2 || contextXml.length < 500) {
        contextXml = '<existing_files>Empty workspace — building from scratch</existing_files>';
        logger.info('Empty workspace detected — skipping file scan context');
      }

      // Inject memory context from past builds
      const dreamEngine = new DreamEngine();
      const memoryContext = dreamEngine.getMemoryContext();
      if (memoryContext) {
        contextXml = contextXml + memoryContext;
        logger.info('🧠 Memory context loaded from past builds');
      }

      sessionState.checkpoint(session.id, 1, STEP.WORKSPACE_SCAN, `${contextXml.length} chars scanned`, undefined, stepStart);
    } else {
      logger.info('⏭ Step 1 skipped (resuming)');
      contextXml = scanWorkspace(workspaceRoot);  // cheap re-scan for context
    }

    // CodeUnderstandingAgent: analyze workspace structure
    const codeUnderstanding = new CodeUnderstandingAgent()
    const workspaceUnderstanding = codeUnderstanding.analyze(workspaceRoot)
    const workspaceHint = codeUnderstanding.toPromptHint(workspaceUnderstanding)
    logger.info(workspaceUnderstanding.summary)
    if (workspaceUnderstanding.isExistingProject) {
      logger.info(`Existing project: ${workspaceUnderstanding.existingPages.length} pages, ${workspaceUnderstanding.existingComponents.length} components`)
    }

    // ── [3] TEMPLATE DETECTION ──────────────────────────────────────────────
    let template = 'saas';
    if (effectiveStartStep <= 2) {
      template = detectTemplate(userPrompt);
      logger.info(`Template: ${template}`);
      sessionState.checkpoint(session.id, 2, STEP.TEMPLATE_DETECT, `template: ${template}`, undefined, stepStart);
      sessionState.setTemplate(session.id, template);
    } else {
      logger.info('⏭ Step 2 skipped (resuming)');
      template = session.template || detectTemplate(userPrompt);
    }

    // ── [4] PLANNER AGENT ──────────────────────────────────────────────────
    if (bus.isCancelled()) { logger.warning('Build cancelled by user'); bus.reset(); return }
    stepStart = Date.now();
    bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 3, stepName: STEP.PLAN })
    logger.step('Step 3 — Planner Agent');

    const plannerBlueprint = {
      colorPalette: { primary: "#6366f1", secondary: "#8b5cf6", accent: "#06b6d4", background: "#0a0a0f", text: "#e2e8f0" },
      fontPair: { heading: "Space Grotesk", body: "Inter" },
      animationLibrary: "framer-motion",
      uiLibrary: "shadcn",
      threeD: false,
      threeDStyle: "none",
      glassmorphism: true,
      darkMode: true,
      layoutStyle: "luxury",
      experienceStyle: "linear",
      motionIntensity: "medium",
      fakeVsReal3D: "none",
      cursorInteractive: true,
      kineticTypography: true,
      noiseTexture: true,
      depthLayers: 3,
    };

    // Pass pipeline mode to planner — constraint is baked into preamble + trailer
    const plannerCtx = cheapCtxFactory.forPlanner(contextXml + '\n\n' + workspaceHint, template, plannerBlueprint);
    const plan = await runPlannerAgentWithContext(plannerCtx, decision.mode);

    logger.info(`${plan.filesToCreate.length} files planned`);
    logger.info(`Tech Stack: ${plan.techStack.join(", ")}`);
    logger.info(`Framework: ${plan.framework}`);
    logger.info(`Components: ${plan.estimatedComponents}`);
    if (plan.folderStructure) {
      logger.info(`Folder Structure:\n${plan.folderStructure}`);
    }
    sessionState.checkpoint(session.id, 3, STEP.PLAN, `${plan.filesToCreate?.length ?? 0} files planned`, undefined, stepStart);
    bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 3, stepName: STEP.PLAN })
    WorkspaceGuard.getInstance().updateStep('Planning');

    // ── [5] DESIGN AGENT ───────────────────────────────────────────────────
    if (bus.isCancelled()) { logger.warning('Build cancelled by user'); bus.reset(); return }
    stepStart = Date.now();
    bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 4, stepName: STEP.DESIGN })
    logger.step('Step 4 — Design Agent');

    const designContext = `${userPrompt}\n\nProject Plan: ${JSON.stringify(plan)}`;
    const blueprint = await runDesignAgent(template, designContext, cheapProvider, cheapApiKey);

    logger.info(`Style: ${blueprint.layoutStyle} | ${blueprint.animationLibrary}`);
    logger.info(`Colors: ${blueprint.colorPalette.primary} / ${blueprint.colorPalette.accent}`);
    logger.info(`Fonts: ${blueprint.fontPair.heading} + ${blueprint.fontPair.body}`);

    // Force 3D if prompt mentions 3D/three/webgl
    const prompt3D = /\b(3d|three\.?js|webgl|three-dimensional)\b/i.test(userPrompt)
    if (prompt3D && !blueprint.threeD) {
      blueprint.threeD = true
      blueprint.threeDStyle = 'geometric'
      outputChannel.appendLine('[ZOZO] \uD83C\uDFAE 3D forced: Three.js will be used in Hero')
      logger.info('3D FORCED by prompt keywords')
    }

    logger.info(`3D: ${blueprint.threeD} (${blueprint.threeDStyle}) | Glass: ${blueprint.glassmorphism}`);
    sessionState.checkpoint(session.id, 4, STEP.DESIGN, `blueprint ready`, undefined, stepStart);
    bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 4, stepName: STEP.DESIGN })
    WorkspaceGuard.getInstance().updateStep('Designing');

    // ── [6] RESOURCE INTELLIGENCE ──────────────────────────────────────────
    let resourceHint = ''
    if (decision.steps.resourceFetch) {
      bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 5, stepName: 'resource-fetch' })
      logger.step('Step 4.5 — Resource Intelligence')

      try {
        const resourceAgent = new ResourceAgent()
        const selector = new TemplateSelector()
        const adapter = new CodeAdapter()

        logger.info('Fetching component patterns from shadcn + Aceternity...')
        const rawResources = await resourceAgent.fetch(userPrompt, template, outputChannel)

        if (rawResources.length > 0) {
          logger.info(`Found ${rawResources.length} candidate resources`)

          const dre = new DesignRulesEngine()
          const rules = dre.getRules(template)
          const selection = selector.select(rawResources, rules)

          logger.info(
            `Strategy: ${selection.strategy} | ` +
            `Selected: ${selection.selected.length} | ` +
            `Rejected: ${selection.rejected.length}`
          )

          if (selection.selected.length > 0) {
            const adapted = adapter.adapt(selection.selected, rules)
            resourceHint = adapter.toBuilderHint(adapted, selection.strategy)
            logger.success(
              `Resource Intelligence: ${selection.strategy} mode — ` +
              `using ${selection.selected.map(s => s.resource.name).join(', ')}`
            )
          }
        } else {
          logger.warning('Resource fetch returned 0 results. Builder will use DesignPresets (hardcoded Awwwards patterns)')
        }
      } catch (err: unknown) {
        logger.warning(`Resource Intelligence skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
      bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 5, stepName: 'resource-fetch' })
    } else {
      logger.info('⏭ Resource fetch skipped (express mode)')
    }

    // ── [7] BUILDER AGENT ──────────────────────────────────────────────────
    if (bus.isCancelled()) { logger.warning('Build cancelled by user'); bus.reset(); return }
    stepStart = Date.now();
    bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 6, stepName: STEP.BUILD })
    logger.step('Step 5 — Builder Agent');

    // Compact context before sending to builder — enforces 12K char budget
    const compactor = new ContextCompactor()
    const memoryCtxRaw = contextXml.includes('Memory') ? contextXml : ''
    const packageRegistry = new PackageRegistry()
    const packageConstraints = packageRegistry.toConstraintPrompt()

    // Inject build profile hint if available
    const profileCapture = new BuildProfileCapture()
    const profileHint = options?.buildProfile
      ? profileCapture.toPromptHint(options.buildProfile)
      : ''

    const compacted = compactor.compact({
      designRules: OUTPUT_DISCIPLINE,    // output discipline + builder computes its own design rules
      memoryContext: memoryCtxRaw + (userProfileHint ? '\n\n' + userProfileHint : '') + (profileHint ? '\n\n' + profileHint : ''),
      workspaceContext: contextXml,
      resourceHint: resourceHint,
      packageConstraints,
    })

    if (compacted.wasCompacted) {
      logger.info(`Context compacted: ${compacted.totalChars} chars (${compacted.budgetUsedPct}% of budget)`)
    }

    const builderResourceCtx = compacted.resourceHint
      ? compacted.memoryContext + '\n\n' + compacted.resourceHint
      : compacted.memoryContext

    // ── Unified context builder ──────────────────────────────────────────

    const detectedAppType = detectAppType(userPrompt)
    logger.info(`Design preset: ${detectedAppType} (auto-detected from prompt)`)

    // 1. DesignPresets — always (zero cost, zero network)
    const premiumDesignCtx = buildResourceContext(detectedAppType)
    outputChannel.appendLine(`[ZOZO] \uD83C\uDFA8 Design injected: type=${detectedAppType} | ctx=${premiumDesignCtx.length} chars`)

    // 2. Web search for design inspiration
    let webInspiration = ''
    outputChannel.appendLine(`[RESOURCE] 🔎 Starting web search (apiKey=${apiKey ? 'present' : 'MISSING'})...`)
    try {
      const searchAgent = new ResourceAgent()
      webInspiration = await searchAgent.searchWebForInspiration(
        userPrompt,
        'hybrid',
        detectedAppType,
        outputChannel,
        apiKey
      )
      if (webInspiration) {
        outputChannel.appendLine(`[RESOURCE] \u2705 Web inspiration injected (${webInspiration.length} chars)`)
      } else {
        outputChannel.appendLine('[RESOURCE] \u26A0\uFE0F Web search returned empty')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      outputChannel.appendLine(`[RESOURCE] \u274C Web search FAILED: ${msg}`)
    }

    // 3. Media (images/videos) — always (zero cost, zero network)
    const media = fetchMedia(userPrompt, outputChannel)
    const mediaCtx = buildMediaContext(media)

    // Combine in priority order
    const finalBuilderCtx = [
      builderResourceCtx,   // memory + shadcn resources
      premiumDesignCtx,     // design presets
      webInspiration,       // web search + GitHub + Awwwards
      mediaCtx,             // real images/videos
    ].filter(Boolean).join('\n\n')

    // Build auto-profile from detected app type
    // AFTER — user picks Premium/Heavy/3D → it actually reaches the builder
    const bp = options?.buildProfile
    const autoProfile = {
      style: bp?.uiStyle === 'premium' ? 'premium'
        : bp?.uiStyle === 'minimal' ? 'minimal'
          : bp?.uiStyle === 'modern' ? 'modern'
            : (detectedAppType === 'landing' || detectedAppType === 'portfolio' || detectedAppType === 'web3')
              ? 'premium' : 'modern',

      animation: bp?.animation === 'heavy' ? 'heavy'
        : bp?.animation === 'none' ? 'none'
          : bp?.animation === 'light' ? 'light'
            : detectedAppType === 'saas' ? 'light' : 'heavy',

      depth: bp?.visualDepth === '3d' ? '3d'
        : bp?.visualDepth === 'hybrid' ? 'hybrid'
          : bp?.visualDepth === '2d' ? '2d'
            : 'hybrid',

      inspiration: (bp?.inspiration && bp.inspiration.length > 0)
        ? bp.inspiration
        : detectedAppType === 'web3' ? ['web3-crypto', 'framer-style']
          : detectedAppType === 'portfolio' ? ['editorial', 'framer-style']
            : ['framer-style'],
    }
    outputChannel.appendLine(
      `[ZOZO] ✅ Profile (user→auto): style=${autoProfile.style} anim=${autoProfile.animation} depth=${autoProfile.depth} inspiration=${autoProfile.inspiration.join(',')}`
    )

    // Efficient mode: Builder uses user's provider+apiKey directly (line below)
    // Planner+Design already routed to Gemini via cheapCtxFactory + cheapProvider
    if (isEfficientMode) {
      logger.info(`\u26A1 EFFICIENT: Builder using ${provider} (user's provider)`)
    }

    let builderOutput = await runBuilderAgent(
      userPrompt, plan, blueprint, template, provider, apiKey,
      undefined,           // designRulesOverride \u2014 let builder compute
      finalBuilderCtx,     // memory + resources + design + media + web search
      undefined,           // no fixPrompt on first pass
      undefined,           // no packageConstraints override
      autoProfile          // profile: style, animation, depth, inspiration
    );

    logger.success(`Builder complete (${builderOutput.length} chars output).`);

    // ── [7.5] IMPORT VALIDATION (runs before UIEngine, before writes) ───────
    const importValidator = new ImportValidator()
    const importValidation = importValidator.validate(builderOutput)
    if (importValidation.fixedCount > 0) {
      builderOutput = importValidation.xml
      logger.success(`ImportValidator: fixed ${importValidation.fixedCount} import violation(s)`)
      for (const v of importValidation.violations.slice(0, 3)) {
        logger.info(`  Fixed: '${v.importPath}' → ${v.correction}`)
      }
    } else {
      logger.info('ImportValidator: no violations found')
    }

    // ── [8] UIEngine: deterministic fixes before quality gate ──────────────
    const uiEngine = new UIEngine()
    const uiResult = uiEngine.fix(builderOutput)
    if (uiResult.fixCount > 0) {
      builderOutput = uiResult.xml
      logger.success(`UIEngine applied ${uiResult.fixCount} fix(es): ${uiResult.fixes.join(', ')}`)
    } else {
      logger.info('UIEngine: no violations found')
    }

    // Code review pass — fix syntax errors before writing to disk
    builderOutput = uiResult.xml
    try {
      const reviewPrompt = `Review this generated Next.js code XML and fix ANY syntax errors, unclosed JSX tags, unterminated strings, or truncated files. Return the complete fixed XML only:\n\n${builderOutput.slice(0, 15000)}`
      const reviewedCode = await streamFromLLM(
        reviewPrompt,
        provider,   // use actual pipeline provider — was hardcoded 'gemini', caused 401 for Anthropic/OpenAI users
        apiKey,     // use actual API key — was using geminiKey which may be undefined
        'You are a code reviewer. Fix all syntax errors in the XML. Return only the fixed XML. Never truncate.',
        { maxOutputTokens: 8000 }
      )
      if (reviewedCode && reviewedCode.includes('<zozo_action')) {
        builderOutput = reviewedCode
        outputChannel.appendLine('[REVIEW] \u2705 Code review pass complete')
      }
    } catch (reviewErr: unknown) {
      outputChannel.appendLine(`[REVIEW] \u26A0\uFE0F Review skipped: ${reviewErr instanceof Error ? reviewErr.message : String(reviewErr)}`)
    }

    // Builder step complete — quality gate runs AFTER files are written to disk
    sessionState.checkpoint(
      session.id, 5, STEP.BUILD,
      `${builderOutput.length} chars generated`,
      undefined,
      stepStart
    );
    bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 6, stepName: STEP.BUILD })
    WorkspaceGuard.getInstance().updateStep('Building');

    // ── [10] VALIDATOR AGENT ───────────────────────────────────────────────
    let validatedXML = builderOutput;

    if (decision.steps.validate) {
      stepStart = Date.now();
      bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 7, stepName: STEP.VALIDATE })
      logger.step('Step 6 — Validator Agent');

      try {
        const validatorCtx = ctxFactory.forValidator(builderOutput);
        const report = await runValidatorAgentWithContext(validatorCtx, plan);
        logger.info(`Issues found: ${report.issues.length}`);

        if (report.status === "has_issues") {
          for (const issue of report.issues) {
            logger.warning(`[${issue.file}] ${issue.problem} → ${issue.fix}`);
          }
          if (report.missingPackages.length > 0) {
            logger.warning(`Missing packages: ${report.missingPackages.join(", ")}`);
          }
          if (report.missingFiles.length > 0) {
            logger.warning(`Missing files: ${report.missingFiles.join(", ")}`);
          }
          validatedXML = builderOutput + "\n" + report.fixedCode;
        } else {
          logger.success('Code is clean.');
        }
      } catch (err: unknown) {
        logger.warning(`Validator skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
      sessionState.checkpoint(session.id, 6, STEP.VALIDATE, `validation complete`, undefined, stepStart);
      bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 7, stepName: STEP.VALIDATE })
      WorkspaceGuard.getInstance().updateStep('Validating');
    } else {
      logger.info('⏭ Validate skipped (express mode)');
    }

    // ── [11] PARALLEL AGENTS: Security + SEO + Performance ────────────────
    const needsParallel = decision.steps.security || decision.steps.seo || decision.steps.performance;
    let securityResult: string | null = null;
    let seoResult: string | null = null;
    let perfResult: string | null = null;
    let securedXML = validatedXML;
    let seoExtra = "";
    let perfExtra = "";

    if (needsParallel) {
      if (bus.isCancelled()) { logger.warning('Build cancelled by user'); bus.reset(); return }
      stepStart = Date.now();
      bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 8, stepName: 'security+seo+perf' })

      const activeLabels: string[] = [];
      if (decision.steps.security) activeLabels.push('Security');
      if (decision.steps.seo) activeLabels.push('SEO');
      if (decision.steps.performance) activeLabels.push('Performance');
      logger.step(`Steps 7-9 — ${activeLabels.join(' + ')} (parallel)`);

      const parallelQueue = new TaskQueue();
      const taskEntries: Array<{ priority: number; label: string; run: () => Promise<string | null> }> = [];

      const secTask = createTask({ title: 'Security', description: `scan ${validatedXML.length} chars`, assignee: 'security' });
      const seoTask = createTask({ title: 'SEO', description: `${plan.filesToCreate?.length ?? 0} files planned`, assignee: 'seo' });
      const perfTask = createTask({ title: 'Performance', description: `scan ${validatedXML.length} chars`, assignee: 'performance' });

      if (decision.steps.security) {
        parallelQueue.add(secTask);
        taskEntries.push({
          priority: 0, label: 'security',
          run: async () => {
            parallelQueue.update(secTask.id, { status: 'in_progress' });
            let attempts = 0;
            while (attempts < 2) {
              try {
                const secCtx = ctxFactory.forSecurity(validatedXML, 0);
                const result = await runSecurityAgentWithContext(secCtx);
                parallelQueue.complete(secTask.id, result ? 'fixes applied' : 'clean');
                return result;
              } catch (err: unknown) {
                attempts++;
                if (attempts >= 2) {
                  parallelQueue.fail(secTask.id, String(err));
                  logger.warning(`Security failed after 2 attempts`);
                  return null;
                }
                logger.info(`Security retry ${attempts}/2...`);
                await new Promise(r => setTimeout(r, 1000));
              }
            }
            return null;
          },
        });
      }

      if (decision.steps.seo) {
        parallelQueue.add(seoTask);
        taskEntries.push({
          priority: 1, label: 'seo',
          run: async () => {
            parallelQueue.update(seoTask.id, { status: 'in_progress' });
            try {
              const seoCtx = ctxFactory.forSEO(plan);
              const result = await runSEOAgentWithContext(seoCtx, plan);
              parallelQueue.complete(seoTask.id, result ? 'generated' : 'skipped');
              return result;
            } catch (err: unknown) {
              parallelQueue.fail(seoTask.id, String(err));
              logger.warning(`SEO skipped: ${err instanceof Error ? err.message : String(err)}`);
              return null;
            }
          },
        });
      }

      if (decision.steps.performance) {
        parallelQueue.add(perfTask);
        taskEntries.push({
          priority: 1, label: 'performance',
          run: async () => {
            parallelQueue.update(perfTask.id, { status: 'in_progress' });
            try {
              const perfCtx = ctxFactory.forPerformance(validatedXML, plan);
              const result = await runPerformanceAgentWithContext(perfCtx, plan);
              parallelQueue.complete(perfTask.id, result ? 'applied' : 'clean');
              return result;
            } catch (err: unknown) {
              parallelQueue.fail(perfTask.id, String(err));
              logger.warning(`Performance skipped: ${err instanceof Error ? err.message : String(err)}`);
              return null;
            }
          },
        });
      }

      logger.info(`TaskQueue: ${taskEntries.length} tasks queued`);
      const parallelResults = await runPrioritized(taskEntries);

      // Map results back to named variables
      let idx = 0;
      if (decision.steps.security) securityResult = parallelResults[idx++] ?? null;
      if (decision.steps.seo) seoResult = parallelResults[idx++] ?? null;
      if (decision.steps.performance) perfResult = parallelResults[idx++] ?? null;

      if (securityResult) {
        logger.success('Security fixes applied.');
        securedXML = validatedXML + "\n" + securityResult;
      }
      if (seoResult) { logger.success('SEO files generated.'); seoExtra = seoResult; }
      if (perfResult) { logger.success('Performance optimizations applied.'); perfExtra = perfResult; }

      sessionState.checkpoint(session.id, 7, STEP.SECURITY, `parallel agents complete`, undefined, stepStart);
      bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 8, stepName: 'security+seo+perf' })
      WorkspaceGuard.getInstance().updateStep('Security + SEO + Performance');
    } else {
      logger.info('⏭ Security + SEO + Performance skipped (express mode)');
    }

    // Combine all XML
    let combinedXML = securedXML;
    if (seoExtra) combinedXML += "\n" + seoExtra;
    if (perfExtra) combinedXML += "\n" + perfExtra;

    // ── [12] DEVOPS AGENT ──────────────────────────────────────────────────
    let finalXML = combinedXML;

    if (decision.steps.devops) {
      stepStart = Date.now();
      bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 9, stepName: STEP.DEVOPS })
      logger.step('Step 10 — DevOps Agent');

      try {
        const devopsCtx = ctxFactory.forDevOps(plan, securityResult, seoResult, perfResult);
        const devopsFiles = await runDevOpsAgentWithContext(devopsCtx, plan);
        if (devopsFiles) {
          logger.success('DevOps configs generated.');
          finalXML = combinedXML + "\n" + devopsFiles;
        } else {
          logger.warning('DevOps skipped.');
        }
      } catch (err: unknown) {
        logger.warning(`DevOps skipped: ${err instanceof Error ? err.message : String(err)}`);
      }

      sessionState.checkpoint(session.id, 8, STEP.DEVOPS, `devops config generated`, undefined, stepStart);
      bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 9, stepName: STEP.DEVOPS })
      WorkspaceGuard.getInstance().updateStep('DevOps');
    } else {
      logger.info('⏭ DevOps skipped');
    }

    // ── [13] SANITIZE XML (CodeGuard) ──────────────────────────────────────
    logger.step('Step 11 — CodeGuard Sanitize');
    const sanitizedXML = sanitizeNestedActions(finalXML);
    const nestedFixed = finalXML.length !== sanitizedXML.length;
    if (nestedFixed) {
      logger.success('Fixed nested <zozo_action> blocks.');
    } else {
      logger.success('XML integrity clean.');
    }

    // ── [14] EXECUTE — write files to disk ─────────────────────────────────
    if (bus.isCancelled()) { logger.warning('Build cancelled by user'); bus.reset(); return }
    stepStart = Date.now();
    bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 10, stepName: STEP.EXECUTE })
    logger.step('[14] Execute — writing files');

    const { fileCount, filesWritten } = await executeActions(sanitizedXML, workspaceRoot, outputChannel, provider, apiKey);

    if (filesWritten.length === 0) {
      outputChannel.appendLine('[ZOZO] \u26A0\uFE0F ProjectMemory: no files tracked \u2014 possible execution failure')
    }

    sessionState.checkpoint(
      session.id, 9, STEP.EXECUTE,
      `${fileCount} files written`,
      { fileCount },
      stepStart
    );
    bus.emit({ type: 'step_complete', sessionId: session.id, stepNumber: 10, stepName: STEP.EXECUTE })
    WorkspaceGuard.getInstance().updateStep('Writing files');

    // Save project memory
    const previousState = loadProjectState(workspaceRoot)
    const projectState = buildProjectState(
      workspaceRoot,
      userPrompt,
      template,
      filesWritten,
      plan.techStack,
      previousState
    )
    saveProjectState(workspaceRoot, projectState)
    outputChannel.appendLine('[ZOZO] \uD83E\uDDE0 Project memory saved \u2192 .zozo-memory.json')

    // ── [14.2] CODEGUARD POST-WRITE HEALING — activates healing pipeline that was previously dead code ──
    logger.step('[14.2] CodeGuard — self-repair + static templates + export verify');
    try {
      const { repairWrittenFiles, ensureStaticTemplates, verifyExports, scrubEmbeddedXML } = await import('./CodeGuard');

      const xmlScrubbed = scrubEmbeddedXML(workspaceRoot, outputChannel);
      if (xmlScrubbed > 0) logger.info(`CodeGuard 1b: scrubbed ${xmlScrubbed} file(s) with embedded XML`);

      const repaired = repairWrittenFiles(filesWritten, workspaceRoot, outputChannel);
      logger.info(`CodeGuard repair: ${repaired}/${filesWritten.length} file(s) fixed`);

      ensureStaticTemplates(workspaceRoot, outputChannel);

      const exportFixed = verifyExports(workspaceRoot, outputChannel);
      if (exportFixed > 0) logger.info(`CodeGuard exports: fixed ${exportFixed} missing export(s)`);
    } catch (cgErr: unknown) {
      logger.warning(`CodeGuard post-write: ${cgErr instanceof Error ? cgErr.message : String(cgErr)}`);
    }

    // ── [14.1] PAGE.TSX FALLBACK — ensure page.tsx always exists ───────────
    const pagePath = path.join(workspaceRoot, 'app', 'page.tsx');
    if (!fs.existsSync(pagePath)) {
      logger.warning('page.tsx missing \u2014 generating static fallback');
      const componentsDir = path.join(workspaceRoot, 'components');
      let pageContent = `export default function Home() {\n  return (\n    <main className="bg-black min-h-screen">\n      <h1 className="text-white text-4xl p-8">Welcome</h1>\n    </main>\n  )\n}\n`;

      if (fs.existsSync(componentsDir)) {
        try {
          const components = fs.readdirSync(componentsDir)
            .filter((f: string) => f.endsWith('.tsx') && f !== 'ErrorBoundary.tsx')
            .map((f: string) => f.replace('.tsx', ''));

          if (components.length > 0) {
            const imports = components.map((c: string) => `import ${c} from '@/components/${c}'`).join('\n');
            const jsxTags = components.map((c: string) => `      <${c} />`).join('\n');
            pageContent = `${imports}\n\nexport default function Home() {\n  return (\n    <main className="bg-black min-h-screen">\n${jsxTags}\n    </main>\n  )\n}\n`;
          }
        } catch { }
      }

      const wrote = await atomicWrite(workspaceRoot, 'app/page.tsx', pageContent);
      if (wrote) {
        logger.success('Generated page.tsx with all components (atomic)');
      } else {
        // Fallback: write directly if atomicWrite rejects
        fs.mkdirSync(path.dirname(pagePath), { recursive: true });
        fs.writeFileSync(pagePath, pageContent, 'utf8');
        logger.success('Generated page.tsx with all components (fallback)');
      }
    }

    // ── [14.6] RULES AGENT — strict rule enforcement (zero LLM) ────────────
    if (bus.isCancelled()) { logger.warning('Build cancelled by user'); bus.reset(); return }
    logger.step('[14.6] RulesAgent — strict rule enforcement (zero API cost)');
    const rulesAgent = new RulesAgent(outputChannel, workspaceRoot);
    const rulesResult = await rulesAgent.enforce();
    logger.success(`RulesAgent: ${rulesResult.fixed} fixed, ${rulesResult.violations} remaining violations`);

    // ── [14.5] QUALITY GATE — runs AFTER files exist on disk ──────────────
    logger.step('[14.5] Quality Gate')

    const qg = new QualityGate()
    let qgScore = await qg.evaluate(workspaceRoot, session.id)
    logger.qualityResult(qg.formatResult(qgScore))
    logger.score(`Quality Gate: ${qgScore.verdict} (${qgScore.overall}/100)`)

    // Express mode: max 1 quality attempt — no retries (saves API calls)
    const MAX_QUALITY_RETRIES = decision.mode === 'express' ? 1 : 3
    let qualityAttempt = 1

    while (qgScore.verdict === 'NEEDS_WORK' && qualityAttempt < MAX_QUALITY_RETRIES) {
      qualityAttempt++

      // Dynamic escalation: if we're on attempt 2, escalate to standard
      if (qualityAttempt === 2 && decision.mode !== 'full') {
        decision = {
          ...decision,
          mode: 'standard',
          steps: { ...decision.steps, validate: true, seo: true },
          reasoning: `Auto-escalated to standard after quality gate failure (score: ${qgScore.overall}/100)`,
        }
        logger.info(`Pipeline escalated: → standard (quality score too low: ${qgScore.overall}/100)`)
        bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 0, stepName: 'escalated to standard mode' })
      }

      // On attempt 3: escalate fully regardless of current mode
      if (qualityAttempt === 3 && decision.mode !== 'full') {
        decision = {
          ...decision,
          mode: 'full',
          steps: { resourceFetch: true, design: true, validate: true, security: true, seo: true, performance: true, devops: false, suggest: false },
          reasoning: 'Auto-escalated to full mode after 2 quality gate failures',
        }
        logger.info('Pipeline escalated: → full mode (final attempt)')
      }

      logger.warning(`Quality gate failed (${qgScore.overall}/100). Retry ${qualityAttempt}/${MAX_QUALITY_RETRIES}...`)

      // Show VS Code warning with the top failing issue
      const topIssue = qgScore.issues[0] ?? 'Output quality too low'
      vscode.window.showWarningMessage(
        `ZOZO Quality Gate: NEEDS_WORK (${qgScore.overall}/100) — ${topIssue}. Regenerating...`
      )

      // Build the fix prompt from the score
      const fixPrompt = qg.buildFixPrompt(qgScore, qualityAttempt)

      // Extract component props for retry constraints (prevents prop hallucination)
      const propConstraints = new PropConstraints()
      const extractedProps = propConstraints.extract(workspaceRoot)
      const propConstraintHint = propConstraints.toConstraintPrompt(extractedProps)
      const fullFixPrompt = fixPrompt + (propConstraintHint ? '\n\n' + propConstraintHint : '')

      try {
        logger.info('Re-running BuilderAgent with fix prompt (context-aware)...')
        if (extractedProps.length > 0) {
          logger.info(`PropConstraints: injected ${extractedProps.length} component constraint(s) into retry`)
        }

        // Re-run the builder step with fix instructions via AgentContext
        const builderCtx = ctxFactory.forBuilder(plan, blueprint, '', '', compacted.packageConstraints, fullFixPrompt, template)
        builderOutput = await runBuilderAgentWithContext(builderCtx, plan, blueprint)

        logger.success(`Rebuild complete (${builderOutput.length} chars).`)

        // Re-execute fixed output to disk before re-scoring
        const retryImportValidation = importValidator.validate(builderOutput)
        builderOutput = retryImportValidation.xml
        const retryUiResult = uiEngine.fix(builderOutput)
        builderOutput = retryUiResult.xml
        await executeActions(sanitizeNestedActions(builderOutput), workspaceRoot, outputChannel, provider, apiKey)

        // Re-score — now scanning real updated files
        qgScore = await qg.evaluate(workspaceRoot, session.id)
        logger.qualityResult(qg.formatResult(qgScore))
        logger.score(`Quality Gate attempt ${qualityAttempt}: ${qgScore.verdict} (${qgScore.overall}/100)`)

        // Checkpoint the retry attempt with structured metrics
        sessionState.checkpoint(
          session.id,
          5,
          STEP.BUILD,
          `retry ${qualityAttempt}: ${qgScore.verdict} (${qgScore.overall}/100)`,
          {
            qualityScore: qgScore.overall,
            qualityVerdict: qgScore.verdict,
            retryCount: qualityAttempt,
            codeScore: qgScore.codeScore,
            designScore: qgScore.designScore,
          }
        )

      } catch (err: unknown) {
        logger.warning(`Quality retry ${qualityAttempt} failed: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }

    // Final gate result
    if (qgScore.verdict === 'WORLD_CLASS') {
      vscode.window.showInformationMessage(`✨ ZOZO Quality Gate: WORLD_CLASS (${qgScore.overall}/100)`)
      logger.success(`World-class output achieved after ${qualityAttempt} attempt(s)`)
    } else if (qgScore.verdict === 'ACCEPTABLE') {
      vscode.window.showInformationMessage(`✅ ZOZO Quality Gate: ACCEPTABLE (${qgScore.overall}/100)`)
      logger.success(`Acceptable output after ${qualityAttempt} attempt(s)`)
    } else {
      vscode.window.showWarningMessage(
        `⚠️ ZOZO Quality Gate: NEEDS_WORK (${qgScore.overall}/100) after ${MAX_QUALITY_RETRIES} attempts. Proceeding anyway.`
      )
      logger.warning(`Max retries reached. Proceeding with best output: ${qgScore.overall}/100`)
    }
    sessionState.checkpoint(
      session.id, 14, STEP.BUILD,
      `quality: ${qgScore.verdict} (${qgScore.overall}/100), ${qualityAttempt} attempt(s)`,
      {
        qualityScore: qgScore.overall,
        qualityVerdict: qgScore.verdict,
        retryCount: qualityAttempt,
        codeScore: qgScore.codeScore,
        designScore: qgScore.designScore,
      },
      stepStart
    );

    // ── [15] ENV HANDLER — detect required env vars ────────────────────────
    logger.step('[15] Env Handler')
    const envHandler = new EnvHandler()
    const envRequirements = envHandler.scan(workspaceRoot)
    if (envRequirements.length > 0) {
      envHandler.writeEnvFiles(workspaceRoot, envRequirements)
      logger.info(`Env: detected ${envRequirements.length} required variable(s) → .env.example created`)
      // Show guide (non-blocking — runs async)
      envHandler.showSetupGuide(envRequirements).catch(() => { })
    }

    // ── [16] DEPENDENCY RECONCILER — install missing packages ──────────────
    logger.step('[16] Dependency Reconciliation')
    const reconciler = new DependencyReconciler()
    const reconcileResult = await reconciler.reconcile(workspaceRoot)

    if (reconcileResult.missingInPackageJson.length > 0) {
      logger.success(`Added ${reconcileResult.missingInPackageJson.length} missing package(s): ${reconcileResult.missingInPackageJson.join(', ')}`)
    }
    if (reconcileResult.npmInstallRan) {
      logger.info(`npm install: ${reconcileResult.installSuccess ? '✅ success' : '⚠ failed'}`)
    }
    if (reconcileResult.brokenImportPaths.length > 0) {
      for (const broken of reconcileResult.brokenImportPaths) {
        logger.warning(`Broken import in ${broken.file}: '${broken.importPath}'${broken.suggestion ? ` → try '${broken.suggestion}'` : ''}`)
      }
    }

    // ── [16.5] API CONTRACT VALIDATION ─────────────────────────────────────
    if (decision.mode !== 'express') {
      logger.step('[16.5] API Contract Validation')
      const apiValidator = new APIContractValidator()
      const contractResult = apiValidator.validate(workspaceRoot)

      if (contractResult.passed) {
        logger.success(`API contracts: ${contractResult.routes.length} route(s), ${contractResult.calls.length} call(s) — all valid`)
      } else {
        logger.warning(`API contract: ${contractResult.violations.length} violation(s)`)
        for (const v of contractResult.violations.slice(0, 5)) {
          logger.warning(`  ${v.detail}`)
        }
        // One fix attempt for contract violations
        if (contractResult.fixPrompt) {
          try {
            const contractFixCtx = ctxFactory.forBuilder(
              plan, blueprint, '', '', compacted.packageConstraints, contractResult.fixPrompt, template
            )
            const contractFix = await runBuilderAgentWithContext(contractFixCtx, plan, blueprint)
            const contractValidated = importValidator.validate(contractFix)
            const contractUi = uiEngine.fix(contractValidated.xml)
            await executeActions(contractUi.xml, workspaceRoot, outputChannel, provider, apiKey)
            logger.success('API contract fixes applied')
          } catch (err: unknown) {
            logger.warning(`API fix failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
    }

    // ── [17] BUILD VERIFICATION — TypeScript check ─────────────────────────
    logger.step('[17] Build Verification — TypeScript check')

    const buildVerifier = new BuildVerifier()
    let verifyResult = buildVerifier.verify(workspaceRoot, 1)

    if (verifyResult.passed) {
      logger.success('TypeScript: 0 errors — build is clean ✅')
      sessionState.checkpoint(session.id, 10, 'ts_verify', 'clean build', { tsErrors: 0 })
    } else {
      logger.warning(`TypeScript: ${verifyResult.errors.length} errors found. Auto-fixing...`)

      const MAX_FIX_ATTEMPTS = decision.mode === 'express' ? 1 : 3
      let fixAttempt = 0

      while (!verifyResult.passed && fixAttempt < MAX_FIX_ATTEMPTS) {
        fixAttempt++
        logger.info(`Fix attempt ${fixAttempt}/${MAX_FIX_ATTEMPTS}...`)

        bus.emit({
          type: 'step_start',
          sessionId: session.id,
          stepNumber: 10,
          stepName: `fixing TypeScript errors (attempt ${fixAttempt})`,
        })

        // Build fix prompt from errors
        const tsFixPrompt = buildVerifier.toFixPrompt(verifyResult)

        // Re-run builder with fix prompt — target only the broken files
        try {
          const fixCompacted = compactor.compact({
            designRules: '',
            memoryContext: '',
            workspaceContext: '',
            resourceHint: '',
            fixPrompt: tsFixPrompt,
          }, true)

          const fixCtx = ctxFactory.forBuilder(
            plan, blueprint,
            fixCompacted.designRules, '',
            fixCompacted.packageConstraints,
            fixCompacted.fixPrompt,
            template
          )
          const fixOutput = await runBuilderAgentWithContext(fixCtx, plan, blueprint)

          // Apply UIEngine to fix output too
          const fixUiResult = uiEngine.fix(fixOutput)
          const fixXML = fixUiResult.xml

          // Re-execute only — write the fixed files
          const fixResult = await executeActions(fixXML, workspaceRoot, outputChannel, provider, apiKey)
          logger.info(`Rewrote ${fixResult.fileCount} files with TypeScript fixes`)

          // Re-verify
          verifyResult = buildVerifier.verify(workspaceRoot, fixAttempt + 1)

          if (verifyResult.passed) {
            logger.success(`TypeScript: clean after ${fixAttempt} fix attempt(s) ✅`)
            sessionState.checkpoint(session.id, 10, 'ts_verify', `clean after ${fixAttempt} fix(es)`, {
              tsErrors: 0,
              fixAttempts: fixAttempt,
            })
            break
          } else {
            logger.warning(`Still ${verifyResult.errors.length} errors after attempt ${fixAttempt}`)
          }
        } catch (err: unknown) {
          logger.warning(`Fix attempt ${fixAttempt} failed: ${err instanceof Error ? err.message : String(err)}`)
          break
        }
      }

      if (!verifyResult.passed) {
        logger.warning(`TypeScript: ${verifyResult.errors.length} errors remain after ${MAX_FIX_ATTEMPTS} attempts`)
        sessionState.checkpoint(session.id, 10, 'ts_verify', `${verifyResult.errors.length} errors remain`, {
          tsErrors: verifyResult.errors.length,
        })
      }
    }

    // ── [17.5] PROJECT-LEVEL VALIDATION GATE — runs after all files written ──
    outputChannel.appendLine('[ZOZO] \uD83D\uDD0D Running project-level validation...')

    const geminiKey = options?.geminiKey || ''
    let projectValid = false
    for (let round = 1; round <= 3; round++) {
      outputChannel.appendLine(`[ZOZO] \uD83D\uDD28 Validation round ${round}/3...`)

      // Step 1: tsc full project check
      let allErrors: string[] = []
      try {
        const tsc = await execPromise('npx tsc --noEmit 2>&1', { cwd: workspaceRoot, timeout: 40000 })
        allErrors = (tsc.stdout + tsc.stderr).match(/error TS\d+:.*/g) || []
      } catch (e: any) {
        allErrors = (((e.stdout || '') + (e.stderr || '')) as string).match(/error TS\d+:.*/g) || []
      }

      if (allErrors.length === 0) {
        outputChannel.appendLine('[ZOZO] \u2705 Project valid \u2014 0 TypeScript errors')
        projectValid = true
        break
      }

      outputChannel.appendLine(`[ZOZO] \u274C ${allErrors.length} errors found \u2014 running cross-file repair...`)

      // Step 2: Build dependency context
      const fileErrors: Record<string, string[]> = {}
      for (const err of allErrors) {
        const m = err.match(/^(.+?\.tsx?)\(/)
        if (m) {
          const f = m[1].trim()
          if (!fileErrors[f]) fileErrors[f] = []
          fileErrors[f].push(err)
        }
      }

      // Step 3: Read related files for context (glob-free)
      const tsxDirs = ['app', 'components', 'lib']
      const allTsxFiles: string[] = []
      for (const dir of tsxDirs) {
        const dirPath = path.join(workspaceRoot, dir)
        if (!fs.existsSync(dirPath)) continue
        try {
          const entries = fs.readdirSync(dirPath)
          for (const entry of entries) {
            if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
              allTsxFiles.push(path.join(dir, entry))
            }
          }
        } catch {}
      }

      const fileContents: Record<string, string> = {}
      for (const f of allTsxFiles.slice(0, 10)) {
        const abs = path.join(workspaceRoot, f)
        if (fs.existsSync(abs)) {
          fileContents[f] = fs.readFileSync(abs, 'utf8').slice(0, 500)
        }
      }

      const projectContext = Object.entries(fileContents)
        .map(([f, c]) => `// ${f}\n${c}`)
        .join('\n\n---\n\n')
        .slice(0, 3000)

      // Step 4: Cross-file repair each broken file
      const repairProvider = geminiKey ? 'gemini' : provider
      const repairKey = geminiKey || apiKey

      for (const [filePath, errors] of Object.entries(fileErrors)) {
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath)
        if (!fs.existsSync(absPath)) continue

        const content = fs.readFileSync(absPath, 'utf8')

        const prompt = `Fix ALL TypeScript errors in this file. Return ONLY the complete fixed file.

TARGET FILE: ${path.basename(filePath)}
ERRORS:
${errors.join('\n')}

PROJECT CONTEXT (other files \u2014 match imports/props/types with these):
${projectContext}

RULES:
- Fix errors to match the project context above
- 'use client' must be first line if file uses hooks
- Never add 'use client' to layout.tsx
- Use only: next, react, framer-motion, lucide-react, recharts, clsx
- All JSX must be closed
- Return complete file only

CURRENT FILE:
${content}`

        try {
          const fixed = await streamFromLLM(prompt, repairProvider, repairKey,
            'TypeScript expert. Fix errors using project context. Return complete file only.',
            { maxOutputTokens: 6000 }
          )
          if (fixed && fixed.length > 100) {
            const clean = fixed.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
            const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/')
            const wrote = await atomicWrite(workspaceRoot, relPath, clean)
            if (wrote) {
              outputChannel.appendLine(`[ZOZO] \u2705 Cross-repaired (atomic): ${path.basename(filePath)}`)
            } else {
              // atomicWrite rejected — write directly as fallback
              fs.writeFileSync(absPath, clean, 'utf8')
              outputChannel.appendLine(`[ZOZO] \u2705 Cross-repaired (fallback): ${path.basename(filePath)}`)
            }
          }
        } catch {
          outputChannel.appendLine(`[ZOZO] \u274C Repair failed: ${path.basename(filePath)}`)
        }
      }
    }

    if (!projectValid) {
      outputChannel.appendLine('[ZOZO] \u26A0\uFE0F Launching with remaining errors \u2014 check Problems panel')
    } else {
      outputChannel.appendLine('[ZOZO] \uD83D\uDE80 Project validated \u2014 launching dev server')
    }

    // ── [18] RUNTIME VERIFICATION (standard/full mode only) ────────────────
    let runtimePassed = false
    if (decision.mode !== 'express' && verifyResult.passed) {
      logger.step('[18] Runtime Verification — starting dev server')
      logger.info('Starting dev server to check for runtime errors...')
      bus.emit({ type: 'step_start', sessionId: session.id, stepNumber: 11, stepName: 'runtime-check' })

      const runtimeVerifier = new RuntimeVerifier()
      const runtimeResult = await runtimeVerifier.verify(workspaceRoot)

      if (runtimeResult.passed) {
        runtimePassed = true
        logger.success(`Runtime: clean — server started in ${Math.round(runtimeResult.timeoutMs / 1000)}s`)
      } else {
        const fixable = runtimeResult.errors.filter(e => e.fixable)
        if (fixable.length > 0) {
          logger.warning(`Runtime: ${fixable.length} fixable error(s) — auto-fixing`)
          const runtimeFixPrompt = runtimeVerifier.toFixPrompt(runtimeResult)

          // One fix attempt for runtime errors
          try {
            const runtimeFixCtx = ctxFactory.forBuilder(plan, blueprint, '', '', compacted.packageConstraints, runtimeFixPrompt, template)
            const runtimeFix = await runBuilderAgentWithContext(runtimeFixCtx, plan, blueprint)
            const runtimeUi = uiEngine.fix(runtimeFix)
            await executeActions(runtimeUi.xml, workspaceRoot, outputChannel, provider, apiKey)
            logger.success('Runtime fixes applied')
          } catch (err: unknown) {
            logger.warning(`Runtime fix failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        } else {
          logger.warning(`Runtime: ${runtimeResult.errors.length} non-fixable error(s)`)
          for (const e of runtimeResult.errors) {
            logger.warning(`  ${e.type}: ${e.message.slice(0, 80)}`)
          }
        }
      }
    }

    // ── [19] DEPLOY (full mode only, clean build only) ─────────────────────
    let deployUrl: string | undefined
    if (decision.mode === 'full') {
      logger.step('[19] Deploy')
      const deployAgent = new DeployAgent()

      if (verifyResult.passed) {
        const projectName = userPrompt.split(' ').slice(0, 3).join('-').toLowerCase()
        const deployResult = await deployAgent.deploy(workspaceRoot, projectName)

        if (deployResult.success && deployResult.url) {
          deployUrl = deployResult.url
          logger.success(`Deployed: ${deployResult.url}`)
          vscode.window.showInformationMessage(
            `✅ ZOZO deployed your app: ${deployResult.url}`,
            'Open in Browser'
          ).then(choice => {
            if (choice === 'Open in Browser') {
              vscode.env.openExternal(vscode.Uri.parse(deployResult.url!))
            }
          })
        } else if (deployResult.skipped) {
          logger.info(`Deploy skipped: ${deployResult.skipReason}`)
        } else {
          logger.warning(`Deploy failed: ${deployResult.error}`)
        }
      } else {
        logger.warning('Deploy skipped: TypeScript errors not resolved')
      }
    }

    // ── [20] SUGGESTIONS ──────────────────────────────────────────────────
    if (decision.steps.suggest) {
      logger.step('[20] Suggestions');

      try {
        const suggestions = await runSuggestionAgent(userPrompt, plan, provider, apiKey);
        if (suggestions.length > 0) {
          logger.info('Suggestions:');
          for (const s of suggestions) {
            logger.info(`  💡 ${s}`);
          }
          showSuggestions(suggestions);
        }
      } catch {
        logger.info('Suggestions skipped (non-critical).');
      }
    } else {
      logger.info('⏭ Suggestions skipped');
    }

    // ── [21] LEARNING — record outcomes ────────────────────────────────────
    sessionState.markComplete(session.id);

    // Record supervisor decision outcome for future learning
    const finalScore = qgScore?.overall ?? 0
    try {
      const totalDuration = Date.now() - pipelineStartTime
      supervisor.getMemory().record(userPrompt, decision.mode, finalScore, totalDuration)
      logger.info(`Supervisor memory updated: ${decision.mode} mode → score ${finalScore}/100`)
    } catch { }

    // Record build in user profile for personalization
    try {
      userProfile.recordBuild(userPrompt, template, finalScore, provider, finalScore >= 65)
      logger.info(`👤 User profile updated (build #${userProfile.getProfile().buildCount})`)
    } catch { }

    // Trigger dream consolidation after successful build (async, non-blocking)
    try {
      const dreamEng = new DreamEngine();
      if (dreamEng.shouldDream()) {
        dreamEng.dream().catch(() => { });
        logger.info('🌙 Dream consolidation triggered');
      }
    } catch { }

    // ── [21.5] SMOKE TESTS — generate proof-of-build tests ────────────────
    const smokeGen = new SmokeTestGenerator()
    const smokeResult = smokeGen.generate(workspaceRoot)
    if (smokeResult.testsGenerated > 0) {
      logger.success(`Smoke tests: generated ${smokeResult.testsGenerated} tests → ${smokeResult.testFilePath}`)
      logger.info('Run: npx vitest run to verify the build')
    }

    // ── [22] HEALTH CHECK — final pass/fail report ─────────────────────────
    const healthCheck = new HealthCheck()
    const tsVerifyStep = sessionState.load(session.id)?.steps.find(s => s.stepName === 'ts_verify')
    const healthTsErrors = (tsVerifyStep?.metrics?.tsErrors as number) ?? (verifyResult.passed ? 0 : verifyResult.errors.length)
    const requiredEnvCount = envRequirements.filter(e => e.required).length

    const healthReport = healthCheck.run(workspaceRoot, {
      tsErrorCount: healthTsErrors,
      runtimePassed: runtimePassed,
      envMissing: requiredEnvCount,
      depsInstalled: reconcileResult.installSuccess,
      qualityScore: finalScore,
      fileCount,
      deployUrl,
    })

    logger.info(`Health: ${healthReport.score}/100 — ${healthReport.overall}`)

    // Show health report webview (non-blocking) if issues exist
    if (healthReport.overall !== 'ready' || healthReport.score < 90) {
      healthCheck.show(healthReport).catch(() => { })
    }

    // ── COMPLETE ───────────────────────────────────────────────────────────
    const sessionStats = tokenTracker.getSessionTotal(session.id);
    logger.step('Complete');
    logger.success(`${fileCount} files built. Health: ${healthReport.score}/100`);
    logger.cost(`Session cost: $${sessionStats.estimatedCostUsd.toFixed(4)} (${sessionStats.totalInputTokens.toLocaleString()} input, ${sessionStats.totalOutputTokens.toLocaleString()} output tokens)`);
    logger.cost(`All-time: $${tokenTracker.getAllTimeCostUsd().toFixed(2)}`);

    bus.emit({
      type: 'build_complete',
      sessionId: session.id,
      fileCount,
      totalCostUsd: sessionStats.estimatedCostUsd,
    })
    setModelOverrides(null, null, null)  // reset all model overrides for next run
    bus.reset()

    // Verify layout.tsx is clean before starting — enforce server component
    const layoutCheck = path.join(workspaceRoot, 'app', 'layout.tsx');
    if (fs.existsSync(layoutCheck)) {
      let layoutContent = fs.readFileSync(layoutCheck, 'utf8');
      const originalLayout = layoutContent;
      // Remove 'use client' from anywhere
      layoutContent = layoutContent.replace(/'use client'\s*\n?/g, '').trim();
      // Remove useEffect import
      layoutContent = layoutContent.replace(/import\s*{[^}]*useEffect[^}]*}\s*from\s*['"]react['"]\s*\n?/g, '');
      // Remove useEffect calls
      layoutContent = layoutContent.replace(/useEffect\([^)]*\)[^;]*;?\s*\n?/gs, '');
      if (layoutContent !== originalLayout) {
        fs.writeFileSync(layoutCheck, layoutContent, 'utf8');
        outputChannel.appendLine('[ZOZO] ✅ layout.tsx enforced as server component');
      }
    }

    if (healthReport.readyToRun) {
      vscode.window.showInformationMessage(
        `\u2705 ZOZO build complete \u2014 ${healthReport.score}/100 health. Ready: npm run dev`,
        'Open Preview'
      ).then(async choice => {
        if (choice === 'Open Preview') {
          const { getLivePreview } = await import('./LivePreview')
          const preview = getLivePreview()
          preview.start(workspaceRoot, outputChannel).catch(err => {
            outputChannel.appendLine(`[ZOZO Preview] ${err instanceof Error ? err.message : String(err)}`)
          })
        }
      })
    } else {
      vscode.window.showWarningMessage(
        `\u26A0\uFE0F ZOZO build complete with issues \u2014 check Build Health report`
      )
    }

  } finally {
    _pipelineRunning = false;  // Always reset — even on error/cancel
  }
}
