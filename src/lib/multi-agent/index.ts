/**
 * @fileoverview open-multi-agent — public API surface.
 *
 * Import from `'open-multi-agent'` to access everything you need:
 *
 * ```ts
 * import { OpenMultiAgent, Agent, Team, defineTool } from 'open-multi-agent'
 * ```
 *
 * ## Quickstart
 *
 * ### Single agent
 * ```ts
 * const orchestrator = new OpenMultiAgent({ defaultModel: 'claude-opus-4-6' })
 * const result = await orchestrator.runAgent(
 *   { name: 'assistant', model: 'claude-opus-4-6' },
 *   'Explain monads in one paragraph.',
 * )
 * console.log(result.output)
 * ```
 *
 * ### Multi-agent team (auto-orchestrated)
 * ```ts
 * const orchestrator = new OpenMultiAgent()
 * const team = orchestrator.createTeam('writers', {
 *   name: 'writers',
 *   agents: [
 *     { name: 'researcher', model: 'claude-opus-4-6', systemPrompt: 'You research topics thoroughly.' },
 *     { name: 'writer',     model: 'claude-opus-4-6', systemPrompt: 'You write clear documentation.' },
 *   ],
 *   sharedMemory: true,
 * })
 * const result = await orchestrator.runTeam(team, 'Write a guide on TypeScript generics.')
 * console.log(result.agentResults.get('coordinator')?.output)
 * ```
 *
 * ### Custom tools
 * ```ts
 * import { z } from 'zod'
 *
 * const myTool = defineTool({
 *   name: 'fetch_data',
 *   description: 'Fetch JSON data from a URL.',
 *   inputSchema: z.object({ url: z.string().url() }),
 *   execute: async ({ url }) => {
 *     const res = await fetch(url)
 *     return { data: await res.text() }
 *   },
 * })
 * ```
 */

// ---------------------------------------------------------------------------
// Orchestrator (primary entry point)
// ---------------------------------------------------------------------------

export { OpenMultiAgent } from './orchestrator/orchestrator'
export { Scheduler } from './orchestrator/scheduler'
export type { SchedulingStrategy } from './orchestrator/scheduler'

// ---------------------------------------------------------------------------
// Agent layer
// ---------------------------------------------------------------------------

export { Agent } from './agent/agent'
export { AgentPool, Semaphore } from './agent/pool'
export type { PoolStatus } from './agent/pool'

// ---------------------------------------------------------------------------
// Team layer
// ---------------------------------------------------------------------------

export { Team } from './team/team'
export { MessageBus } from './team/messaging'
export type { Message } from './team/messaging'

// ---------------------------------------------------------------------------
// Task layer
// ---------------------------------------------------------------------------

export { TaskQueue } from './task/queue'
export { createTask, isTaskReady, getTaskDependencyOrder, validateTaskDependencies } from './task/task'
export type { TaskQueueEvent } from './task/queue'

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export { runPrioritized } from './scheduler'

// ---------------------------------------------------------------------------
// Tool system
// ---------------------------------------------------------------------------

export { defineTool, ToolRegistry, zodToJsonSchema } from './tool/framework'
export { ToolExecutor } from './tool/executor'
export type { ToolExecutorOptions, BatchToolCall } from './tool/executor'
export {
  registerBuiltInTools,
  BUILT_IN_TOOLS,
  bashTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  grepTool,
} from './tool/built-in/index'

// ---------------------------------------------------------------------------
// LLM adapters
// ---------------------------------------------------------------------------

export { createAdapter } from './llm/adapter'
export type { SupportedProvider } from './llm/adapter'

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export { InMemoryStore } from './memory/store'
export { SharedMemory } from './memory/shared'

// ---------------------------------------------------------------------------
// Types — all public interfaces re-exported for consumer type-checking
// ---------------------------------------------------------------------------

export type {
  // Content blocks
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ImageBlock,
  ContentBlock,

  // LLM
  LLMMessage,
  LLMResponse,
  LLMAdapter,
  LLMChatOptions,
  LLMStreamOptions,
  LLMToolDef,
  TokenUsage,
  StreamEvent,

  // Tools
  ToolDefinition,
  ToolResult,
  ToolUseContext,
  AgentInfo,
  TeamInfo,

  // Agent
  AgentConfig,
  AgentState,
  AgentRunResult,
  ToolCallRecord,

  // Team
  TeamConfig,
  TeamRunResult,

  // Task
  Task,
  TaskStatus,

  // Orchestrator
  OrchestratorConfig,
  OrchestratorEvent,

  // Memory
  MemoryEntry,
  MemoryStore,
} from './types'
