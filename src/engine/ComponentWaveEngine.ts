/**
 * ComponentWaveEngine
 *
 * Splits the build into sequential "waves" — groups of logically related files.
 * After each wave: files are written to disk, browser preview opens,
 * and the user sees [Continue] [Modify] [Stop] buttons in the sidebar.
 *
 * Architecture: Antigravity checkpoint → user signal → continue
 *
 *   Wave 1: Foundation (configs, globals, layout)
 *   Wave 2: Simple components (Footer, Navbar, utils)
 *   Wave 3: Core components (Pricing, Features, Testimonials)
 *   Wave 4: Complex components (Hero) + page files
 */

import * as vscode from 'vscode'
import { PipelineEventBus } from './PipelineEventBus'

export interface ComponentWave {
  waveNumber: number
  label: string               // "Wave 1: Foundation", "Wave 2: Simple Components"
  files: string[]             // file paths in this wave
  filesInWave?: string[]      // alias used by Orchestrator after filtering written files
  openPreviewAfter: boolean   // true for waves 2+
  requireUserApproval: boolean
}

export type WaveDecision = 'continue' | 'modify' | 'stop'

// ─── Complexity ordering (mirrors BuilderAgent's FileGroup logic) ─────────────
function complexityScore(f: string): number {
  // Wave 1 — Foundation
  if (/package\.json$/.test(f))          return 10
  if (/tsconfig\.json$/.test(f))         return 10
  if (/tailwind\.config/.test(f))        return 10
  if (/next\.config/.test(f))            return 10
  if (/postcss\.config/.test(f))         return 10
  if (/globals\.css$/.test(f))           return 11
  if (/layout\.tsx$/.test(f))            return 12
  if (/lib\//.test(f))                   return 13

  // Wave 2 — Simple components
  if (/Footer/i.test(f))                 return 20
  if (/Navbar|Nav/i.test(f))             return 21

  // Wave 3 — Core components
  if (/Testimonial/i.test(f))            return 30
  if (/Pricing/i.test(f))               return 31
  if (/FAQ|Accordion/i.test(f))          return 32
  if (/Features?|Stats?/i.test(f))       return 33

  // Wave 4 — Complex
  if (/Hero|Header/i.test(f))            return 40
  if (/page\.tsx$/.test(f))             return 41

  // Everything else → wave 3
  return 30
}

const WAVE_LABELS: Record<number, string> = {
  1: '⚙️  Wave 1: Foundation',
  2: '🧱 Wave 2: Simple Components',
  3: '🎨 Wave 3: Core Components',
  4: '✨ Wave 4: Complex + Pages',
}

/**
 * Split a flat list of files into sequential ComponentWaves.
 * Uses the same complexity scoring as BuilderAgent's FileGroup logic.
 */
export function buildWaves(filesToCreate: string[]): ComponentWave[] {
  const byWave: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [] }

  for (const f of filesToCreate) {
    const score = complexityScore(f)
    if (score < 20)       byWave[1].push(f)
    else if (score < 30)  byWave[2].push(f)
    else if (score < 40)  byWave[3].push(f)
    else                  byWave[4].push(f)
  }

  const waves: ComponentWave[] = []
  for (let w = 1; w <= 4; w++) {
    if (byWave[w].length > 0) {
      waves.push({
        waveNumber: w,
        label: WAVE_LABELS[w] ?? `Wave ${w}`,
        files: byWave[w],
        openPreviewAfter: w >= 2,   // wave 1 = no preview (just configs)
        requireUserApproval: true,
      })
    }
  }

  return waves
}

/**
 * Wait for user approval after a wave is written to disk.
 * Emits 'wave_complete' to the sidebar, which renders:
 *   ✅ Wave N: X files written
 *   [Continue →] [✏️ Modify] [⏹ Stop]
 *
 * Returns a Promise<WaveDecision> that resolves when the user clicks.
 * Falls back to 'continue' after 120s (timeout) to avoid blocking.
 */
export function waitForWaveApproval(
  wave: ComponentWave,
  sessionId: string
): Promise<WaveDecision> {
  const bus = PipelineEventBus.getInstance()

  // Emit wave_complete → sidebar renders the approve/modify/stop card
  bus.emit({
    type: 'wave_complete',
    sessionId,
    waveNumber: wave.waveNumber,
    waveLabel: wave.label,
    filesInWave: wave.filesInWave ?? wave.files,  // prefer actually-written files
  } as any)

  // Open browser preview for waves that have UI
  if (wave.openPreviewAfter) {
    openBrowserPreview(sessionId)
  }

  return new Promise<WaveDecision>((resolve) => {
    let resolved = false

    // Auto-timeout: continue after 120s to avoid infinite hang
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        console.log(`[WAVE] Wave ${wave.waveNumber} auto-continued after 120s timeout`)
        resolve('continue')
      }
    }, 120_000)

    // Subscribe to user decisions
    const unsub = bus.subscribe(event => {
      if (resolved) return
      if ((event as any).waveNumber !== wave.waveNumber) return

      if (event.type === 'wave_approved') {
        resolved = true
        clearTimeout(timeout)
        unsub()
        resolve('continue')
      } else if (event.type === 'wave_modify') {
        resolved = true
        clearTimeout(timeout)
        unsub()
        resolve('modify')
      } else if (event.type === 'wave_stopped') {
        resolved = true
        clearTimeout(timeout)
        unsub()
        resolve('stop')
      }
    })
  })
}

/**
 * Open the local dev server in the default browser.
 * Shows a VS Code progress notification while the server starts.
 */
export function openBrowserPreview(sessionId: string): void {
  const bus = PipelineEventBus.getInstance()
  const url = 'http://localhost:3000'

  try {
    vscode.env.openExternal(vscode.Uri.parse(url))
    bus.emit({
      type: 'open_browser_preview',
      sessionId,
      text: url,
    } as any)
    console.log(`[WAVE] 🌐 Opened browser preview: ${url}`)
  } catch (err) {
    console.log(`[WAVE] Browser preview skipped: ${err}`)
  }
}
