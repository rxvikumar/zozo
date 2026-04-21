import * as vscode from 'vscode'

export type LogType = 'info' | 'step' | 'success' | 'warning' | 'error' | 'cost' | 'score'

export interface LogEntry {
  type: LogType
  message: string
  timestamp: string
}

const ICONS: Record<LogType, string> = {
  info:    '  ',
  step:    '▶ ',
  success: '✅',
  warning: '⚠️ ',
  error:   '❌',
  cost:    '💰',
  score:   '📊',
}

/**
 * PipelineLogger
 *
 * Structured logging for the ZOZO pipeline.
 * Writes to VS Code output channel with consistent formatting.
 * Keeps an in-memory log for the current session.
 *
 * Pattern from coding-agent-template TaskLogger (info/command/error/success types).
 */
export class PipelineLogger {
  private channel: vscode.OutputChannel
  private entries: LogEntry[] = []
  private readonly divider = '─'.repeat(50)

  constructor(channel: vscode.OutputChannel) {
    this.channel = channel
  }

  step(name: string): void {
    this.write('step', `\n${this.divider}\n${name}`)
  }

  info(message: string): void {
    this.write('info', message)
  }

  success(message: string): void {
    this.write('success', message)
  }

  warning(message: string): void {
    this.write('warning', message)
  }

  error(message: string): void {
    this.write('error', message)
  }

  cost(message: string): void {
    this.write('cost', message)
  }

  score(message: string): void {
    this.write('score', message)
  }

  /** Log a quality gate result block */
  qualityResult(scoreText: string): void {
    this.channel.appendLine('')
    for (const line of scoreText.split('\n')) {
      this.channel.appendLine(`[ZOZO] ${line}`)
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries]
  }

  getEntriesByType(type: LogType): LogEntry[] {
    return this.entries.filter(e => e.type === type)
  }

  private write(type: LogType, message: string): void {
    const entry: LogEntry = {
      type,
      message,
      timestamp: new Date().toISOString(),
    }
    this.entries.push(entry)

    const icon = ICONS[type]
    // Multi-line messages get each line prefixed
    for (const line of message.split('\n')) {
      if (line.trim()) {
        this.channel.appendLine(`[ZOZO] ${icon} ${line}`)
      } else {
        this.channel.appendLine('')
      }
    }
  }
}
