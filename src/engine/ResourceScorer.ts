import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import type { RawResource } from './ResourceAgent'

export interface ResourceScore {
  name: string
  source: string
  score: number
  reasons: string[]
  isProven: boolean
}

export interface ResourceOutcome {
  name: string
  source: string
  qualityDelta: number   // quality score after - quality score before using this resource
  timestamp: string
}

/**
 * ResourceScorer
 *
 * Single responsibility: score resources and track outcomes.
 * Extracted from ResourceAgent (outcome tracking) and TemplateSelector (scoring).
 *
 * TemplateSelector calls this instead of having its own scoring logic.
 * ResourceAgent calls this for outcome tracking.
 * Both get the same source of truth.
 */
export class ResourceScorer {
  private outcomesPath: string
  private outcomes: ResourceOutcome[] = []

  constructor() {
    const dir = path.join(os.homedir(), '.zozo', 'resource-cache')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.outcomesPath = path.join(dir, 'resource-outcomes.json')
    this.load()
  }

  score(resource: RawResource): ResourceScore {
    let score = 50
    const reasons: string[] = []

    if (resource.hasAnimation) { score += 20; reasons.push('+20 animations') }
    else                        { score -= 10; reasons.push('-10 no animations') }

    if (resource.hasDarkMode)   { score += 15; reasons.push('+15 dark mode') }
    else                        { score -= 5;  reasons.push('-5 light only') }

    if (resource.hasTailwind)   { score += 10; reasons.push('+10 tailwind') }

    if (resource.tags.includes('glass'))    { score += 10; reasons.push('+10 glass') }
    if (resource.tags.includes('gradient')) { score += 5;  reasons.push('+5 gradient') }
    if (resource.tags.includes('proven'))   { score += 15; reasons.push('+15 proven') }

    if (resource.source === 'aceternity')   { score += 10; reasons.push('+10 aceternity') }
    else if (resource.source === 'shadcn')  { score += 5;  reasons.push('+5 shadcn') }

    if (resource.code.length > 3500)        { score -= 10; reasons.push('-10 bloated') }

    return {
      name: resource.name,
      source: resource.source,
      score: Math.min(100, Math.max(0, score)),
      reasons,
      isProven: resource.tags.includes('proven'),
    }
  }

  recordOutcome(name: string, source: string, qualityBefore: number, qualityAfter: number): void {
    this.outcomes.push({
      name, source,
      qualityDelta: qualityAfter - qualityBefore,
      timestamp: new Date().toISOString(),
    })
    if (this.outcomes.length > 200) this.outcomes = this.outcomes.slice(-200)
    this.save()
  }

  getProvenNames(): Set<string> {
    const proven = new Set<string>()
    const grouped: Record<string, number[]> = {}
    for (const o of this.outcomes) {
      const key = `${o.source}:${o.name}`
      if (!grouped[key]) grouped[key] = []
      grouped[key]!.push(o.qualityDelta)
    }
    for (const [key, deltas] of Object.entries(grouped)) {
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
      if (avg > 0 && deltas.length >= 2) {
        proven.add(key.split(':')[1]!)
      }
    }
    return proven
  }

  private load(): void {
    try {
      if (fs.existsSync(this.outcomesPath)) {
        this.outcomes = JSON.parse(fs.readFileSync(this.outcomesPath, 'utf8'))
      }
    } catch { this.outcomes = [] }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.outcomesPath, JSON.stringify(this.outcomes, null, 2), 'utf8')
    } catch {}
  }
}
