import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { streamFromLLM } from './NetworkNode'
import { PipelineEventBus } from './PipelineEventBus'

// ── Modern Tech Stack Catalogue ───────────────────────────────────────────────

export const TECH_CATALOGUE = {
  frontend: [
    { id: 'nextjs',    name: 'Next.js 15',        badge: 'Recommended',   desc: 'React + SSR + App Router. Best for full-stack apps.' },
    { id: 'vite-react',name: 'Vite + React',       badge: 'Fast',          desc: 'Pure SPA. Great for dashboards & admin panels.' },
    { id: 'astro',     name: 'Astro',              badge: 'New',           desc: 'Islands architecture. Best for content-heavy sites.' },
    { id: 'sveltekit', name: 'SvelteKit',          badge: 'Lightweight',   desc: 'Svelte + SSR. Minimal JS, fast runtime.' },
  ],
  styling: [
    { id: 'tailwind',  name: 'Tailwind CSS v4',    badge: 'Recommended',   desc: 'Utility-first. Fastest to build beautiful UIs.' },
    { id: 'shadcn',    name: 'shadcn/ui',          badge: 'Component Lib', desc: 'Accessible, customizable Radix UI components.' },
    { id: 'vanilla',   name: 'Vanilla CSS',        badge: 'Flexible',      desc: 'Full control, no abstraction.' },
  ],
  backend: [
    { id: 'supabase',  name: 'Supabase',           badge: 'Recommended',   desc: 'Postgres + Auth + Realtime. Open-source Firebase.' },
    { id: 'firebase',  name: 'Firebase',           badge: 'Popular',       desc: 'Google NoSQL. Best for realtime apps.' },
    { id: 'prisma',    name: 'Prisma + PostgreSQL', badge: 'Type-safe',     desc: 'Type-safe ORM. Great for complex data models.' },
    { id: 'mongodb',   name: 'MongoDB + Mongoose',  badge: 'Flexible',      desc: 'Document DB. Good for rapid prototyping.' },
    { id: 'none',      name: 'No Backend',         badge: 'Static',        desc: 'Static or external API only.' },
  ],
  auth: [
    { id: 'supabase-auth', name: 'Supabase Auth',  badge: 'Recommended',   desc: 'Built-in with Supabase. Social logins + email.' },
    { id: 'clerk',     name: 'Clerk',              badge: 'Best DX',       desc: 'Drop-in auth components with beautiful UI.' },
    { id: 'next-auth', name: 'NextAuth.js v5',     badge: 'Open Source',   desc: 'Flexible auth for Next.js. OAuth + Credentials.' },
    { id: 'firebase-auth', name: 'Firebase Auth',  badge: 'Google',        desc: 'Built-in with Firebase.' },
    { id: 'none',      name: 'No Auth',            badge: '',              desc: 'Public app, no login needed.' },
  ],
  payments: [
    { id: 'stripe',    name: 'Stripe',             badge: 'Standard',      desc: 'Best-in-class payment processing.' },
    { id: 'lemon',     name: 'Lemon Squeezy',      badge: 'SaaS-friendly', desc: 'Merchant of record. Good for digital products.' },
    { id: 'none',      name: 'No Payments',        badge: '',              desc: 'No payment processing needed.' },
  ],
  deploy: [
    { id: 'vercel',    name: 'Vercel',             badge: 'Recommended',   desc: 'Zero-config deploy for Next.js.' },
    { id: 'netlify',   name: 'Netlify',            badge: 'Popular',       desc: 'Simple deploy + edge functions.' },
    { id: 'railway',   name: 'Railway',            badge: 'Full-stack',    desc: 'Deploy Next.js + Postgres in one click.' },
  ],
  extras: [
    { id: 'framer',    name: 'Framer Motion',      badge: 'Animations',    desc: 'Production-ready animations for React.' },
    { id: 'tanstack',  name: 'TanStack Query',     badge: 'Data Fetching', desc: 'Async state management. Replaces useEffect+fetch.' },
    { id: 'zustand',   name: 'Zustand',            badge: 'State',         desc: 'Lightweight global state. No boilerplate.' },
    { id: 'zod',       name: 'Zod',                badge: 'Validation',    desc: 'TypeScript-first schema validation.' },
    { id: 'resend',    name: 'Resend',             badge: 'Emails',        desc: 'Modern email API. React Email templates.' },
    { id: 'uploadthing',name: 'UploadThing',       badge: 'File Upload',   desc: 'Type-safe file uploads for Next.js.' },
  ],
}

const ARCHITECT_SYSTEM = `You are ZOZO's Senior Architect Agent — the most experienced full-stack developer and system designer on the planet.

Your personality: Direct, opinionated, and brilliant. You think like a CTO. You don't just build what the user asks — you build what they NEED.

Your responsibilities:
1. Understand the vision — Extract exactly what the user wants to build and who it's for
2. Propose the best stack — Choose modern, production-ready tools. Explain WHY you're choosing each one
3. Ask smart questions — Only ask what you actually need to know. Don't waste the user's time
4. Create a detailed blueprint — Before any code is written, generate a complete architecture plan
5. Be opinionated — If the user wants to use an outdated tool, tell them and suggest better alternatives

When you have enough information, output the blueprint in this format:

## 🏗️ Architecture Blueprint: [App Name]

### What We're Building
[2-3 sentences. Specific. Target user + core problem.]

### 🔧 Tech Stack
[List each choice with WHY]

### 📁 Project Structure
[Key files/folders in a code block]

### 🗄️ Data Model
[Key entities and relationships]

### 🚀 Features (Phase 1)
[Bullet list of MVP features]

### 💰 API Keys Needed
[List any external services and their keys]

### ⏱️ Estimated Build
[Time + quality setting recommendation]

End with: "**Approve this blueprint to start building, or tell me what to change.**"

Be a genius. Be direct. Be specific.`

export interface ArchitectPlan {
  appName: string
  rawBlueprint: string
  techStack: {
    frontend: string
    styling: string
    backend: string
    auth: string
    payments: string
    deploy: string
    extras: string[]
  }
  apiKeysNeeded: Array<{ service: string; envVar: string; url: string }>
  features: string[]
  fileStructure: string
  sourceUrl?: string
  approved: boolean
}

export interface ArchitectSession {
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string }>
  currentPlan?: ArchitectPlan
  awaitingApproval: boolean
}

const _sessions = new Map<string, ArchitectSession>()

export class ArchitectAgent {
  private bus = PipelineEventBus.getInstance()

  async handleMessage(
    userMessage: string,
    provider: string,
    apiKey: string,
    workspaceRoot: string
  ): Promise<{ approved: boolean; plan?: ArchitectPlan }> {
    const sessionKey = workspaceRoot || 'global'
    let session = _sessions.get(sessionKey) ?? {
      conversationHistory: [],
      awaitingApproval: false,
    }

    const sessionId = 'architect-' + Date.now()

    // Check if the user pasted a blueprint themselves
    const hasUserBlueprintMarkers = userMessage.includes('Architecture Blueprint') || userMessage.includes('Approve this blueprint')
    if (hasUserBlueprintMarkers) {
      const urlMatch = userMessage.match(/https?:\/\/[^\s]+/)
      const plan = this.parsePlanFromText(userMessage, urlMatch?.[0])
      session.currentPlan = plan
      session.awaitingApproval = true
    }

    // Check if user is approving the plan
    if (session.awaitingApproval && session.currentPlan) {
      const approvalWords = ['yes', 'approve', 'go', 'start', 'build', 'build it', 'proceed', 'ok', 'okay', 'looks good', 'perfect', 'great']
      const lowerMsg = userMessage.toLowerCase().trim()
      const isApproval = approvalWords.some(w =>
        lowerMsg === w ||
        lowerMsg.startsWith(w + ' ') ||
        lowerMsg.startsWith(w + '.')
      ) || lowerMsg.includes('start') || lowerMsg.includes('build') || lowerMsg.includes('proceed') || hasUserBlueprintMarkers


      if (isApproval) {
        session.currentPlan.approved = true
        _sessions.set(sessionKey, session)
        this.bus.emit({
          type: 'chat_system_message',
          sessionId,
          text: '🚀 **Blueprint approved!** Starting the build pipeline...',
        })
        return { approved: true, plan: session.currentPlan }
      }
    }

    session.conversationHistory.push({ role: 'user', content: userMessage })

    const urlMatch = userMessage.match(/https?:\/\/[^\s]+/)
    if (urlMatch) {
      this.bus.emit({
        type: 'chat_system_message',
        sessionId,
        text: `🔍 Detected URL: \`${urlMatch[0]}\` — I'll use this as a design reference for the UI.`,
      })
    }

    const techCatalogueContext = this.buildTechContext()

    const conversationPrompt = session.conversationHistory
      .map(m => `${m.role === 'user' ? 'User' : 'ZOZO Architect'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = `${techCatalogueContext}\n\n--- CONVERSATION ---\n${conversationPrompt}\n\nZOZO Architect:`

    this.bus.emit({ type: 'chat_start', sessionId })

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
      ARCHITECT_SYSTEM,
      {
        maxOutputTokens: 4096,
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

    this.bus.emit({ type: 'chat_end', sessionId })

    session.conversationHistory.push({ role: 'assistant', content: accumulated })

    const hasBlueprintMarkers = accumulated.includes('Architecture Blueprint') ||
      accumulated.includes('Approve this blueprint')

    if (hasBlueprintMarkers) {
      const plan = this.parsePlanFromText(accumulated, urlMatch?.[0])
      session.currentPlan = plan
      session.awaitingApproval = true

      if (plan.apiKeysNeeded.length > 0) {
        const keysList = plan.apiKeysNeeded.map(k => `  * **${k.service}** (\`${k.envVar}\`) — ${k.url}`).join('\n')
        this.bus.emit({
          type: 'chat_system_message',
          sessionId: sessionId + '-keys',
          text: `🔑 **API Keys Required:**\n${keysList}\n\n_Add these via the Settings panel._`,
        })
      }
    }

    _sessions.set(sessionKey, session)
    return { approved: false }
  }

  clearSession(workspaceRoot: string) {
    _sessions.delete(workspaceRoot || 'global')
  }

  private buildTechContext(): string {
    const lines = ['### Available Modern Tools:\n']
    for (const [category, options] of Object.entries(TECH_CATALOGUE)) {
      lines.push(`**${category.toUpperCase()}:**`)
      for (const o of options) {
        lines.push(`  - ${o.name} [${o.badge}]: ${o.desc}`)
      }
    }
    return lines.join('\n')
  }

  private parsePlanFromText(text: string, sourceUrl?: string): ArchitectPlan {
    const nameMatch = text.match(/Architecture Blueprint[:\s]+(.+)/i)
    const appName = nameMatch ? nameMatch[1].trim().replace(/[*#]/g, '') : 'My App'

    const apiKeysNeeded: Array<{ service: string; envVar: string; url: string }> = []
    const apiKeyPatterns = [
      { pattern: /supabase/i,    service: 'Supabase',      envVar: 'NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY',       url: 'https://supabase.com/dashboard' },
      { pattern: /firebase/i,    service: 'Firebase',      envVar: 'FIREBASE_API_KEY',                                     url: 'https://console.firebase.google.com' },
      { pattern: /stripe/i,      service: 'Stripe',        envVar: 'STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', url: 'https://dashboard.stripe.com/apikeys' },
      { pattern: /clerk/i,       service: 'Clerk',         envVar: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY',   url: 'https://dashboard.clerk.com' },
      { pattern: /openai/i,      service: 'OpenAI',        envVar: 'OPENAI_API_KEY',                                       url: 'https://platform.openai.com/api-keys' },
      { pattern: /resend/i,      service: 'Resend',        envVar: 'RESEND_API_KEY',                                       url: 'https://resend.com/api-keys' },
      { pattern: /uploadthing/i, service: 'UploadThing',   envVar: 'UPLOADTHING_SECRET',                                   url: 'https://uploadthing.com/dashboard' },
      { pattern: /lemon.squeezy/i,service:'Lemon Squeezy', envVar: 'LEMON_SQUEEZY_API_KEY',                                url: 'https://app.lemonsqueezy.com' },
    ]

    for (const { pattern, service, envVar, url } of apiKeyPatterns) {
      if (pattern.test(text)) apiKeysNeeded.push({ service, envVar, url })
    }

    return {
      appName,
      rawBlueprint: text,
      techStack: {
        frontend: this.extractMatch(text, /next\.?js|react|svelte|astro|vue/i) || 'Next.js',
        styling: this.extractMatch(text, /tailwind|vanilla css|css modules|styled/i) || 'Tailwind CSS',
        backend: this.extractMatch(text, /supabase|firebase|prisma|mongodb/i) || 'Supabase',
        auth: this.extractMatch(text, /clerk|nextauth|supabase auth|firebase auth/i) || 'Supabase Auth',
        payments: this.extractMatch(text, /stripe|lemon squeezy|paddle/i) || 'None',
        deploy: this.extractMatch(text, /vercel|netlify|railway|aws/i) || 'Vercel',
        extras: this.extractExtras(text),
      },
      apiKeysNeeded,
      features: this.extractFeatures(text),
      fileStructure: this.extractFileStructure(text),
      sourceUrl,
      approved: false,
    }
  }

  private extractMatch(text: string, pattern: RegExp): string {
    const match = text.match(pattern)
    return match ? match[0] : ''
  }

  private extractExtras(text: string): string[] {
    const extras: string[] = []
    if (/framer motion/i.test(text)) extras.push('Framer Motion')
    if (/tanstack/i.test(text)) extras.push('TanStack Query')
    if (/zustand/i.test(text)) extras.push('Zustand')
    if (/zod/i.test(text)) extras.push('Zod')
    if (/resend/i.test(text)) extras.push('Resend')
    return extras
  }

  private extractFeatures(text: string): string[] {
    const lines = text.split('\n')
    const features: string[] = []
    let inFeatures = false
    for (const line of lines) {
      if (/features|phase 1/i.test(line) && line.startsWith('#')) { inFeatures = true; continue }
      if (inFeatures && line.startsWith('#')) { inFeatures = false; continue }
      if (inFeatures && /^[-*•]/.test(line.trim())) {
        features.push(line.replace(/^[-*•]\s*/, '').trim())
      }
    }
    return features.slice(0, 10)
  }

  private extractFileStructure(text: string): string {
    const codeBlockMatch = text.match(/```[\w]*\n([\s\S]*?)```/)
    return codeBlockMatch ? codeBlockMatch[1] : ''
  }
}
