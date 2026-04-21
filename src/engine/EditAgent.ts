import * as path from 'path'
import * as fs from 'fs'
import { streamFromLLM } from './NetworkNode'

export type EditIntent =
  | 'color_change'
  | 'text_change'
  | 'layout_change'
  | 'component_add'
  | 'component_remove'
  | 'style_change'
  | 'unknown'

export interface EditPlan {
  intent: EditIntent
  targetFiles: string[]      // which files to modify
  description: string        // what to do in human terms
  isFullRebuild: boolean     // true only if edit requires full regen
  confidence: number         // 0-100
}

export interface EditResult {
  success: boolean
  filesModified: string[]
  description: string
  skippedFullRebuild: boolean
}

/**
 * EditAgent
 *
 * Handles modification requests WITHOUT rebuilding the entire app.
 * "Make the button blue" → finds button component → changes className → done.
 * 
 * This is what a developer does. They don't rewrite the entire codebase
 * because you asked them to change a color.
 *
 * Only triggers full rebuild for structural changes (add auth, add database).
 */
export class EditAgent {

  /**
   * Determine if a prompt is an edit request (vs a new build).
   * Called from extension.ts before deciding to run Orchestrator.
   */
  isEditRequest(prompt: string): boolean {
    const editSignals = [
      'change', 'modify', 'update', 'fix', 'make', 'set',
      'replace', 'rename', 'move', 'add text', 'edit',
      'color', 'font', 'size', 'bigger', 'smaller', 'darker',
      'lighter', 'blue', 'red', 'green', 'white', 'black',
    ]
    const buildSignals = [
      'build', 'create', 'generate', 'new', 'from scratch',
      'add auth', 'add database', 'add stripe', 'rebuild',
    ]

    const p = prompt.toLowerCase()
    const hasEdit  = editSignals.some(s => p.includes(s))
    const hasBuild = buildSignals.some(s => p.includes(s))
    const wordCount = p.split(' ').length

    return hasEdit && !hasBuild && wordCount < 20
  }

  /**
   * Plan an edit based on user prompt and current workspace.
   */
  async plan(
    prompt: string,
    workspaceRoot: string,
    provider: string,
    apiKey: string
  ): Promise<EditPlan> {
    const files = this.listEditableFiles(workspaceRoot)
    if (files.length === 0) {
      return {
        intent: 'unknown',
        targetFiles: [],
        description: 'No editable files found',
        isFullRebuild: true,
        confidence: 0,
      }
    }

    // Rule-based for simple color/text changes
    const p = prompt.toLowerCase()
    if (this.isColorChange(p)) {
      const heroFile = files.find(f => f.includes('hero') || f.includes('page')) ?? files[0]!
      return {
        intent: 'color_change',
        targetFiles: [heroFile],
        description: `Change color in ${path.basename(heroFile)}`,
        isFullRebuild: false,
        confidence: 90,
      }
    }

    // LLM for complex edits
    try {
      const systemPrompt = `You are a code edit planner. Given a user request and list of files, decide what to edit.
Respond ONLY with JSON: { "intent": string, "targetFiles": string[], "description": string, "isFullRebuild": boolean, "confidence": number }
Intent options: color_change, text_change, layout_change, component_add, component_remove, style_change, unknown
isFullRebuild: true only for auth, database, or structural changes.`

      const response = await streamFromLLM(
        `User request: "${prompt}"\n\nFiles available:\n${files.slice(0, 20).join('\n')}`,
        provider, apiKey, systemPrompt,
        { maxOutputTokens: 200 }
      )

      const clean = response.replace(/```json|```/g, '').trim()
      return JSON.parse(clean) as EditPlan
    } catch {
      return {
        intent: 'style_change',
        targetFiles: files.slice(0, 3),
        description: prompt,
        isFullRebuild: false,
        confidence: 50,
      }
    }
  }

  /**
   * Execute the edit plan by modifying specific files.
   */
  async execute(
    plan: EditPlan,
    prompt: string,
    workspaceRoot: string,
    provider: string,
    apiKey: string
  ): Promise<EditResult> {
    if (plan.isFullRebuild || plan.confidence < 30) {
      return {
        success: false,
        filesModified: [],
        description: 'Full rebuild required',
        skippedFullRebuild: false,
      }
    }

    const modified: string[] = []

    for (const filePath of plan.targetFiles) {
      const fullPath = path.join(workspaceRoot, filePath)
      if (!fs.existsSync(fullPath)) continue

      const currentContent = fs.readFileSync(fullPath, 'utf8')

      const systemPrompt = `You are a precise code editor. 
Modify ONLY what the user asks. Change nothing else.
Return ONLY the complete modified file content. No explanation. No markdown.`

      try {
        const newContent = await streamFromLLM(
          `File: ${filePath}\n\nUser request: "${prompt}"\n\nCurrent file:\n${currentContent.slice(0, 6000)}`,
          provider, apiKey, systemPrompt,
          { maxOutputTokens: 4000 }
        )

        // Safety: only write if the output looks like valid code
        if (newContent.length > 50 && (newContent.includes('import') || newContent.includes('export') || newContent.includes('const'))) {
          fs.writeFileSync(fullPath, newContent, 'utf8')
          modified.push(filePath)
        }
      } catch {}
    }

    return {
      success: modified.length > 0,
      filesModified: modified,
      description: `Modified ${modified.length} file(s): ${modified.map(f => path.basename(f)).join(', ')}`,
      skippedFullRebuild: true,
    }
  }

  private isColorChange(prompt: string): boolean {
    const colors = ['blue', 'red', 'green', 'purple', 'orange', 'pink', 'yellow', 'white', 'black', 'gray']
    const colorWords = ['color', 'colour', 'darker', 'lighter', 'brighter']
    return colors.some(c => prompt.includes(c)) || colorWords.some(c => prompt.includes(c))
  }

  private listEditableFiles(root: string): string[] {
    const results: string[] = []
    const dirs = ['app', 'src/app', 'pages', 'src/pages', 'components', 'src/components']
    const skip = ['node_modules', '.next', '.git', 'dist']

    for (const dir of dirs) {
      const fullDir = path.join(root, dir)
      if (!fs.existsSync(fullDir)) continue
      try {
        const entries = fs.readdirSync(fullDir, { withFileTypes: true })
        for (const e of entries) {
          if (skip.includes(e.name)) continue
          if (e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.ts') || e.name.endsWith('.css'))) {
            results.push(path.join(dir, e.name))
          }
        }
      } catch {}
    }
    return results
  }
}
