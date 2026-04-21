import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface DeployResult {
  success: boolean
  url?: string
  provider?: 'vercel' | 'netlify'
  error?: string
  skipped?: boolean
  skipReason?: string
}

/**
 * DeployAgent
 *
 * Deploys the generated project to Vercel (primary) or Netlify (fallback).
 * Returns a live URL.
 *
 * Only runs in full pipeline mode and only if the build verified clean.
 * Never blocks the pipeline — returns skipped if CLI not available.
 */
export class DeployAgent {

  async deploy(workspaceRoot: string, projectName: string): Promise<DeployResult> {
    // Check if vercel CLI is available
    const hasVercel = this.cliAvailable('vercel --version')
    if (hasVercel) {
      return this.deployVercel(workspaceRoot, projectName)
    }

    // Check netlify
    const hasNetlify = this.cliAvailable('netlify --version')
    if (hasNetlify) {
      return this.deployNetlify(workspaceRoot)
    }

    return {
      success: false,
      skipped: true,
      skipReason: 'No deployment CLI found. Install Vercel CLI: npm i -g vercel',
    }
  }

  private deployVercel(workspaceRoot: string, projectName: string): DeployResult {
    try {
      // First run: npm install if needed
      if (!fs.existsSync(path.join(workspaceRoot, 'node_modules'))) {
        execSync('npm install --legacy-peer-deps', {
          cwd: workspaceRoot,
          timeout: 120_000,
          stdio: 'pipe',
        })
      }

      // Deploy with vercel CLI (non-interactive)
      const output = execSync(
        `vercel --prod --yes --name="${projectName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}"`,
        {
          cwd: workspaceRoot,
          timeout: 180_000,
          stdio: 'pipe',
          env: { ...process.env },
        }
      ).toString()

      // Extract URL from output
      const urlMatch = output.match(/https:\/\/[a-zA-Z0-9\-\.]+\.vercel\.app/)
      const url = urlMatch?.[0]

      return { success: true, url, provider: 'vercel' }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // If not logged in, skip gracefully
      if (msg.includes('not logged in') || msg.includes('ENOENT')) {
        return {
          success: false,
          skipped: true,
          skipReason: 'Vercel not authenticated. Run: vercel login',
        }
      }
      return { success: false, error: msg.slice(0, 200) }
    }
  }

  private deployNetlify(workspaceRoot: string): DeployResult {
    try {
      const output = execSync('netlify deploy --prod --dir=.next', {
        cwd: workspaceRoot,
        timeout: 180_000,
        stdio: 'pipe',
      }).toString()

      const urlMatch = output.match(/https:\/\/[a-zA-Z0-9\-]+\.netlify\.app/)
      return { success: true, url: urlMatch?.[0], provider: 'netlify' }
    } catch (err: unknown) {
      return { success: false, error: String(err).slice(0, 200) }
    }
  }

  private cliAvailable(cmd: string): boolean {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }
}
