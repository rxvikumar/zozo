/**
 * AgentContext
 *
 * Immutable, agent-scoped data slice passed to each agent call.
 * Prevents agents from reading each other's mutable state directly.
 * Makes context explicit — if it's not in the context, the agent can't see it.
 */

export interface BaseAgentContext {
  readonly sessionId: string
  readonly provider: string
  readonly apiKey: string
  readonly workspaceRoot: string
  readonly userPrompt: string
}

export interface PlannerContext extends BaseAgentContext {
  readonly workspaceContext: string
  readonly template: string
  readonly designBlueprint: object
}

export interface BuilderContext extends BaseAgentContext {
  readonly plan: object
  readonly designBlueprint: object
  readonly designRulesSection: string
  readonly memoryContext: string
  readonly packageConstraints: string  // anti-hallucination constraint block
  readonly fixPrompt?: string   // only set on quality gate retries
}

export interface ValidatorContext extends BaseAgentContext {
  readonly builderOutput: string
}

export interface SecurityContext extends BaseAgentContext {
  readonly validatedXML: string
  readonly fileCount: number
}

export interface SEOContext extends BaseAgentContext {
  readonly plan: object
  readonly userPrompt: string
}

export interface PerformanceContext extends BaseAgentContext {
  readonly validatedXML: string
  readonly plan: object
}

export interface DevOpsContext extends BaseAgentContext {
  readonly plan: object
  readonly securityResult: string | null
  readonly seoResult: string | null
  readonly perfResult: string | null
}

export interface QualityContext extends BaseAgentContext {
  readonly workspaceRoot: string
  readonly attemptNumber: number
}

/**
 * Factory — builds agent-specific context objects from the Orchestrator's
 * shared state. Call once per agent, not once per pipeline run.
 */
export class AgentContextFactory {
  private base: BaseAgentContext

  constructor(base: BaseAgentContext) {
    this.base = Object.freeze({ ...base })
  }

  forPlanner(workspaceContext: string, template: string, designBlueprint: object): PlannerContext {
    return Object.freeze({ ...this.base, workspaceContext, template, designBlueprint })
  }

  forBuilder(
    plan: object,
    designBlueprint: object,
    designRulesSection: string,
    memoryContext: string,
    packageConstraints: string,
    fixPrompt?: string
  ): BuilderContext {
    return Object.freeze({ ...this.base, plan, designBlueprint, designRulesSection, memoryContext, packageConstraints, fixPrompt })
  }

  forValidator(builderOutput: string): ValidatorContext {
    return Object.freeze({ ...this.base, builderOutput })
  }

  forSecurity(validatedXML: string, fileCount: number): SecurityContext {
    return Object.freeze({ ...this.base, validatedXML, fileCount })
  }

  forSEO(plan: object): SEOContext {
    return Object.freeze({ ...this.base, plan, userPrompt: this.base.userPrompt })
  }

  forPerformance(validatedXML: string, plan: object): PerformanceContext {
    return Object.freeze({ ...this.base, validatedXML, plan })
  }

  forDevOps(
    plan: object,
    securityResult: string | null,
    seoResult: string | null,
    perfResult: string | null
  ): DevOpsContext {
    return Object.freeze({ ...this.base, plan, securityResult, seoResult, perfResult })
  }

  forQuality(attemptNumber: number): QualityContext {
    return Object.freeze({ ...this.base, attemptNumber })
  }
}
