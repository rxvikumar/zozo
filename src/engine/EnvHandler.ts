import * as path from 'path'
import * as fs from 'fs'
import * as vscode from 'vscode'

export interface EnvRequirement {
  key: string
  description: string
  howToGet: string
  required: boolean
  example: string
}

const ENV_KNOWLEDGE_BASE: Record<string, EnvRequirement> = {
  'NEXT_PUBLIC_SUPABASE_URL': {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    description: 'Your Supabase project URL',
    howToGet: 'supabase.com → Project Settings → API → Project URL',
    required: true,
    example: 'https://xyzxyz.supabase.co',
  },
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': {
    key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    description: 'Supabase anonymous public key',
    howToGet: 'supabase.com → Project Settings → API → anon public',
    required: true,
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  },
  'STRIPE_SECRET_KEY': {
    key: 'STRIPE_SECRET_KEY',
    description: 'Stripe secret API key',
    howToGet: 'stripe.com → Developers → API Keys → Secret key',
    required: true,
    example: 'sk_test_...',
  },
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY': {
    key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    description: 'Stripe publishable key (safe to expose)',
    howToGet: 'stripe.com → Developers → API Keys → Publishable key',
    required: true,
    example: 'pk_test_...',
  },
  'STRIPE_WEBHOOK_SECRET': {
    key: 'STRIPE_WEBHOOK_SECRET',
    description: 'Stripe webhook signing secret',
    howToGet: 'stripe.com → Developers → Webhooks → Signing secret',
    required: false,
    example: 'whsec_...',
  },
  'NEXTAUTH_SECRET': {
    key: 'NEXTAUTH_SECRET',
    description: 'NextAuth.js secret for JWT signing',
    howToGet: 'Run: openssl rand -base64 32',
    required: true,
    example: 'a-random-32-character-string',
  },
  'NEXTAUTH_URL': {
    key: 'NEXTAUTH_URL',
    description: 'Your app URL for NextAuth redirects',
    howToGet: 'Use http://localhost:3000 for development',
    required: true,
    example: 'http://localhost:3000',
  },
  'OPENAI_API_KEY': {
    key: 'OPENAI_API_KEY',
    description: 'OpenAI API key for AI features',
    howToGet: 'platform.openai.com → API Keys',
    required: true,
    example: 'sk-...',
  },
  'DATABASE_URL': {
    key: 'DATABASE_URL',
    description: 'PostgreSQL connection string',
    howToGet: 'Your database provider → Connection string',
    required: true,
    example: 'postgresql://user:password@localhost:5432/mydb',
  },
}

/**
 * EnvHandler
 *
 * Scans generated code for environment variable usage.
 * Creates .env.example and .env.local (with guidance comments).
 * Shows a setup guide to the user after generation.
 */
export class EnvHandler {

  /**
   * Scan the workspace for required env vars.
   */
  scan(workspaceRoot: string): EnvRequirement[] {
    const found = new Set<string>()
    const files = this.findFiles(workspaceRoot)

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const matches = content.matchAll(/process\.env\.([A-Z_]+)|env\.([A-Z_]+)/g)
        for (const match of matches) {
          const key = match[1] ?? match[2]
          if (key) found.add(key)
        }
      } catch {}
    }

    return [...found]
      .map(key => ENV_KNOWLEDGE_BASE[key] ?? {
        key,
        description: `Environment variable used by the app`,
        howToGet: 'Check your service provider dashboard',
        required: true,
        example: 'your_value_here',
      })
  }

  /**
   * Write .env.example and .env.local (if it doesn't exist).
   */
  writeEnvFiles(workspaceRoot: string, requirements: EnvRequirement[]): void {
    if (requirements.length === 0) return

    // Write .env.example (always — shows what's needed)
    const exampleLines = [
      '# Required environment variables',
      '# Copy this file to .env.local and fill in your values',
      '',
      ...requirements.map(r => [
        `# ${r.description}`,
        `# How to get: ${r.howToGet}`,
        `# Example: ${r.example}`,
        `${r.key}=`,
        '',
      ].join('\n')),
    ]

    fs.writeFileSync(
      path.join(workspaceRoot, '.env.example'),
      exampleLines.join('\n'),
      'utf8'
    )

    // Write .env.local only if it doesn't exist (never overwrite secrets)
    const envLocalPath = path.join(workspaceRoot, '.env.local')
    if (!fs.existsSync(envLocalPath)) {
      const localLines = [
        '# Fill in your values below',
        '# This file is gitignored — never commit it',
        '',
        ...requirements.map(r => `${r.key}=`),
      ]
      fs.writeFileSync(envLocalPath, localLines.join('\n'), 'utf8')
    }
  }

  /**
   * Show a VS Code walkthrough for missing env vars.
   */
  async showSetupGuide(requirements: EnvRequirement[]): Promise<void> {
    if (requirements.length === 0) return

    const required = requirements.filter(r => r.required)
    if (required.length === 0) return

    const choice = await vscode.window.showInformationMessage(
      `ZOZO: ${required.length} environment variable(s) required before running`,
      'Open .env.local',
      'Show Setup Guide',
      'Later'
    )

    if (choice === 'Open .env.local') {
      const workspaceFolders = vscode.workspace.workspaceFolders
      if (workspaceFolders?.[0]) {
        const envPath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.env.local')
        await vscode.window.showTextDocument(envPath)
      }
    } else if (choice === 'Show Setup Guide') {
      // Create a webview with the full setup guide
      const panel = vscode.window.createWebviewPanel(
        'zozoEnvSetup', 'ZOZO: Environment Setup',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
      )

      panel.webview.html = this.buildGuideHtml(required)
    }
  }

  private buildGuideHtml(requirements: EnvRequirement[]): string {
    const rows = requirements.map(r => `
      <tr>
        <td><code>${r.key}</code>${r.required ? ' <span class="req">required</span>' : ''}</td>
        <td>${r.description}</td>
        <td>${r.howToGet}</td>
        <td><code style="opacity:0.5">${r.example}</code></td>
      </tr>
    `).join('')

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:var(--vscode-font-family);padding:24px;color:var(--vscode-foreground);}
  h1{font-size:17px;font-weight:600;margin-bottom:4px;}
  p{font-size:13px;color:var(--vscode-descriptionForeground);margin-bottom:20px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th{text-align:left;padding:8px;border-bottom:2px solid var(--vscode-panel-border);font-weight:500;}
  td{padding:8px 6px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top;}
  code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-size:11px;}
  .req{background:rgba(239,68,68,0.15);color:#f87171;font-size:10px;padding:1px 5px;
       border-radius:8px;margin-left:4px;}
</style></head><body>
<h1>Environment Setup</h1>
<p>Add these to your <code>.env.local</code> file before running <code>npm run dev</code></p>
<table>
  <thead><tr><th>Variable</th><th>What it is</th><th>How to get it</th><th>Example</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`
  }

  private findFiles(root: string): string[] {
    const results: string[] = []
    const dirs = ['app', 'src/app', 'pages', 'src/pages', 'lib', 'src/lib', 'utils', 'src/utils']
    for (const dir of dirs) {
      const fullDir = path.join(root, dir)
      if (!fs.existsSync(fullDir)) continue
      try {
        fs.readdirSync(fullDir, { withFileTypes: true }).forEach(e => {
          if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.tsx'))) {
            results.push(path.join(fullDir, e.name))
          }
        })
      } catch {}
    }
    return results
  }
}
