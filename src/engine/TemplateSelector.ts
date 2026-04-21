import type { RawResource } from './ResourceAgent'
import type { DesignRules } from './DesignRulesEngine'
import { ResourceScorer } from './ResourceScorer'

export interface ScoredResource {
  resource: RawResource
  score: number
  reasons: string[]
  recommended: boolean
}

export interface ResourceSelection {
  selected: ScoredResource[]
  rejected: ScoredResource[]
  strategy: 'generate' | 'hybrid' | 'reuse'
}

export class TemplateSelector {
  private scorer = new ResourceScorer()

  select(resources: RawResource[], _rules: DesignRules): ResourceSelection {
    const scored = resources.map(r => {
      const s = this.scorer.score(r)
      return {
        resource: r,
        score: s.score,
        reasons: s.reasons,
        recommended: false,
      } as ScoredResource
    })
    scored.sort((a, b) => b.score - a.score)

    // Raised threshold: only truly exceptional patterns pass
    const selected = scored.filter(s => s.score >= 80)
    const rejected = scored.filter(s => s.score < 80)

    if (selected.length > 0) selected[0]!.recommended = true

    // Always generate — Builder + DesignPresets beats shadcn patterns
    // hybrid only if we found something genuinely exceptional
    const topScore = selected[0]?.score ?? 0
    const strategy: ResourceSelection['strategy'] =
      selected.length === 0 ? 'generate'
        : topScore >= 90 ? 'hybrid'   // reference only, never reuse
          : 'generate'                        // default: builder from scratch

    return {
      selected: selected.slice(0, 2),   // max 2, was 3
      rejected,
      strategy,
    }
  }
}