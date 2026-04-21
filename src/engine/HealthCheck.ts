import * as vscode from 'vscode'

export type HealthStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface HealthItem {
  label: string
  status: HealthStatus
  detail: string
  action?: string    // what the user should do if fail/warn
}

export interface HealthReport {
  overall: 'ready' | 'needs_action' | 'broken'
  score: number      // 0-100
  items: HealthItem[]
  readyToRun: boolean
}

/**
 * HealthCheck
 *
 * Final check after all pipeline steps complete.
 * Produces a pass/fail checklist the user sees immediately.
 * No loopholes — every failure has a clear action.
 */
export class HealthCheck {

  run(
    _workspaceRoot: string,
    context: {
      tsErrorCount:    number
      runtimePassed:   boolean
      envMissing:      number
      depsInstalled:   boolean
      qualityScore:    number
      fileCount:       number
      deployUrl?:      string
    }
  ): HealthReport {
    const items: HealthItem[] = []

    // 1. Files generated
    items.push({
      label: 'Files generated',
      status: context.fileCount > 0 ? 'pass' : 'fail',
      detail: context.fileCount > 0 ? `${context.fileCount} files written` : 'No files were generated',
      action: context.fileCount === 0 ? 'Run the build again' : undefined,
    })

    // 2. Dependencies installed
    items.push({
      label: 'Dependencies installed',
      status: context.depsInstalled ? 'pass' : 'warn',
      detail: context.depsInstalled ? 'npm install completed' : 'npm install failed or not run',
      action: context.depsInstalled ? undefined : 'Run: npm install --legacy-peer-deps',
    })

    // 3. TypeScript clean
    items.push({
      label: 'TypeScript',
      status: context.tsErrorCount === 0 ? 'pass'
            : context.tsErrorCount <= 5  ? 'warn' : 'fail',
      detail: context.tsErrorCount === 0 ? 'No type errors' : `${context.tsErrorCount} type error(s) remain`,
      action: context.tsErrorCount > 0
        ? `Run: npx tsc --noEmit to see errors, then fix manually`
        : undefined,
    })

    // 4. Environment variables
    items.push({
      label: 'Environment variables',
      status: context.envMissing === 0 ? 'pass'
            : context.envMissing <= 2  ? 'warn' : 'fail',
      detail: context.envMissing === 0 ? 'All env vars detected' : `${context.envMissing} variable(s) need values in .env.local`,
      action: context.envMissing > 0
        ? 'Open .env.local and fill in the required values (see .env.example for instructions)'
        : undefined,
    })

    // 5. Runtime check
    items.push({
      label: 'Runtime',
      status: context.runtimePassed ? 'pass' : 'warn',
      detail: context.runtimePassed ? 'Dev server started cleanly' : 'Runtime check skipped (express mode) or failed',
      action: !context.runtimePassed ? 'Run: npm run dev and check the terminal for errors' : undefined,
    })

    // 6. UI quality
    items.push({
      label: 'UI quality',
      status: context.qualityScore >= 85 ? 'pass'
            : context.qualityScore >= 65 ? 'warn' : 'fail',
      detail: `Quality score: ${context.qualityScore}/100 (${context.qualityScore >= 85 ? 'WORLD_CLASS' : context.qualityScore >= 65 ? 'ACCEPTABLE' : 'NEEDS_WORK'})`,
      action: context.qualityScore < 65
        ? 'Run the build again — quality gate will auto-retry with fixes'
        : undefined,
    })

    // 7. Deployment
    items.push({
      label: 'Deployment',
      status: context.deployUrl ? 'pass' : 'skip',
      detail: context.deployUrl ? `Live at ${context.deployUrl}` : 'Not deployed (install Vercel CLI to auto-deploy)',
      action: !context.deployUrl ? 'Install Vercel CLI: npm i -g vercel && vercel login' : undefined,
    })

    // Calculate overall
    const failed  = items.filter(i => i.status === 'fail').length
    const warned  = items.filter(i => i.status === 'warn').length
    const passed  = items.filter(i => i.status === 'pass').length
    const total   = items.filter(i => i.status !== 'skip').length
    const score   = total > 0 ? Math.round((passed / total) * 100) : 0

    const overall: HealthReport['overall'] =
      failed > 0 ? 'broken' :
      warned > 1 ? 'needs_action' : 'ready'

    const readyToRun = context.tsErrorCount === 0 && context.depsInstalled

    return { overall, score, items, readyToRun }
  }

  /**
   * Show the health report as a VS Code webview.
   */
  async show(report: HealthReport): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'zozoHealth', 'ZOZO: Build Health',
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    )

    const statusIcon: Record<HealthStatus, string> = {
      pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭',
    }
    const statusColor: Record<HealthStatus, string> = {
      pass: '#4ec9b0', warn: '#dcdcaa', fail: '#f48771', skip: '#71717a',
    }

    const rows = report.items.map(item => `
      <tr>
        <td>${statusIcon[item.status]}</td>
        <td style="font-weight:500">${item.label}</td>
        <td style="color:${statusColor[item.status]}">${item.detail}</td>
        <td style="color:#71717a;font-size:11px">${item.action ?? ''}</td>
      </tr>
    `).join('')

    const overallColor = report.overall === 'ready' ? '#4ec9b0'
      : report.overall === 'needs_action' ? '#dcdcaa' : '#f48771'

    const nextStep = report.readyToRun
      ? `<div style="margin-top:20px;padding:14px 16px;background:rgba(78,201,176,0.08);
                     border:1px solid rgba(78,201,176,0.2);border-radius:10px;">
           <strong style="color:#4ec9b0">Ready to run</strong><br>
           <code style="font-size:12px">npm run dev</code> in your terminal
         </div>`
      : `<div style="margin-top:20px;padding:14px 16px;background:rgba(248,135,113,0.08);
                     border:1px solid rgba(248,135,113,0.2);border-radius:10px;">
           <strong style="color:#f48771">Fix required items before running</strong><br>
           Check the Action column above
         </div>`

    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:var(--vscode-font-family);padding:24px;color:var(--vscode-foreground);max-width:680px;}
  h1{font-size:17px;font-weight:600;margin:0 0 4px;}
  .score{font-size:32px;font-weight:800;color:${overallColor};margin:8px 0 4px;}
  .status{font-size:13px;color:${overallColor};margin-bottom:20px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th{text-align:left;padding:7px 8px;border-bottom:2px solid var(--vscode-panel-border);
     font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em;}
  td{padding:8px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top;}
  code{background:var(--vscode-textCodeBlock-background);padding:1px 5px;border-radius:3px;}
</style></head><body>
<h1>Build Health Report</h1>
<div class="score">${report.score}/100</div>
<div class="status">${
  report.overall === 'ready' ? '✅ Ready to run' :
  report.overall === 'needs_action' ? '⚠️ Needs attention' : '❌ Issues found'
}</div>
<table>
  <thead><tr><th></th><th>Check</th><th>Result</th><th>Action needed</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${nextStep}
</body></html>`
  }
}
