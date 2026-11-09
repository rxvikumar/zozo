import * as https from 'https'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

export interface RawResource {
  source: 'shadcn' | 'aceternity' | 'github' | 'magicui'
  name: string
  description: string
  code: string           // raw component code
  tags: string[]         // ['hero', 'pricing', 'animation', 'glass', etc.]
  hasAnimation: boolean
  hasDarkMode: boolean
  hasTailwind: boolean
  fetchedAt: string
}

// Curated component registry — hand-picked, not random
// Each entry maps user intent keywords to specific known-good components

const SHADCN_REGISTRY_BASE = 'https://ui.shadcn.com/registry'
const ACETERNITY_RAW_BASE  = 'https://raw.githubusercontent.com/aceternity/ui/main/components'

// Map of intent keywords → shadcn component names (from public registry)
const SHADCN_COMPONENT_MAP: Record<string, string[]> = {
  pricing:     ['card', 'badge', 'button', 'separator'],
  hero:        ['button', 'badge'],
  dashboard:   ['card', 'chart', 'table', 'tabs'],
  auth:        ['form', 'input', 'label', 'button'],
  navigation:  ['navigation-menu', 'sheet', 'dropdown-menu'],
  modal:       ['dialog', 'alert-dialog', 'drawer'],
  notification:['toast', 'alert', 'sonner'],
  table:       ['table', 'data-table', 'pagination'],
  form:        ['form', 'input', 'textarea', 'select', 'checkbox'],
}

// Curated Aceternity components by intent (raw GitHub paths)
const ACETERNITY_MAP: Record<string, string> = {
  hero:          'hero-highlight',
  card:          'card-hover-effect',
  background:    'aurora-background',
  text:          'text-generate-effect',
  motion:        'sparkles',
  '3d':          'card-3d',
}

function detectTags(code: string): string[] {
  const tags: string[] = []
  if (/framer.motion|motion\.|animate=/i.test(code))     tags.push('animation')
  if (/backdrop.blur|glass|bg-white\//i.test(code))       tags.push('glass')
  if (/gradient/i.test(code))                             tags.push('gradient')
  if (/dark:|bg-zinc|bg-neutral-9|bg-black/i.test(code)) tags.push('dark')
  if (/three\.js|@react-three/i.test(code))               tags.push('3d')
  if (/pricing|plan|tier/i.test(code))                    tags.push('pricing')
  if (/hero|headline|above.the.fold/i.test(code))         tags.push('hero')
  if (/grid|card.grid|grid-cols/i.test(code))             tags.push('grid')
  return tags
}

export class ResourceAgent {

  private cacheDir: string
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

  constructor() {
    this.cacheDir = path.join(os.homedir(), '.zozo', 'resource-cache')
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  // ── Cache management ───────────────────────────────────────────────────

  private getCacheKey(url: string): string {
    return url.replace(/[^a-zA-Z0-9]/g, '_').slice(-80) + '.json'
  }

  private readCache(url: string): string | null {
    try {
      const file = path.join(this.cacheDir, this.getCacheKey(url))
      if (!fs.existsSync(file)) return null
      const stat = fs.statSync(file)
      if (Date.now() - stat.mtimeMs > this.CACHE_TTL_MS) {
        fs.unlinkSync(file)
        return null
      }
      return fs.readFileSync(file, 'utf8')
    } catch { return null }
  }

  private writeCache(url: string, content: string): void {
    try {
      const file = path.join(this.cacheDir, this.getCacheKey(url))
      fs.writeFileSync(file, content, 'utf8')
    } catch {}
  }

  // ── Cached fetch ───────────────────────────────────────────────────────

  private async fetchUrl(url: string, timeoutMs = 5000): Promise<string> {
    const cached = this.readCache(url)
    if (cached) return cached

    const content = await this.fetchUrlRaw(url, timeoutMs)
    this.writeCache(url, content)
    return content
  }

  private fetchUrlRaw(url: string, timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      https.get(url, { headers: { 'User-Agent': 'ZOZO/1.0' } }, res => {
        if (res.statusCode && res.statusCode >= 400) {
          clearTimeout(timeout)
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk })
        res.on('end', () => { clearTimeout(timeout); resolve(data) })
        res.on('error', (err: Error) => { clearTimeout(timeout); reject(err) })
      }).on('error', (err: Error) => { clearTimeout(timeout); reject(err) })
    })
  }

  // ── Resource success tracking ──────────────────────────────────────────

  /**
   * Record whether a specific resource helped improve the quality score.
   * Called by Orchestrator after quality gate evaluates the build.
   */
  recordResourceOutcome(
    resourceName: string,
    source: string,
    qualityBefore: number,
    qualityAfter: number
  ): void {
    try {
      const trackFile = path.join(this.cacheDir, 'resource-outcomes.json')
      let outcomes: Array<{
        name: string
        source: string
        delta: number
        timestamp: string
      }> = []

      if (fs.existsSync(trackFile)) {
        try { outcomes = JSON.parse(fs.readFileSync(trackFile, 'utf8')) } catch {}
      }

      outcomes.push({
        name: resourceName,
        source,
        delta: qualityAfter - qualityBefore,
        timestamp: new Date().toISOString(),
      })

      // Keep last 200 outcomes
      if (outcomes.length > 200) outcomes = outcomes.slice(-200)
      fs.writeFileSync(trackFile, JSON.stringify(outcomes, null, 2), 'utf8')
    } catch {}
  }

  /**
   * Get the best-performing resources by average quality delta.
   * ResourceAgent uses this to prioritise proven resources.
   */
  getBestResources(limit = 5): Array<{ name: string; source: string; avgDelta: number }> {
    try {
      const trackFile = path.join(this.cacheDir, 'resource-outcomes.json')
      if (!fs.existsSync(trackFile)) return []

      const outcomes: Array<{ name: string; source: string; delta: number }> =
        JSON.parse(fs.readFileSync(trackFile, 'utf8'))

      const grouped: Record<string, number[]> = {}
      for (const o of outcomes) {
        const key = `${o.source}:${o.name}`
        if (!grouped[key]) grouped[key] = []
        grouped[key]!.push(o.delta)
      }

      return Object.entries(grouped)
        .map(([key, deltas]) => {
          const [source, name] = key.split(':') as [string, string]
          return {
            name,
            source,
            avgDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
          }
        })
        .filter(r => r.avgDelta > 0)
        .sort((a, b) => b.avgDelta - a.avgDelta)
        .slice(0, limit)
    } catch { return [] }
  }

  /**
   * Fetch relevant resources based on user intent.
   * Returns up to 8 resources ranked by relevance.
   * Proven resources get a 'proven' tag for TemplateSelector boost.
   * Never throws — returns empty array on any failure.
   */
  async fetch(userPrompt: string, template: string, channel?: { appendLine: (msg: string) => void }): Promise<RawResource[]> {
    const log = (msg: string) => {
      if (channel) channel.appendLine(msg)
      console.log(msg)
    }

    const intent = this.detectIntent(userPrompt, template)
    log(`[RESOURCE] 🌐 Searching for: ${intent.join(', ')}`)

    // Check which resources have proven track records
    const proven = this.getBestResources(5)
    const provenNames = new Set(proven.map(p => p.name))
    if (proven.length > 0) {
      log(`[RESOURCE] ⭐ Proven resources: ${proven.map(p => p.name).join(', ')}`)
    }

    const [shadcnResults, aceternityResults] = await Promise.all([
      this.fetchShadcn(intent).catch(() => [] as RawResource[]),
      this.fetchAceternity(intent).catch(() => [] as RawResource[]),
    ])

    log(`[RESOURCE] 📦 Found: ${shadcnResults.length} shadcn + ${aceternityResults.length} aceternity`)

    const all = [...shadcnResults, ...aceternityResults]

    if (all.length === 0) {
      log(`[RESOURCE] ❌ Web fetch returned empty — Builder will use hardcoded DesignPresets`)
    } else {
      log(`[RESOURCE] ✅ Patterns extracted: ${all.map(r => r.name).join(', ')}`)
    }

    // Boost score of proven resources via tag
    return all.map(r => ({
      ...r,
      tags: provenNames.has(r.name) ? [...r.tags, 'proven'] : r.tags,
    }))
      .filter((r, i, arr) => arr.findIndex(x => x.name === r.name) === i)
      .slice(0, 8)
  }

  // ── Pre-verified component registry (GitHub raw — zero API calls) ─────────
  // Maps component slug → { githubRaw, npmDep, description }
  private static readonly COMPONENT_REGISTRY: Record<string, { raw: string; deps: string[]; desc: string }> = {
    // React Bits
    'reactbits.dev/components/flex-carousel':       { raw: 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/components/FlexCarousel/FlexCarousel.jsx',       deps: ['ogl'],                   desc: 'Infinite liquid-glass image carousel (WebGL + OGL)' },
    'reactbits.dev/components/holo-card':           { raw: 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/components/HoloCard/HoloCard.jsx',               deps: [],                        desc: 'Holographic foil tilt card' },
    'reactbits.dev/components/circular-carousel':   { raw: 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/components/CircularCarousel/CircularCarousel.jsx', deps: [],                       desc: 'Rotating circular item carousel' },
    'reactbits.dev/components/infinite-spiral':     { raw: 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/components/InfiniteSpiral/InfiniteSpiral.jsx',   deps: [],                        desc: 'Infinite spiral scroll reveal' },
    'reactbits.dev/components/depth-carousel':      { raw: 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/components/DepthCarousel/DepthCarousel.jsx',     deps: [],                        desc: 'Depth-based 3D card carousel' },
    'reactbits.dev/components/morph-slider':        { raw: 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/components/MorphSlider/MorphSlider.jsx',         deps: ['ogl'],                   desc: 'WebGL morphing image slider' },
    'reactbits.dev/components/drift-wall':          { raw: 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/components/DriftWall/DriftWall.jsx',             deps: [],                        desc: 'Physics-based drifting card wall' },
    // Aceternity UI
    'ui.aceternity.com/components/card-hover-effect':     { raw: 'https://raw.githubusercontent.com/aceternity/ui/main/components/ui/card-hover-effect.tsx',  deps: ['framer-motion', 'clsx'],  desc: 'Animated hover reveal card grid' },
    'ui.aceternity.com/components/aurora-background':     { raw: 'https://raw.githubusercontent.com/aceternity/ui/main/components/ui/aurora-background.tsx',  deps: ['framer-motion'],           desc: 'Animated aurora/gradient hero background' },
    'ui.aceternity.com/components/background-beams':      { raw: 'https://raw.githubusercontent.com/aceternity/ui/main/components/ui/background-beams.tsx',   deps: [],                          desc: 'Animated beam rays background' },
    'ui.aceternity.com/components/sparkles':              { raw: 'https://raw.githubusercontent.com/aceternity/ui/main/components/ui/sparkles.tsx',            deps: ['tsparticles-slim'],        desc: 'Sparkle particle overlay' },
    'ui.aceternity.com/components/spotlight':             { raw: 'https://raw.githubusercontent.com/aceternity/ui/main/components/ui/spotlight.tsx',           deps: [],                          desc: 'Cursor-following spotlight effect' },
    'ui.aceternity.com/components/3d-card':               { raw: 'https://raw.githubusercontent.com/aceternity/ui/main/components/ui/3d-card.tsx',             deps: ['framer-motion'],           desc: 'Mouse-tilt 3D perspective card' },
    // Magic UI
    'magicui.design/components/particles':          { raw: 'https://raw.githubusercontent.com/magicuidesign/magicui/main/registry/magicui/particles.tsx',          deps: ['framer-motion'],        desc: 'Interactive particle canvas background' },
    'magicui.design/components/globe':              { raw: 'https://raw.githubusercontent.com/magicuidesign/magicui/main/registry/magicui/globe.tsx',              deps: ['cobe'],                  desc: 'Animated 3D WebGL globe' },
    'magicui.design/components/marquee':            { raw: 'https://raw.githubusercontent.com/magicuidesign/magicui/main/registry/magicui/marquee.tsx',            deps: ['framer-motion'],        desc: 'Infinite horizontal scrolling marquee' },
    'magicui.design/components/animated-beam':      { raw: 'https://raw.githubusercontent.com/magicuidesign/magicui/main/registry/magicui/animated-beam.tsx',      deps: ['framer-motion'],        desc: 'SVG beam connecting elements' },
    'magicui.design/components/border-beam':        { raw: 'https://raw.githubusercontent.com/magicuidesign/magicui/main/registry/magicui/border-beam.tsx',        deps: ['framer-motion'],        desc: 'Animated rotating border glow' },
    'magicui.design/components/meteor':             { raw: 'https://raw.githubusercontent.com/magicuidesign/magicui/main/registry/magicui/meteors.tsx',             deps: [],                       desc: 'Falling meteor particle effect' },
    // Auto-governor curated set (for Mode A — no links given)
    '__governor__3d-landing':    { raw: '', deps: ['three', '@react-three/fiber', '@react-three/drei', 'framer-motion'],            desc: 'Three.js R3F hero + particle constellation + scroll camera' },
    '__governor__saas-dashboard':{ raw: '', deps: ['recharts', 'framer-motion', 'lucide-react', 'class-variance-authority'],        desc: 'Dark SaaS analytics dashboard (recharts + motion stat cards)' },
    '__governor__luxury-landing':{ raw: '', deps: ['framer-motion', 'lenis', 'gsap'],                                               desc: 'Luxury scrolljack + kinetic typography + gold accents' },
  }

  /**
   * Scrape all component links found in [ComponentLinks: url|url] prompt tag.
   * Strategy: 1. Firecrawl live scrape  2. Pre-verified GitHub raw  3. LLM writes from memory
   * Returns an array of extracted RawResource objects ready for BuilderAgent injection.
   */
  async scrapeComponentLinks(
    prompt: string,
    firecrawlKey: string,
    log: (msg: string) => void
  ): Promise<RawResource[]> {
    const results: RawResource[] = []

    // 1. Parse [ComponentLinks: url|url] from prompt
    const linkMatch = prompt.match(/\[ComponentLinks:\s*([^\]]+)\]/i)
    if (!linkMatch) return results

    const urls = linkMatch[1].split('|').map(u => u.trim()).filter(Boolean)
    log(`[RESOURCE] 🔗 Component links detected: ${urls.join(', ')}`)

    for (const url of urls) {
      try {
        const normalised = url.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()

        // ── Try pre-verified GitHub registry first (always fast, zero rate-limits) ──
        const registered = ResourceAgent.COMPONENT_REGISTRY[normalised]
        if (registered?.raw) {
          log(`[RESOURCE] 📚 Registry hit: ${normalised}`)
          try {
            const code = await this.fetchUrl(registered.raw, 6000)
            if (code && code.length > 50) {
              results.push({
                source:       'github',
                name:         this.slugToName(normalised),
                description:  registered.desc,
                code,
                tags:         detectTags(code),
                hasAnimation: /motion|gsap|animate|spring/i.test(code),
                hasDarkMode:  /dark:|bg-zinc|bg-black/i.test(code),
                hasTailwind:  /className/i.test(code),
                fetchedAt:    new Date().toISOString(),
              })
              log(`[RESOURCE] ✅ Registry: extracted ${code.length} chars for ${this.slugToName(normalised)}`)
              log(`[RESOURCE] 📦 Required deps: ${registered.deps.join(', ') || 'none'}`)
              continue  // skip Firecrawl for this one
            }
          } catch { /* fall through to Firecrawl */ }
        }

        // ── Firecrawl live scrape ──────────────────────────────────────────
        if (firecrawlKey) {
          log(`[RESOURCE] 🔥 Firecrawl scraping: ${url}`)
          const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${firecrawlKey}` },
            body: JSON.stringify({
              url,
              formats: ['markdown'],
              onlyMainContent: true,
              includeTags: ['code', 'pre'],
            })
          })
          const scrapeData = await scrapeRes.json() as { success: boolean; data?: { markdown?: string } }

          if (scrapeData.success && scrapeData.data?.markdown) {
            const md = scrapeData.data.markdown
            // Extract code blocks from markdown
            const codeBlocks = [...md.matchAll(/```(?:tsx?|jsx?|js|ts|css|html)?\n([\s\S]*?)```/g)]
              .map(m => m[1].trim())
              .filter(c => c.length > 40)
            const code = codeBlocks.join('\n\n// ── next block ──\n\n')

            // Extract npm install commands
            const npmMatch = md.match(/npm install ([^\n`]+)/i)
            const deps = npmMatch ? npmMatch[1].trim().split(/\s+/).filter(d => !d.startsWith('-')) : []

            if (code.length > 50) {
              results.push({
                source:       'github',
                name:         this.slugToName(normalised),
                description:  `Live-scraped from ${url}`,
                code:         code.slice(0, 8000),
                tags:         detectTags(code),
                hasAnimation: /motion|gsap|animate|spring/i.test(code),
                hasDarkMode:  /dark:|bg-zinc|bg-black/i.test(code),
                hasTailwind:  /className/i.test(code),
                fetchedAt:    new Date().toISOString(),
              })
              log(`[RESOURCE] ✅ Firecrawl: extracted ${code.length} chars + deps: ${deps.join(', ') || 'none'}`)
            } else {
              log(`[RESOURCE] ⚠️ Firecrawl: page had no usable code blocks for ${url}`)
            }
          }
        } else {
          log(`[RESOURCE] ⚠️ No Firecrawl key — using LLM memory for ${url}`)
          // Fallback: inject URL as hint to BuilderAgent (LLM writes from memory)
          results.push({
            source: 'github', name: this.slugToName(normalised),
            description: `Component reference: ${url} — implement faithfully from memory`,
            code: `// COMPONENT REFERENCE: ${url}\n// Implement this component as accurately as possible based on its documented API and visual appearance.`,
            tags: [], hasAnimation: false, hasDarkMode: true, hasTailwind: true, fetchedAt: new Date().toISOString(),
          })
        }
      } catch (err) {
        log(`[RESOURCE] ❌ Failed to scrape ${url}: ${err}`)
      }
    }

    return results
  }

  /**
   * Auto Governor — picks the best pre-verified stack for the given prompt.
   * Used when [ComponentStrategy: auto] (user didn't paste links).
   */
  governorAutoSelect(prompt: string, log: (msg: string) => void): string {
    const p = prompt.toLowerCase()
    let deps: string[] = []
    let summary = ''

    if (/3d|three|r3f|particle|canvas|shader|immersive/.test(p)) {
      deps = ResourceAgent.COMPONENT_REGISTRY['__governor__3d-landing']!.deps
      summary = ResourceAgent.COMPONENT_REGISTRY['__governor__3d-landing']!.desc
    } else if (/dashboard|analytics|saas|metric|chart|admin/.test(p)) {
      deps = ResourceAgent.COMPONENT_REGISTRY['__governor__saas-dashboard']!.deps
      summary = ResourceAgent.COMPONENT_REGISTRY['__governor__saas-dashboard']!.desc
    } else if (/luxury|premium|high.end|fashion|jewelry|gold/.test(p)) {
      deps = ResourceAgent.COMPONENT_REGISTRY['__governor__luxury-landing']!.deps
      summary = ResourceAgent.COMPONENT_REGISTRY['__governor__luxury-landing']!.desc
    } else {
      // Default: always output a premium React Bits + Aceternity combo
      deps = ['framer-motion', 'lucide-react', 'clsx']
      summary = 'Aceternity-style glassmorphism + Framer Motion scroll reveals'
    }

    log(`[RESOURCE] 🧠 Senior Governor selected: ${summary}`)
    log(`[RESOURCE] 📦 Auto-deps: ${deps.join(', ')}`)

    return `\n\n## SENIOR GOVERNOR AUTO-SELECTION\n${summary}\nRequired packages: ${deps.join(', ')}\n` +
      `Use React Bits (reactbits.dev), Aceternity UI, and Magic UI components as inspiration — implement their visual patterns directly in code without importing from their npm packages unless explicitly listed above.\n`
  }

  private slugToName(normalised: string): string {
    const parts = normalised.split('/')
    return parts[parts.length - 1]!
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }



  private detectIntent(prompt: string, template: string): string[] {
    const p = prompt.toLowerCase()

    const searchTerm = 
      (p.includes('restaurant') || p.includes('food') || p.includes('dining')) ? 'hero restaurant dark' :
      (p.includes('dashboard') || p.includes('analytics') || p.includes('admin')) ? 'sidebar dashboard analytics' :
      (p.includes('sneaker') || p.includes('shoe') || p.includes('footwear')) ? 'product card luxury' :
      (p.includes('gym') || p.includes('fitness') || p.includes('workout')) ? 'hero fitness dark' :
      (p.includes('agency') || p.includes('portfolio') || p.includes('creative')) ? 'hero agency creative' :
      (p.includes('3d') || p.includes('immersive') || p.includes('three')) ? 'three dimensional hero' :
      (p.includes('saas') || p.includes('startup') || p.includes('product')) ? 'saas landing dark' :
      'hero landing dark'

    const intents: string[] = [template]
    // Map searchTerm keywords to intent categories
    if (searchTerm.includes('hero'))      intents.push('hero')
    if (searchTerm.includes('dashboard')) intents.push('dashboard')
    if (searchTerm.includes('card'))      intents.push('card')
    if (searchTerm.includes('sidebar'))   intents.push('navigation')
    if (searchTerm.includes('three'))     intents.push('3d')
    if (p.includes('pricing') || p.includes('plan'))    intents.push('pricing')
    if (p.includes('auth') || p.includes('login'))      intents.push('auth')
    if (p.includes('nav') || p.includes('header'))      intents.push('navigation')
    if (p.includes('chat') || p.includes('message'))    intents.push('form')
    return [...new Set(intents)]
  }

  private getSearchTerm(prompt: string): string {
    const p = prompt.toLowerCase()
    return (
      (p.includes('restaurant') || p.includes('food') || p.includes('dining')) ? 'hero restaurant dark' :
      (p.includes('dashboard') || p.includes('analytics') || p.includes('admin')) ? 'sidebar dashboard analytics' :
      (p.includes('sneaker') || p.includes('shoe') || p.includes('footwear')) ? 'product card luxury' :
      (p.includes('gym') || p.includes('fitness') || p.includes('workout')) ? 'hero fitness dark' :
      (p.includes('agency') || p.includes('portfolio') || p.includes('creative')) ? 'hero agency creative' :
      (p.includes('3d') || p.includes('immersive') || p.includes('three')) ? 'three dimensional hero' :
      (p.includes('saas') || p.includes('startup') || p.includes('product')) ? 'saas landing dark' :
      'hero landing dark'
    )
  }

  private async fetchShadcn(intents: string[]): Promise<RawResource[]> {
    const results: RawResource[] = []
    const componentNames = new Set<string>()

    for (const intent of intents) {
      const names = SHADCN_COMPONENT_MAP[intent] ?? []
      names.forEach(n => componentNames.add(n))
    }

    for (const name of [...componentNames].slice(0, 4)) {
      try {
        const url = `${SHADCN_REGISTRY_BASE}/r/${name}.json`
        const raw = await this.fetchUrl(url, 4000)
        const parsed = JSON.parse(raw) as {
          name?: string
          description?: string
          files?: Array<{ content?: string }>
        }

        const code = parsed.files?.[0]?.content ?? ''
        if (!code || code.length < 50) continue

        results.push({
          source: 'shadcn',
          name,
          description: parsed.description ?? `shadcn ${name} component`,
          code: code.slice(0, 4000),
          tags: detectTags(code),
          hasAnimation: /animate|transition|motion/i.test(code),
          hasDarkMode:  /dark:|zinc-9|neutral-9/i.test(code),
          hasTailwind:  /className|cn\(/i.test(code),
          fetchedAt: new Date().toISOString(),
        })
      } catch (err: unknown) {
        console.warn(`[ResourceAgent] shadcn fetch failed for '${name}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return results
  }

  private async fetchAceternity(intents: string[]): Promise<RawResource[]> {
    const results: RawResource[] = []

    for (const intent of intents) {
      const compName = ACETERNITY_MAP[intent]
      if (!compName) continue

      try {
        const url = `${ACETERNITY_RAW_BASE}/${compName}.tsx`
        const code = await this.fetchUrl(url, 4000)
        if (!code || code.length < 100) continue

        results.push({
          source: 'aceternity',
          name: compName,
          description: `Aceternity ${compName} — premium animated component`,
          code: code.slice(0, 4000),
          tags: detectTags(code),
          hasAnimation: true,
          hasDarkMode: true,
          hasTailwind: /className/i.test(code),
          fetchedAt: new Date().toISOString(),
        })
      } catch (err: unknown) {
        console.warn(`[ResourceAgent] aceternity fetch failed for '${compName}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return results
  }

  // ── GitHub Template Search (free, no key needed) ─────────────────────────
  private async searchGitHubTemplates(prompt: string, log: (m: string) => void): Promise<string> {
    try {
      const searchTerm = this.getSearchTerm(prompt)
      const keywords = searchTerm.replace(/\s+/g, '+')

      const query = `${keywords}+nextjs+tailwind+dark+template`
      const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=5`

      const res = await fetch(url, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      })
      const data = await res.json() as {
        items?: Array<{ full_name: string; description: string; html_url: string; stargazers_count: number }>
      }

      if (!data.items?.length) return ''

      const repos = data.items.slice(0, 3).map(r =>
        `- ${r.html_url} (\u2B50${r.stargazers_count}) \u2014 ${r.description?.slice(0, 80) || ''}`
      ).join('\n')

      log(`[RESOURCE] \uD83D\uDC19 GitHub: found ${data.items.length} matching templates`)
      return `### TOP OPEN SOURCE TEMPLATES (GitHub):\n${repos}\nStudy these for component patterns.\n`
    } catch {
      return ''
    }
  }

  // ── Awwwards RSS Feed (free, no key needed) ──────────────────────────────
  private async searchAwwwardsRSS(category: string, log: (m: string) => void): Promise<string> {
    try {
      const catMap: Record<string, string> = {
        landing:   'portfolio',
        saas:      'sites',
        web3:      'sites',
        ecommerce: 'e-commerce',
        fitness:   'portfolio',
        portfolio: 'portfolio',
      }
      const awwCat = catMap[category] || 'sites'
      const url = `https://www.awwwards.com/awards/sites/${awwCat}/`

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      const html = await res.text()

      // Extract winner site names and URLs
      const matches = [...html.matchAll(/class="title"[^>]*>([^<]+)<\/[^>]+>[\s\S]{0,200}href="(https?:\/\/[^"]+)"/g)]
      const winners = matches.slice(0, 5).map(m => `- ${m[2]} \u2014 ${m[1].trim()}`)

      if (winners.length === 0) return ''
      log(`[RESOURCE] \uD83C\uDFC6 Awwwards: found ${winners.length} winners`)
      return `### AWWWARDS WINNERS (${awwCat}):\n${winners.join('\n')}\n`
    } catch {
      return ''
    }
  }

  // ── Web Search for Design Inspiration ──────────────────────────────────
  async searchWebForInspiration(
    prompt: string,
    depth: string,
    style: string,
    channel?: { appendLine: (msg: string) => void },
    passedApiKey?: string
  ): Promise<string> {
    const log = (msg: string) => { if (channel) channel.appendLine(msg) }

    log('[RESOURCE] \uD83C\uDF10 Searching web for design inspiration...')

    // Search GitHub + Awwwards in parallel (both free, no key needed)
    const [githubResults, awwwardsResults] = await Promise.all([
      this.searchGitHubTemplates(prompt, log).catch(() => ''),
      this.searchAwwwardsRSS(style, log).catch(() => ''),
    ])

    try {
      // Use passed key directly, fall back to config and env
      let key = passedApiKey || ''
      if (!key) {
        try {
          const vscodeModule = await import('vscode')
          const config = vscodeModule.workspace.getConfiguration('zozo')
          key = config.get<string>('apiKey')
            || config.get<string>('anthropicApiKey')
            || config.get<string>('api_key')
            || process.env.ANTHROPIC_API_KEY
            || ''
        } catch {}
      }

      if (!key) {
        log('[RESOURCE] \u26A0\uFE0F No API key \u2014 skipping web search')
        // Still return GitHub + Awwwards even without API key
        const freeResults = [githubResults, awwwardsResults].filter(Boolean).join('\n\n')
        return freeResults ? `\n## FREE DESIGN INTELLIGENCE\n${freeResults}\n` : ''
      }

      const query = `premium dark ${style} ${prompt} website design 2025 best UI`
      log(`[RESOURCE] \uD83D\uDD0D Query: ${query}`)

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search'
          }],
          messages: [{
            role: 'user',
            content: `Search for: best premium dark ${style} UI design patterns for ${prompt} website 2025. Find specific color palettes, font combinations, and component patterns used by award-winning sites. Return a brief summary of the best design patterns found.`
          }]
        })
      })

      const data = await response.json() as {
        content?: Array<{ type: string; text?: string }>
      }

      const text = data.content
        ?.filter((b: { type: string }) => b.type === 'text')
        ?.map((b: { text?: string }) => b.text)
        ?.join('\n') ?? ''

      if (text) {
        log(`[RESOURCE] \u2705 Web search found ${text.length} chars of design inspiration`)
        return `\n## DESIGN INTELLIGENCE\n${text}\n\n${githubResults}\n\n${awwwardsResults}\nApply these real-world patterns from production sites + award winners + open source.\n`
      } else {
        log('[RESOURCE] \u26A0\uFE0F Web search returned no text results')
      }

      // ── Firecrawl: real site extraction + 21st.dev components ──
      let firecrawlResults = ''
      let firecrawlKey = ''
      try {
        const vscodeModule = await import('vscode')
        firecrawlKey = vscodeModule.workspace.getConfiguration('zozo').get<string>('firecrawlApiKey') || ''
      } catch {}

      if (firecrawlKey) {
        const searchTerm = this.getSearchTerm(prompt)
        try {
          // Step 1: Find best real site for this category
          const siteSearchRes = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${firecrawlKey}` },
            body: JSON.stringify({ 
              query: `best luxury ${searchTerm} website 2025`,
              limit: 3
            })
          })
          const siteSearchData = await siteSearchRes.json() as { success: boolean; data?: Array<{ url: string }> }
          
          // Step 2: Scrape the top result
          if (siteSearchData.success && siteSearchData.data?.[0]?.url) {
            const topUrl = siteSearchData.data[0].url
            log(`[RESOURCE] \uD83D\uDD25 Firecrawl reading: ${topUrl}`)
            
            const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${firecrawlKey}` },
              body: JSON.stringify({ 
                url: topUrl,
                formats: ['markdown'],
                onlyMainContent: true,
                includeTags: ['img', 'video', 'h1', 'h2', 'p', 'section'],
                actions: [{ type: 'wait', milliseconds: 1000 }]
              })
            })
            const scrapeData = await scrapeRes.json() as { success: boolean; data?: { markdown?: string } }
            
            if (scrapeData.success && scrapeData.data?.markdown) {
              const content = scrapeData.data.markdown.slice(0, 3000)
              firecrawlResults += `
## REAL SITE EXTRACTED: ${topUrl}
${content}

## COPY THIS STRUCTURE EXACTLY:
- Use the same section order
- Use similar copy style and tone
- Reference the image/video URLs found above
- Match the content density per section
`
              log(`[RESOURCE] \u2705 Firecrawl extracted ${content.length} chars from real site`)
            }
          }
        } catch (err) {
          log(`[RESOURCE] \u26A0\uFE0F Firecrawl failed: ${err}`)
        }
      }

      const allResults = [text, githubResults, awwwardsResults, firecrawlResults].filter(Boolean).join('\n\n')
      if (allResults) {
        return `\n## DESIGN INTELLIGENCE\n${allResults}\nApply these real-world patterns from production sites + award winners + open source.\n`
      }
      return ''

    } catch (err) {
      log(`[RESOURCE] \u274C Web search failed: ${err}`)
      // Still return free results on failure
      const freeResults = [githubResults, awwwardsResults].filter(Boolean).join('\n\n')
      return freeResults ? `\n## FREE DESIGN INTELLIGENCE\n${freeResults}\n` : ''
    }
  }
}

// ─── Media Extraction (zero LLM, zero API key) ──────────────────────────────

export interface MediaResources {
  images: string[]
  videos: string[]
  keywords: string[]
}

const MEDIA_CATEGORY_MAP: Record<string, string[]> = {
  shoes:      ['sneaker', 'shoe', 'footwear', 'sole', 'kicks', 'jordan'],
  restaurant: ['restaurant', 'bistro', 'cafe', 'dining', 'food', 'cuisine', 'chef'],
  gym:        ['gym', 'fitness', 'workout', 'training', 'muscle', 'exercise', 'crossfit'],
  web3:       ['crypto', 'nft', 'blockchain', 'defi', 'token', 'web3', 'mining'],
  saas:       ['dashboard', 'analytics', 'platform', 'software', 'saas', 'crm'],
  luxury:     ['luxury', 'premium', 'elite', 'high-end', 'exclusive', 'vip'],
  fashion:    ['fashion', 'clothing', 'brand', 'style', 'wear', 'apparel'],
  car:        ['car', 'automotive', 'vehicle', 'motor', 'drive', 'supercar'],
  hotel:      ['hotel', 'resort', 'spa', 'hospitality', 'suite', 'vacation'],
  tech:       ['tech', 'startup', 'ai', 'machine', 'robot', 'code', 'developer'],
  nature:     ['nature', 'outdoor', 'mountain', 'ocean', 'forest', 'adventure'],
  music:      ['music', 'concert', 'dj', 'festival', 'studio', 'beats'],
}

// Lorem Picsum — always works, no API key, real high-quality photos
const PICSUM_CATEGORIES: Record<string, number[]> = {
  shoes:      [1011, 1025, 1037, 1043, 1055],
  restaurant: [292, 312, 429, 431, 488],
  gym:        [1015, 1018, 1074, 1076, 1084],
  luxury:     [164, 188, 250, 380, 432],
  fashion:    [64, 203, 399, 453, 528],
  car:        [133, 183, 214, 328, 514],
  hotel:      [164, 188, 250, 323, 432],
  tech:       [0, 1, 2, 60, 180],
  nature:     [10, 11, 15, 29, 47],
  web3:       [0, 1, 60, 180, 366],
  saas:       [0, 1, 2, 60, 180],
  music:      [39, 145, 274, 452, 537],
}

// Curated stock video direct URLs (from Pexels CDN — free, no API key needed)
const VIDEO_MAP: Record<string, string[]> = {
  gym: [
    'https://videos.pexels.com/video-files/4761428/4761428-hd_1920_1080_30fps.mp4',
    'https://videos.pexels.com/video-files/4753987/4753987-hd_1920_1080_25fps.mp4',
  ],
  luxury: [
    'https://videos.pexels.com/video-files/3192898/3192898-hd_1920_1080_24fps.mp4',
  ],
  fashion: [
    'https://videos.pexels.com/video-files/3571264/3571264-hd_1920_1080_25fps.mp4',
  ],
  restaurant: [
    'https://videos.pexels.com/video-files/2518861/2518861-hd_1920_1080_24fps.mp4',
  ],
  car: [
    'https://videos.pexels.com/video-files/3843536/3843536-hd_1920_1080_25fps.mp4',
  ],
  nature: [
    'https://videos.pexels.com/video-files/857251/857251-hd_1920_1080_25fps.mp4',
  ],
  tech: [
    'https://videos.pexels.com/video-files/3129671/3129671-hd_1920_1080_30fps.mp4',
  ],
}

export function detectMediaKeywords(prompt: string): string[] {
  const lower = prompt.toLowerCase()
  const keywords: string[] = []

  for (const [category, words] of Object.entries(MEDIA_CATEGORY_MAP)) {
    if (words.some(w => lower.includes(w))) {
      keywords.push(category)
    }
  }

  return keywords
}

export function fetchMediaImages(keywords: string[]): string[] {
  const images: string[] = []

  for (const keyword of keywords.slice(0, 2)) {
    const ids = PICSUM_CATEGORIES[keyword] ?? [0, 1, 2]
    for (const id of ids.slice(0, 3)) {
      images.push(`https://picsum.photos/id/${id}/1920/1080`)
    }
  }

  return images
}

export function fetchMediaVideos(keywords: string[]): string[] {
  const videos: string[] = []

  for (const keyword of keywords) {
    const vids = VIDEO_MAP[keyword]
    if (vids) videos.push(...vids)
  }

  return videos
}

export function fetchMedia(prompt: string, channel?: { appendLine: (msg: string) => void }): MediaResources {
  const log = (msg: string) => { if (channel) channel.appendLine(msg) }

  log('[RESOURCE] \uD83D\uDD0D Analyzing prompt for media needs...')

  const keywords = detectMediaKeywords(prompt)
  log(`[RESOURCE] \uD83C\uDFF7\uFE0F Keywords detected: ${keywords.length > 0 ? keywords.join(', ') : 'none (generic build)'}`)

  if (keywords.length === 0) {
    log('[RESOURCE] \u2139\uFE0F No specific media category — Builder generates from scratch')
    return { images: [], videos: [], keywords: [] }
  }

  const images = fetchMediaImages(keywords)
  log(`[RESOURCE] \u2705 Found ${images.length} images for: ${keywords.join(', ')}`)

  const videos = fetchMediaVideos(keywords)
  log(`[RESOURCE] \u2705 Found ${videos.length} videos for: ${keywords.join(', ')}`)

  return { images, videos, keywords }
}

export function buildMediaContext(media: MediaResources): string {
  if (media.images.length === 0 && media.videos.length === 0) return ''

  let ctx = `\n## REAL MEDIA \u2014 USE THESE EXACT URLs (do NOT use placeholder images)\n`

  if (media.images.length > 0) {
    ctx += `\n### IMAGES (use in <img> src or CSS background-image):\n`
    ctx += media.images.map((url, i) => `- Image ${i + 1}: ${url}`).join('\n')
    ctx += '\n'
  }

  if (media.videos.length > 0) {
    ctx += `\n### VIDEOS (use in <video> tag for hero background):\n`
    ctx += media.videos.map((url, i) => `- Video ${i + 1}: ${url}`).join('\n')
    ctx += '\n'
  }

  ctx += `\nIMPORTANT:
- Use these real URLs \u2014 do NOT use placeholder.com or via.placeholder
- Hero should use video background if videos available
- Product/feature sections should use the image URLs
- Add loading="lazy" to all <img> tags
- Videos: autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"
`

  return ctx
}
