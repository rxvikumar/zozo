import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

export interface LockInfo {
  sessionId: string
  prompt: string
  startedAt: string
  pid: number
}

/**
 * WorkspaceGuard
 *
 * Prevents concurrent ZOZO pipeline runs from corrupting each other.
 * Uses a lock file at ~/.zozo/pipeline.lock
 * Shows a VS Code status bar item during active runs.
 *
 * Patterns sourced from code-review-graph extension (watcher + auto-update debounce).
 */
export class WorkspaceGuard {
  private lockPath: string
  private statusBarItem: vscode.StatusBarItem
  private static instance: WorkspaceGuard | undefined

  constructor() {
    const dir = path.join(os.homedir(), '.zozo')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.lockPath = path.join(dir, 'pipeline.lock')

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    )
    this.statusBarItem.command = 'zozo.showCost'
  }

  static getInstance(): WorkspaceGuard {
    if (!WorkspaceGuard.instance) {
      WorkspaceGuard.instance = new WorkspaceGuard()
    }
    return WorkspaceGuard.instance
  }

  /**
   * Try to acquire the pipeline lock.
   * Returns false if already locked (another run is in progress).
   */
  acquire(sessionId: string, prompt: string): boolean {
    // Auto-recover locks older than 30 minutes even if process claims alive
    const lockAge = this.getLockAgeMinutes()
    if (lockAge !== null && lockAge > 30) {
      this.recoverStaleLock()
    }

    // Stale lock check — if process no longer exists, release automatically
    if (fs.existsSync(this.lockPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo
        const processAlive = this.isProcessAlive(existing.pid)
        if (!processAlive) {
          // Stale lock — release it
          fs.unlinkSync(this.lockPath)
        } else {
          return false
        }
      } catch {
        // Corrupt lock file — remove it
        try { fs.unlinkSync(this.lockPath) } catch {}
      }
    }

    const lock: LockInfo = {
      sessionId,
      prompt: prompt.slice(0, 100),
      startedAt: new Date().toISOString(),
      pid: process.pid,
    }

    try {
      fs.writeFileSync(this.lockPath, JSON.stringify(lock, null, 2), 'utf8')
      this.showStatus(`⚡ ZOZO building...`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Release the pipeline lock.
   */
  release(sessionId: string): void {
    try {
      if (fs.existsSync(this.lockPath)) {
        const existing = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo
        // Only release if we own the lock
        if (existing.sessionId === sessionId) {
          fs.unlinkSync(this.lockPath)
        }
      }
    } catch {}
    this.hideStatus()
  }

  isLocked(): boolean {
    if (!fs.existsSync(this.lockPath)) return false
    try {
      const info = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo
      if (!this.isProcessAlive(info.pid)) {
        try { fs.unlinkSync(this.lockPath) } catch {}
        return false
      }
      return true
    } catch {
      return false
    }
  }

  getLockInfo(): LockInfo | null {
    try {
      if (!fs.existsSync(this.lockPath)) return null
      return JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo
    } catch {
      return null
    }
  }

  /**
   * Update the status bar text mid-pipeline (e.g., show current step name).
   */
  updateStep(stepName: string): void {
    this.showStatus(`⚡ ZOZO — ${stepName}`)
  }

  /**
   * Cancel the current pipeline run.
   * Sets cancelled flag on PipelineEventBus so Orchestrator stops at next check.
   */
  cancel(): void {
    const { PipelineEventBus } = require('./PipelineEventBus')
    PipelineEventBus.getInstance().cancel()
  }

  dispose(): void {
    this.statusBarItem.dispose()
  }

  /**
   * Force-release a stale lock without checking process alive status.
   * Use when the normal acquire() stale-check fails (e.g. PID reuse by OS).
   * Returns true if a lock was found and removed.
   */
  recoverStaleLock(): boolean {
    try {
      if (!fs.existsSync(this.lockPath)) return false
      const _info = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo
      fs.unlinkSync(this.lockPath)
      this.hideStatus()
      return true
    } catch {
      try { fs.unlinkSync(this.lockPath) } catch {}
      return false
    }
  }

  /**
   * Returns how long the current lock has been held, in minutes.
   * Returns null if not locked.
   */
  getLockAgeMinutes(): number | null {
    const info = this.getLockInfo()
    if (!info) return null
    return (Date.now() - new Date(info.startedAt).getTime()) / 60_000
  }

  /**
   * Force unlock regardless of session ownership.
   * Only for manual recovery via zozo.forceUnlock command.
   */
  forceUnlock(): void {
    this.recoverStaleLock()
    vscode.window.showInformationMessage('ZOZO: Pipeline lock cleared.')
  }

  private showStatus(text: string): void {
    this.statusBarItem.text = text
    this.statusBarItem.tooltip = 'Click to see ZOZO cost'
    this.statusBarItem.show()
  }

  private hideStatus(): void {
    this.statusBarItem.hide()
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)  // Signal 0 = existence check, no actual signal sent
      return true
    } catch {
      return false
    }
  }
}
