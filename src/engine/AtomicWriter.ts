import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execPromise = promisify(exec)

const TEMP_DIR = '.zozo-temp'

export async function atomicWrite(
  workspaceRoot: string,
  filePath: string, 
  code: string
): Promise<boolean> {
  // Write to temp
  const tempPath = path.join(workspaceRoot, TEMP_DIR, filePath)
  fs.mkdirSync(path.dirname(tempPath), { recursive: true })
  fs.writeFileSync(tempPath, code, 'utf8')
  
  // Quick syntax check — no tsc (too slow per file)
  const hasDefaultExport = code.includes('export default')
  const isConfig = filePath.includes('config') || filePath.includes('utils') || filePath.includes('globals')
  const useClientCorrect = !code.includes("'use client'") || 
    code.trimStart().startsWith("'use client'")
  const noTruncation = !code.includes('// TODO') && 
    !code.includes('// ...') &&
    !code.endsWith('...')
  
  const valid = (hasDefaultExport || isConfig) && useClientCorrect && noTruncation
  
  if (valid) {
    // Commit to real project
    const realPath = path.join(workspaceRoot, filePath)
    fs.mkdirSync(path.dirname(realPath), { recursive: true })
    fs.writeFileSync(realPath, code, 'utf8')
    return true
  }
  
  return false
}

export function buildDependencyGraph(
  workspaceRoot: string, 
  files: string[]
): Record<string, string[]> {
  const graph: Record<string, string[]> = {}
  
  for (const file of files) {
    const abs = path.join(workspaceRoot, file)
    if (!fs.existsSync(abs)) continue
    
    const content = fs.readFileSync(abs, 'utf8')
    const imports = [...content.matchAll(/from ['"](@\/|\.\.?\/)(.*?)['"]/g)]
      .map(m => m[2])
    graph[file] = imports
  }
  
  return graph
}

export function getRepairContext(
  brokenFile: string,
  graph: Record<string, string[]>,
  workspaceRoot: string
): string {
  const related = [
    'app/layout.tsx',
    'lib/utils.ts', 
    ...(graph[brokenFile] || [])
  ]
  
  return related
    .filter(f => fs.existsSync(path.join(workspaceRoot, f)))
    .map(f => {
      const content = fs.readFileSync(path.join(workspaceRoot, f), 'utf8')
      return `// ${f}\n${content.slice(0, 400)}`
    })
    .join('\n---\n')
    .slice(0, 2000)
}
