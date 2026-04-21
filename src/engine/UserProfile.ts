import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

export interface UserPreferences {
  preferredStack: string[]         // ['nextjs', 'tailwind', 'typescript']
  preferredColorScheme: string     // 'dark' | 'ultra-dark' | 'minimal'
  preferredAnimationLevel: string  // 'subtle' | 'medium' | 'rich'
  preferredTemplate: string        // most successful template type
  buildCount: number
  totalSuccessfulBuilds: number
  brandColors?: string[]           // user's brand hex values
  companyName?: string
  lastPrompts: string[]            // last 5 prompts
  preferredProvider: string        // gemini | anthropic | openai
}

/**
 * UserProfile
 *
 * Persistent user preferences that personalize every build.
 * Learns from usage patterns — not just build quality.
 *
 * After 5 builds: ZOZO knows this user. 
 * After 20 builds: ZOZO feels like a developer who knows the team.
 */
export class UserProfile {
  private profilePath: string
  private profile: UserPreferences

  private readonly DEFAULTS: UserPreferences = {
    preferredStack:          ['nextjs', 'tailwind', 'typescript'],
    preferredColorScheme:    'dark',
    preferredAnimationLevel: 'medium',
    preferredTemplate:       'saas',
    buildCount:              0,
    totalSuccessfulBuilds:   0,
    lastPrompts:             [],
    preferredProvider:       'gemini',
  }

  constructor() {
    const dir = path.join(os.homedir(), '.zozo')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.profilePath = path.join(dir, 'user-profile.json')
    this.profile = this.load()
  }

  /**
   * Record a completed build and update preferences.
   * Called by Orchestrator after each build.
   */
  recordBuild(
    prompt: string,
    template: string,
    qualityScore: number,
    provider: string,
    success: boolean
  ): void {
    this.profile.buildCount++
    if (success) this.profile.totalSuccessfulBuilds++
    if (provider) this.profile.preferredProvider = provider

    // Update most successful template
    if (qualityScore >= 75 && template) {
      this.profile.preferredTemplate = template
    }

    // Track recent prompts
    this.profile.lastPrompts = [
      prompt.slice(0, 80),
      ...this.profile.lastPrompts,
    ].slice(0, 5)

    this.save()
  }

  /**
   * Set brand colors from user settings.
   */
  setBrandColors(hexColors: string[]): void {
    this.profile.brandColors = hexColors.slice(0, 4)
    this.save()
  }

  setCompanyName(name: string): void {
    this.profile.companyName = name
    this.save()
  }

  /**
   * Generate a personalization hint for BuilderAgent.
   * Injected into every build after the first 3.
   */
  toPromptHint(): string {
    if (this.profile.buildCount < 3) return ''

    const lines = [
      `## User Profile (${this.profile.buildCount} builds)`,
    ]

    if (this.profile.companyName) {
      lines.push(`Company: ${this.profile.companyName}`)
    }

    if (this.profile.brandColors && this.profile.brandColors.length > 0) {
      lines.push(`Brand colors: ${this.profile.brandColors.join(', ')} — use these as accent colors`)
    }

    lines.push(`Preferred animation level: ${this.profile.preferredAnimationLevel}`)
    lines.push(`Preferred color scheme: ${this.profile.preferredColorScheme}`)

    if (this.profile.totalSuccessfulBuilds > 5) {
      lines.push(`This user has built ${this.profile.totalSuccessfulBuilds} successful apps`)
      lines.push(`Their most successful template: ${this.profile.preferredTemplate}`)
    }

    return lines.join('\n')
  }

  getProfile(): UserPreferences {
    return { ...this.profile }
  }

  private load(): UserPreferences {
    try {
      if (fs.existsSync(this.profilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.profilePath, 'utf8')) as Partial<UserPreferences>
        return { ...this.DEFAULTS, ...raw }
      }
    } catch {}
    return { ...this.DEFAULTS }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2), 'utf8')
    } catch {}
  }
}
