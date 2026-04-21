// ─── ZOZO LivePreview ─────────────────────────────────────────────────────────
// Spawns `npm run dev` after a build and shows the running app in a VS Code
// WebviewPanel via an iframe → localhost:3000.
// Hot-reload works because the dev server stays alive — every file edit by
// EditAgent reflects immediately in the panel without manual refresh.
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from 'vscode'
import * as http from 'http'
import { spawn, ChildProcess } from 'child_process'

const DEV_PORT = 3000
const POLL_INTERVAL_MS = 500
const STARTUP_TIMEOUT_MS = 45_000

export class LivePreview {
  private panel: vscode.WebviewPanel | null = null
  private devServer: ChildProcess | null = null
  private workspaceRoot: string = ''

  async start(workspaceRoot: string, outputChannel: vscode.OutputChannel): Promise<void> {
    this.workspaceRoot = workspaceRoot
    await this.killExisting()
    outputChannel.appendLine('[ZOZO Preview] Starting dev server...')

    this.devServer = spawn('npm', ['run', 'dev'], {
      cwd: workspaceRoot,
      shell: process.platform === 'win32',
      env: { ...process.env, BROWSER: 'none' },
    })

    this.devServer.stdout?.on('data', (data: Buffer) => {
      outputChannel.appendLine(`[dev] ${data.toString().trim()}`)
    })

    this.devServer.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (!msg.includes('warn') && !msg.includes('info')) {
        outputChannel.appendLine(`[dev] ${msg}`)
      }
    })

    this.devServer.on('error', (err) => {
      outputChannel.appendLine(`[ZOZO Preview] Dev server error: ${err.message}`)
      vscode.window.showErrorMessage(`ZOZO Preview: ${err.message}`)
    })

    this.devServer.on('exit', (code) => {
      if (code !== null && code !== 0) {
        outputChannel.appendLine(`[ZOZO Preview] Dev server exited with code ${code}`)
      }
    })

    outputChannel.appendLine('[ZOZO Preview] Waiting for localhost:3000...')
    const ready = await this.waitForServer(DEV_PORT, STARTUP_TIMEOUT_MS)

    if (!ready) {
      outputChannel.appendLine('[ZOZO Preview] ⚠️ Server did not start in time — open manually: npm run dev')
      vscode.window.showWarningMessage(
        'ZOZO Preview: dev server took too long. Run `npm run dev` manually.',
        'Open Preview Anyway'
      ).then(choice => {
        if (choice === 'Open Preview Anyway') this.openPanel()
      })
      return
    }

    outputChannel.appendLine('[ZOZO Preview] ✅ Server ready — opening preview panel')
    this.openPanel()
  }

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside)
      this.panel.webview.postMessage({ command: 'reload' })
      return
    }

    this.panel = vscode.window.createWebviewPanel(
      'zozoPreview',
      'ZOZO Preview',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    )

    this.panel.webview.html = this.buildHtml()

    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'openBrowser') {
        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${DEV_PORT}`))
      }
    })

    this.panel.onDidDispose(() => { this.panel = null })
  }

  refresh(): void {
    if (this.panel) {
      this.panel.webview.postMessage({ command: 'reload' })
    }
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = null
    this.killExisting().catch(() => {})
    if (this.devServer) {
      this.devServer.kill('SIGTERM')
      this.devServer = null
    }
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; }
  .toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; background: #1a1a1a;
    border-bottom: 1px solid #2a2a2a;
  }
  .url { flex: 1; font-size: 12px; color: #888; padding: 4px 8px;
    background: #0d0d0d; border-radius: 4px; border: 1px solid #2a2a2a; }
  .btn { padding: 4px 10px; font-size: 12px; cursor: pointer; border: none;
    border-radius: 4px; background: #2a2a2a; color: #ccc; }
  .btn:hover { background: #3a3a3a; }
  .btn.primary { background: #5a32b0; color: white; }
  .btn.primary:hover { background: #6a42c0; }
  iframe { width: 100%; border: none; height: calc(100vh - 41px); display: block; }
</style>
</head>
<body>
<div class="toolbar">
  <span class="url">http://localhost:${DEV_PORT}</span>
  <button class="btn" onclick="reloadFrame()">↻ Reload</button>
  <button class="btn primary" onclick="openBrowser()">Open in Browser</button>
</div>
<iframe id="preview" src="http://localhost:${DEV_PORT}"></iframe>
<script>
  const vscode = acquireVsCodeApi();
  function reloadFrame() { const f = document.getElementById('preview'); f.src = f.src; }
  function openBrowser() { vscode.postMessage({ command: 'openBrowser' }); }
  window.addEventListener('message', event => {
    if (event.data.command === 'reload') reloadFrame();
  });
</script>
</body>
</html>`
  }

  private waitForServer(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs
      const check = () => {
        const req = http.get({ hostname: 'localhost', port, path: '/', timeout: 1000 }, () => {
          resolve(true)
        })
        req.on('error', () => {
          if (Date.now() >= deadline) resolve(false)
          else setTimeout(check, POLL_INTERVAL_MS)
        })
        req.end()
      }
      check()
    })
  }

  private async killExisting(): Promise<void> {
    try {
      if (process.platform === 'win32') {
        const { execSync } = await import('child_process')
        try {
          const out = execSync(`netstat -ano | findstr :${DEV_PORT}`, { encoding: 'utf8' })
          const match = out.match(/LISTENING\s+(\d+)/)
          if (match) execSync(`taskkill /PID ${match[1]} /F`, { stdio: 'pipe' })
        } catch { }
      }
    } catch { }
  }
}

let _instance: LivePreview | null = null
export function getLivePreview(): LivePreview {
  if (!_instance) _instance = new LivePreview()
  return _instance
}
export function disposeLivePreview(): void {
  _instance?.dispose()
  _instance = null
}
