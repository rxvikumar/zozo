import * as fs from 'fs'
import * as path from 'path'

const MEMORY_FILE = '.zozo-memory.json'

export interface ProjectState {
  prompt: string
  template: string
  techStack: string[]
  filesWritten: string[]
  relationships: Record<string, string[]>
  lastEditedFiles: string[]
  version: number
  buildCount: number
  timestamp: string
}

export function buildProjectState(
  workspaceRoot: string,
  prompt: string,
  template: string,
  filesWritten: string[],
  techStack: string[],
  previous?: ProjectState | null
): ProjectState {
  return {
    prompt,
    template,
    techStack,
    filesWritten,
    relationships: {},
    lastEditedFiles: filesWritten,
    version: (previous?.version ?? 0) + 1,
    buildCount: (previous?.buildCount ?? 0) + 1,
    timestamp: new Date().toISOString(),
  }
}

export function saveProjectState(workspaceRoot: string, state: ProjectState): void {
  try {
    const filePath = path.join(workspaceRoot, MEMORY_FILE)
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
  } catch {}
}

export function loadProjectState(workspaceRoot: string): ProjectState | null {
  try {
    const filePath = path.join(workspaceRoot, MEMORY_FILE)
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}
