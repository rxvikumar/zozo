import * as path from 'path'
import * as fs from 'fs'

export interface ComponentProps {
  componentName: string
  filePath: string
  acceptedVariants?: Record<string, string[]>  // prop name → accepted values
  requiredProps: string[]
  optionalProps: string[]
}

/**
 * PropConstraints
 *
 * Extracts TypeScript prop types from generated component files.
 * Converts them into constraints injected into BuilderAgent retries.
 *
 * Solves: <Button variant="ultra-premium" /> — variant doesn't exist.
 * tsc doesn't always catch string union violations in JSX.
 * This makes them explicit to the model before it generates.
 *
 * Only runs on quality gate retries — first pass uses PackageRegistry.
 * On retry: "here is what your Button component actually accepts".
 */
export class PropConstraints {

  /**
   * Scan workspace for generated components and extract their prop interfaces.
   */
  extract(workspaceRoot: string): ComponentProps[] {
    const results: ComponentProps[] = []
    const dirs = [
      path.join(workspaceRoot, 'components'),
      path.join(workspaceRoot, 'src', 'components'),
      path.join(workspaceRoot, 'components', 'ui'),
      path.join(workspaceRoot, 'src', 'components', 'ui'),
    ]

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      try {
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
          const fullPath = path.join(dir, file)
          const content = fs.readFileSync(fullPath, 'utf8')
          const props = this.parseProps(content, file, fullPath)
          if (props) results.push(props)
        }
      } catch {}
    }

    return results
  }

  /**
   * Build a constraint prompt from extracted props.
   * Injected into BuilderAgent on quality gate retries only.
   */
  toConstraintPrompt(components: ComponentProps[]): string {
    if (components.length === 0) return ''

    const lines = [
      `## Generated Component Props (use ONLY these values)`,
      ``,
      `These components exist in this project. Use ONLY the props listed.`,
      ``,
    ]

    for (const comp of components.slice(0, 10)) {
      lines.push(`### ${comp.componentName}`)
      if (comp.requiredProps.length > 0) {
        lines.push(`Required: ${comp.requiredProps.join(', ')}`)
      }
      if (comp.optionalProps.length > 0) {
        lines.push(`Optional: ${comp.optionalProps.slice(0, 8).join(', ')}`)
      }
      if (comp.acceptedVariants) {
        for (const [prop, values] of Object.entries(comp.acceptedVariants)) {
          lines.push(`${prop}: ${values.map(v => `"${v}"`).join(' | ')}`)
        }
      }
      lines.push(`Import: from '@/components/${comp.componentName.toLowerCase()}'`)
      lines.push(``)
    }

    lines.push(`DO NOT pass props that are not listed above.`)
    return lines.join('\n')
  }

  private parseProps(content: string, fileName: string, _fullPath: string): ComponentProps | null {
    const componentName = fileName.replace(/\.tsx?$/, '')

    // Extract interface/type Props blocks
    const interfaceMatch = content.match(/(?:interface|type)\s+\w*[Pp]rops\s*(?:=\s*)?\{([^}]+)\}/s)
    if (!interfaceMatch) return null

    const body = interfaceMatch[1]!
    const required: string[] = []
    const optional: string[] = []
    const variants: Record<string, string[]> = {}

    // Parse each prop line
    const propLines = body.split('\n').map(l => l.trim()).filter(Boolean)
    for (const line of propLines) {
      // Skip comments
      if (line.startsWith('//') || line.startsWith('*')) continue

      // Match: propName?: type or propName: type
      const match = line.match(/^(\w+)(\?)?:\s*(.+)/)
      if (!match) continue

      const [, name, isOptional, typeStr] = match as [string, string, string | undefined, string]

      if (isOptional) {
        optional.push(name)
      } else {
        required.push(name)
      }

      // Extract string union values for variant-like props
      if (name === 'variant' || name === 'size' || name === 'color' || name === 'intent') {
        const unionValues = typeStr.match(/"([^"]+)"/g)?.map(v => v.replace(/"/g, ''))
        if (unionValues && unionValues.length > 0) {
          variants[name] = unionValues
        }
      }
    }

    if (required.length === 0 && optional.length === 0) return null

    return {
      componentName,
      filePath: _fullPath,
      acceptedVariants: Object.keys(variants).length > 0 ? variants : undefined,
      requiredProps: required,
      optionalProps: optional,
    }
  }
}
