import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { streamFromLLM } from './NetworkNode'
import { PipelineEventBus } from './PipelineEventBus'

const EDITOR_SYSTEM = `You are ZOZO's Elite Code Editor Agent — the sharpest and most precise code surgeon in the world.

You are operating in EDITOR MODE on an existing codebase. Your job is NOT to build things from scratch — it is to:
1. Understand the existing code deeply and quickly
2. Make targeted, surgical changes exactly as the user requests
3. Never modify code that wasn't part of the request
4. Always verify your understanding before making changes
5. Explain what you changed and why

When making edits, respond with:
- A brief analysis of what you found in the codebase
- The exact changes you will make
- Any risks or side effects the user should know about

Format code edits using this XML tag format:
<edit path="relative/path/to/file.ts">
[complete new file content OR specific section to change]
</edit>

Or for shell commands:
<run>
npm install package-name
</run>

Be the most precise, thoughtful code editor the user has ever worked with.`

export interface EditorAction {
  type: 'edit' | 'create' | 'delete' | 'run' | 'explain'
  filePath?: string
  content?: string
  command?: string
  explanation: string
}

export interface EditorResult {
  actions: EditorAction[]
  success: boolean
  summary: string
}

export class EditorMode {
  private bus = PipelineEventBus.getInstance()

  /**
   * Handle a message in Editor mode.
   * Reads the workspace, understands the code, makes surgical edits.
   */
  async handleMessage(
    userMessage: string,
    provider: string,
    apiKey: string,
    workspaceRoot: string
  ): Promise<EditorResult> {
    const sessionId = 'editor-' + Date.now()

    this.bus.emit({
      type: 'chat_system_message',
      sessionId,
      text: '🔍 **Editor mode activated.** Scanning your codebase...',
    })

    // Build workspace context
    const workspaceContext = await this.buildWorkspaceContext(workspaceRoot)

    const fullPrompt = `## Current Workspace State\n${workspaceContext}\n\n## User Request\n${userMessage}\n\nAnalyze the codebase and make the precise changes needed.`

    let accumulated = ''
    let chunkBuffer = ''
    let bufferTimer: ReturnType<typeof setTimeout> | null = null

    const flushBuffer = () => {
      if (chunkBuffer) {
        this.bus.emit({ type: 'chat_chunk', sessionId, chunk: chunkBuffer })
        chunkBuffer = ''
      }
    }

    await streamFromLLM(
      fullPrompt,
      provider,
      apiKey,
      EDITOR_SYSTEM,
      {
        maxOutputTokens: 8192,
        onChunk: (chunk) => {
          accumulated += chunk
          chunkBuffer += chunk
          if (bufferTimer) clearTimeout(bufferTimer)
          bufferTimer = setTimeout(flushBuffer, 50)
        }
      }
    )

    if (bufferTimer) clearTimeout(bufferTimer)
    flushBuffer()

    // Parse and execute actions from the response
    const actions = this.parseActions(accumulated)
    const appliedActions: EditorAction[] = []

    for (const action of actions) {
      try {
        if (action.type === 'edit' || action.type === 'create') {
          await this.applyFileEdit(action, workspaceRoot)
          appliedActions.push(action)
        } else if (action.type === 'run') {
          this.bus.emit({
            type: 'chat_system_message',
            sessionId: sessionId + '-cmd',
            text: `💡 **Suggested command:** \`${action.command}\`\n\nRun this in your terminal to apply the change.`,
          })
        }
      } catch (err) {
        this.bus.emit({
          type: 'chat_system_message',
          sessionId: sessionId + '-err',
          text: `⚠️ Could not apply edit to \`${action.filePath}\`: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        })
      }
    }

    const modifiedFiles = appliedActions.filter(a => a.filePath).map(a => a.filePath!.split('/').pop())

    if (appliedActions.length > 0) {
      this.bus.emit({
        type: 'chat_system_message',
        sessionId: sessionId + '-done',
        text: `✅ **Done!** Modified: \`${modifiedFiles.join('`, `')}\``,
      })
    }

    return {
      actions: appliedActions,
      success: appliedActions.length > 0 || actions.length === 0,
      summary: modifiedFiles.length > 0
        ? `Modified ${modifiedFiles.join(', ')}`
        : 'Analysis complete',
    }
  }

  /**
   * Build a compact summary of the workspace for LLM context.
   * Lists files and includes content of relevant source files.
   */
  private async buildWorkspaceContext(workspaceRoot: string): Promise<string> {
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      return 'No workspace open.'
    }

    const lines: string[] = []

    // List top-level files and dirs
    try {
      const topLevel = fs.readdirSync(workspaceRoot)
        .filter(f => !f.startsWith('.') && f !== 'node_modules' && f !== '.git')

      lines.push('### Workspace Root:')
      lines.push(topLevel.join(', '))
      lines.push('')

      // If there's a package.json, read it for tech stack context
      const pkgPath = path.join(workspaceRoot, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
        lines.push('### Dependencies:')
        lines.push(deps.slice(0, 30).join(', '))
        lines.push('')
      }

      // Find the active document from VSCode
      const activeEditor = vscode.window.activeTextEditor
      if (activeEditor) {
        const filePath = activeEditor.document.fileName
        const relPath = path.relative(workspaceRoot, filePath)
        const content = activeEditor.document.getText()
        lines.push(`### Active File: ${relPath}`)
        lines.push('```')
        lines.push(content.slice(0, 6000)) // Cap at 6000 chars
        lines.push('```')
        lines.push('')
      }

      // List src files up to 2 levels deep
      const srcDir = path.join(workspaceRoot, 'src')
      if (fs.existsSync(srcDir)) {
        const srcFiles = this.listFiles(srcDir, 2)
        lines.push('### Source Files:')
        lines.push(srcFiles.map(f => path.relative(workspaceRoot, f)).join('\n'))
      }
    } catch (err) {
      lines.push(`Error scanning workspace: ${err}`)
    }

    return lines.join('\n')
  }

  /**
   * Recursively list files up to maxDepth levels deep.
   */
  private listFiles(dir: string, maxDepth: number, depth = 0): string[] {
    if (depth > maxDepth) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...this.listFiles(fullPath, maxDepth, depth + 1))
      } else {
        files.push(fullPath)
      }
    }
    return files
  }

  /**
   * Parse <edit> and <run> XML tags from the LLM response.
   */
  private parseActions(text: string): EditorAction[] {
    const actions: EditorAction[] = []

    const editRegex = /<edit\s+path="([^"]+)">([\s\S]*?)<\/edit>/g
    let m: RegExpExecArray | null
    while ((m = editRegex.exec(text)) !== null) {
      actions.push({
        type: 'edit',
        filePath: m[1],
        content: m[2].trim(),
        explanation: 'Applying edit to ' + m[1],
      })
    }

    const runRegex = /<run>([\s\S]*?)<\/run>/g
    while ((m = runRegex.exec(text)) !== null) {
      actions.push({
        type: 'run',
        command: m[1].trim(),
        explanation: 'Run: ' + m[1].trim(),
      })
    }

    return actions
  }

  /**
   * Apply a file edit action to the workspace.
   */
  private async applyFileEdit(action: EditorAction, workspaceRoot: string): Promise<void> {
    if (!action.filePath || !action.content) return

    const absPath = action.filePath.startsWith('/')
      ? action.filePath
      : path.join(workspaceRoot, action.filePath)

    // Ensure parent directory exists
    const dir = path.dirname(absPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(absPath, action.content, 'utf8')

    // Open the file in the editor so the user can see what changed
    const doc = await vscode.workspace.openTextDocument(absPath)
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true })
  }
}
