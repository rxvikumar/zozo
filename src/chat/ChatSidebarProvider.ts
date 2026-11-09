import * as vscode from 'vscode'
import { PipelineEventBus } from '../engine/PipelineEventBus'
import { ZozoVault } from '../security/Vault'

function getNonce() {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

const MODELS = [
  // ── Gemini (Free tier) ─────────────────────────────────────────────
  { id: 'gemini-3.5-flash-medium', label: 'Gemini 3.5 Flash', badge: 'Free', provider: 'Gemini', tier: 'free' },
  { id: 'gemini-3.5-flash-high',   label: 'Gemini 3.5 Flash Pro', badge: 'Free', provider: 'Gemini', tier: 'free' },
  { id: 'gemini-3.5-flash-low',    label: 'Gemini 3.5 Flash Lite', badge: 'Free', provider: 'Gemini', tier: 'free' },
  // ── Gemini (Paid tier) ─────────────────────────────────────────────
  { id: 'gemini-3.1-pro-low',  label: 'Gemini 3.1 Pro', badge: 'Paid 💳', provider: 'Gemini', tier: 'paid' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro Ultra', badge: 'Paid 💳', provider: 'Gemini', tier: 'paid' },
  // ── Anthropic Claude ─────────────────────────────────────────────
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', badge: 'Thinking', provider: 'Anthropic', tier: 'paid' },
  { id: 'claude-opus-4.6',   label: 'Claude Opus 4.6',   badge: 'Thinking', provider: 'Anthropic', tier: 'paid' },
  // ── OpenAI GPT-6 ────────────────────────────────────────────────
  { id: 'gpt-6-astra', label: 'GPT-6 Astra',   badge: 'Fastest', provider: 'OpenAI', tier: 'paid' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol',   badge: 'Balanced', provider: 'OpenAI', tier: 'paid' },
  { id: 'gpt-6-luna',  label: 'GPT-6 Luna',    badge: 'Quality', provider: 'OpenAI', tier: 'paid' },
]

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private _context: vscode.ExtensionContext
  private _vault: ZozoVault
  private lastAiMessageContent: string = ''

  constructor(context: vscode.ExtensionContext) {
    this._context = context
    this._vault = new ZozoVault(context)

    const bus = PipelineEventBus.getInstance()
    bus.subscribe(event => {
      if (event.type === 'chat_chunk') {
        this.lastAiMessageContent = (this.lastAiMessageContent || '') + event.chunk
      }
      if (event.type === 'chat_end' && this.lastAiMessageContent) {
        this.saveToHistory('assistant', this.lastAiMessageContent)
        this.lastAiMessageContent = ''
      }
      if (event.type === 'chat_system_message') {
        this.saveToHistory('system', event.text ?? '')
      }
      this._view?.webview.postMessage({ type: 'pipeline_event', event })
    })
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    }

    webviewView.webview.html = this.getHtml()

    webviewView.webview.onDidReceiveMessage(async message => {
      try {
        switch (message.command) {
          case 'sendMessage':
            this.saveToHistory('user', message.text)
            // ── Record to global history for IntentResolver ──────────────────
            if (!(global as any).__zozo_history) (global as any).__zozo_history = []
            ;(global as any).__zozo_history.push({ role: 'user', content: message.text })
            // Keep last 16 turns (8 exchanges)
            if ((global as any).__zozo_history.length > 16) {
              ;(global as any).__zozo_history = (global as any).__zozo_history.slice(-16)
            }
            await vscode.commands.executeCommand('zozo.promptAI', {
              prompt: message.text,
              mode: message.mode ?? 'normal',
              modelId: message.modelId,
              provider: message.provider ?? 'Gemini',
            })
            break
          case 'cancelBuild':
            PipelineEventBus.getInstance().cancel()
            break
          case 'openSettings':
            await vscode.commands.executeCommand('zozo.openSettings')
            break
          case 'setMode':
            await this._context.globalState.update('zozo.mode', message.mode)
            break
          case 'checkApiKey': {
            const key = await this._vault.getKey(message.provider)
            webviewView.webview.postMessage({
              type: 'apiKeyStatus',
              provider: message.provider,
              hasKey: !!key,
            })
            break
          }
          case 'saveApiKey': {
            if (message.key?.trim()) {
              await this._vault.storeKey(message.provider, message.key.trim())
              webviewView.webview.postMessage({
                type: 'apiKeySaved',
                provider: message.provider,
              })
            }
            break
          }
          case 'deleteApiKey': {
            await this._vault.deleteKey(message.provider)
            webviewView.webview.postMessage({
              type: 'apiKeyDeleted',
              provider: message.provider,
            })
            break
          }
          case 'checkAllKeys': {
            const providers = ['Gemini', 'Anthropic', 'OpenAI', 'Firecrawl']
            for (const p of providers) {
              const key = await this._vault.getKey(p)
              webviewView.webview.postMessage({
                type: 'apiKeyStatus',
                provider: p,
                hasKey: !!key,
              })
            }
            break
          }
          case 'getHistory': {
            const history = this._context.globalState.get<any[]>('zozo.chatHistory', [])
            webviewView.webview.postMessage({ type: 'history_loaded', history })
            break
          }
          case 'loadChat': {
            const history = this._context.globalState.get<any[]>('zozo.chatHistory', [])
            const session = history[message.index]
            if (session) {
              this._context.globalState.update('zozo.currentSessionId', session.id)
              webviewView.webview.postMessage({ type: 'chat_restored', messages: session.messages })
            }
            break
          }
          case 'clearChat': {
            this._context.globalState.update('zozo.currentSessionId', null)
            break
          }
          case 'deleteChat': {
            let history = this._context.globalState.get<any[]>('zozo.chatHistory', [])
            if (message.index >= 0 && message.index < history.length) {
              const session = history[message.index]
              history.splice(message.index, 1)
              this._context.globalState.update('zozo.chatHistory', history)
              const currentSessionId = this._context.globalState.get<string>('zozo.currentSessionId')
              if (currentSessionId === session.id) {
                this._context.globalState.update('zozo.currentSessionId', null)
              }
            }
            break
          }
          case 'truncateHistory': {
            let history = this._context.globalState.get<any[]>('zozo.chatHistory', [])
            let currentSessionId = this._context.globalState.get<string>('zozo.currentSessionId')
            if (currentSessionId) {
              const session = history.find(s => s.id === currentSessionId)
              if (session && typeof message.keepCount === 'number') {
                session.messages = session.messages.slice(0, message.keepCount)
                this._context.globalState.update('zozo.chatHistory', history)
              }
            }
            break
          }
          case 'editMessageBackend': {
            let history = this._context.globalState.get<any[]>('zozo.chatHistory', [])
            let currentSessionId = this._context.globalState.get<string>('zozo.currentSessionId')
            if (currentSessionId) {
              const session = history.find(s => s.id === currentSessionId)
              if (session && typeof message.index === 'number') {
                if (session.messages[message.index]) {
                  session.messages[message.index].content = message.text
                  this._context.globalState.update('zozo.chatHistory', history)
                }
              }
            }
            break
          }
          case 'copyText': {
            vscode.env.clipboard.writeText(message.text)
            break
          }
          case 'send': {
            const sendText = message.text
            if (sendText) {
              const sessionId2 = this._context.globalState.get<string>('zozo.currentSessionId')
              const history2 = this._context.globalState.get<any[]>('zozo.chatHistory', [])
              const session2 = sessionId2 ? history2.find((s: any) => s.id === sessionId2) : null
              if (session2) {
                session2.messages.push({ role: 'user', content: sendText, timestamp: Date.now() })
                this._context.globalState.update('zozo.chatHistory', history2)
              }
              await vscode.commands.executeCommand('zozo.promptAI', {
                prompt: sendText,
                mode: message.mode ?? 'ultra',
                modelId: message.modelId,
                provider: message.provider ?? 'Gemini',
              })
            }
            break
          }
          case 'confirmRevert': {
            vscode.window.showWarningMessage(
              "These changes were made and reverting back all changes will be undone. Want to revert?",
              { modal: true },
              "Revert"
            ).then(selection => {
              if (selection === "Revert") {
                webviewView.webview.postMessage({ type: 'executeRevert', keepCount: message.keepCount, text: message.text || '' })
              }
            })
            break
          }
          // ── Firecrawl chat confirmation (yes/no card) ─────────────────
          case 'firecrawl_confirm': {
            PipelineEventBus.getInstance().emit({
              type: 'firecrawl_answer',
              sessionId: message.sessionId ?? '',
              approved: message.approved ?? false,
            } as any)
            break
          }
          // ── Wave preview decisions (ComponentWaveEngine listens on bus) ──
          case 'wave_approved': {
            PipelineEventBus.getInstance().emit({
              type: 'wave_approved',
              sessionId: message.sessionId ?? '',
              waveNumber: message.waveNumber,
            })
            break
          }
          case 'wave_modify': {
            PipelineEventBus.getInstance().emit({
              type: 'wave_modify',
              sessionId: message.sessionId ?? '',
              waveNumber: message.waveNumber,
            })
            break
          }
          case 'wave_stopped': {
            PipelineEventBus.getInstance().emit({
              type: 'wave_stopped',
              sessionId: message.sessionId ?? '',
              waveNumber: message.waveNumber,
            })
            break
          }
          // ── Plan approval gate ───────────────────────────────────────────
          case 'planApproved': {
            PipelineEventBus.getInstance().emit({
              type: 'plan_approved',
              sessionId: message.sessionId ?? '',
            } as any)
            break
          }
          case 'planCancelled': {
            PipelineEventBus.getInstance().emit({
              type: 'plan_cancelled',
              sessionId: message.sessionId ?? '',
            } as any)
            break
          }
          // ── Intent card: user submitted answers (BuildProfile listens) ───
          case 'intent_submit': {
            PipelineEventBus.getInstance().emit({
              type: 'intent_complete',
              sessionId: message.sessionId ?? '',
              answers: message.answers ?? {},
            } as any)
            break
          }
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err) ?? 'unknown error'
        console.error('[ZOZO] message handler error:', msg, err)
        try {
          webviewView.webview.postMessage({
            type: 'pipeline_event',
            event: { type: 'chat_system_message', text: `⚠️ ZOZO error: ${msg}`, isError: true }
          })
        } catch { /* webview may be disposed */ }
      }
    }, undefined, this._context.subscriptions)
  }

  // Hook into event bus to save history
  private saveToHistory(role: string, content: string) {
    let history = this._context.globalState.get<any[]>('zozo.chatHistory', [])
    let sessionId = this._context.globalState.get<string>('zozo.currentSessionId')

    if (!sessionId) {
      sessionId = 'chat-' + Date.now()
      this._context.globalState.update('zozo.currentSessionId', sessionId)
      history.unshift({ id: sessionId, title: content.substring(0, 30) + '...', timestamp: Date.now(), messages: [] })
    }

    const session = history.find(s => s.id === sessionId)
    if (session) {
      session.messages.push({ role, content })
      this._context.globalState.update('zozo.chatHistory', history)
    }
  }

  private getHtml(): string {
    const nonce = getNonce()
    const modelsJson = JSON.stringify(MODELS);

    // Inject renderMarkdown perfectly preserving syntax
    function renderMarkdown(text: string) {
      var escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      var bt = String.fromCharCode(96);
      var tbt = bt + bt + bt;
      var tripleRe = new RegExp(tbt + "(\\w*)\\n?([\\s\\S]*?)" + tbt, "g");
      escaped = escaped.replace(tripleRe, function (m, lang, code) {
        return "<pre><code>" + code.trim() + "</code></pre>";
      });
      var inlineRe = new RegExp(bt + "([^" + bt + "]+)" + bt, "g");
      escaped = escaped.replace(inlineRe, "<code>$1</code>");
      escaped = escaped.replace(/^### (.+)$/gm, "<h3>$1</h3>");
      escaped = escaped.replace(/^## (.+)$/gm, "<h2>$1</h2>");
      escaped = escaped.replace(/^# (.+)$/gm, "<h2>$1</h2>");
      escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      escaped = escaped.replace(/\*(.+?)\*/g, "<em>$1</em>");
      escaped = escaped.replace(/^---+$/gm, "<hr>");
      escaped = escaped.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
      escaped = escaped.replace(/(<li>[\s\S]*?<\/li>)+/g, "<ul>$&</ul>");
      escaped = escaped.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
      escaped = escaped.replace(/\n/g, "<br>");
      escaped = escaped.replace(/<pre>([\s\S]*?)<\/pre>/g, function (m, inner) {
        return "<pre>" + inner.replace(/<br>/g, "\n") + "</pre>";
      });
      return escaped;
    }
    const markdownFnCode = renderMarkdown.toString();

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline'; img-src vscode-resource: https: data:;">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #1e1e1e; /* Standard VS Code dark */
    --surface: #252526;
    --border: #333333;
    --border-hover: #454545;
    --text-bright: #ffffff;
    --text: #cccccc;
    --muted: #858585;
    --accent: #0078d4;
    --hover-bg: rgba(255,255,255,0.06);
  }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
    font-size: 13px; height: 100vh;
    display: flex; flex-direction: column; overflow: hidden;
    /* Clean professional right border, using standard VS Code variables */
    border-right: 1px solid var(--vscode-sideBarSectionHeader-border, var(--border));
    width: 100%; box-sizing: border-box;
  }

  /* ── Header ── */
  .header {
    display: flex; justify-content: flex-start; align-items: center;
    padding: 10px 14px; border-bottom: 1px solid var(--border);
    background: var(--bg); flex-shrink: 0; z-index: 10;
  }
  .header-logo { font-size: 14px; font-weight: 700; color: var(--text-bright); letter-spacing: 1px; text-transform: uppercase; }

  /* ── Messages Area ── */
  .messages { flex: 1; overflow-y: auto; min-height: 0; padding: 16px 14px; display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 1; }
  
  .welcome { padding: 30px 10px; text-align: center; }
  .welcome h2 { font-size: 20px; font-weight: 500; margin-bottom: 8px; color: var(--text-bright); }
  .welcome p { font-size: 13px; color: var(--muted); margin-bottom: 24px; }
  .examples-grid { display: flex; flex-direction: column; gap: 8px; max-width: 400px; margin: 0 auto; }
  .example {
    padding: 10px 14px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; font-size: 12px; color: var(--text); cursor: pointer;
    transition: background 0.15s; text-align: left;
  }
  .example:hover { background: var(--hover-bg); border-color: var(--border-hover); }

  /* ── Chat Bubbles ── */
  .msg { display: flex; flex-direction: column; gap: 4px; }
  .msg.user { align-items: flex-end; }
  .msg.system { align-items: flex-start; }
  .bubble { max-width: 90%; padding: 10px 14px; border-radius: 8px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
  .msg.user .bubble { background: var(--surface); border: 1px solid var(--border); color: var(--text-bright); }
  .msg.system .bubble { background: transparent; padding-left: 0; padding-right: 0; }

  /* ── API Key Panel ── */
  .apikey-panel {
    display: none; padding: 12px 14px; background: var(--surface);
    border-top: 1px solid var(--border); flex-shrink: 0; z-index: 5;
  }
  .apikey-panel.open { display: block; }
  .apikey-provider-row { margin-bottom: 10px; }
  .apikey-label-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .apikey-provider-name { font-size: 11px; color: var(--text); font-weight: 500; min-width: 64px; }
  .apikey-input-row { display: flex; gap: 6px; align-items: center; }
  .apikey-saved-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .apikey-input {
    flex: 1; background: var(--bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 5px 8px; color: var(--text-bright); font-size: 11px;
    outline: none; font-family: monospace;
  }
  .apikey-input:focus { border-color: var(--accent); }
  .apikey-save { font-size: 11px; padding: 4px 10px; background: var(--accent); border: none; color: #fff; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .apikey-save:hover { opacity: 0.85; }
  .apikey-delete {
    display: flex; align-items: center; gap: 4px; font-size: 10px; padding: 3px 8px;
    background: transparent; border: 1px solid rgba(211,47,47,0.4); color: #f48771;
    border-radius: 4px; cursor: pointer; transition: all 0.15s;
  }
  .apikey-delete:hover { background: rgba(211,47,47,0.15); border-color: #f48771; }

  /* ── Markdown in bubbles ── */
  .msg.system .bubble pre { background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; overflow-x: auto; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.5; margin: 8px 0; white-space: pre; }
  .msg.system .bubble code { background: rgba(0,0,0,0.25); border-radius: 3px; padding: 1px 5px; font-family: 'Courier New', monospace; font-size: 12px; }
  .msg.system .bubble pre code { background: none; padding: 0; }
  .msg.system .bubble h2 { font-size: 13px; font-weight: 600; color: var(--text-bright); margin: 10px 0 4px; }
  .msg.system .bubble h3 { font-size: 12px; font-weight: 600; color: var(--text-bright); margin: 8px 0 3px; }
  .msg.system .bubble ul, .msg.system .bubble ol { padding-left: 18px; margin: 4px 0; }
  .msg.system .bubble li { margin: 2px 0; }
  .msg.system .bubble strong { color: var(--text-bright); font-weight: 600; }
  .msg.system .bubble hr { border: none; border-top: 1px solid var(--border); margin: 8px 0; }
  .msg.system .bubble p { margin: 4px 0; }


  /* ── Error Banner ── */
  .banner { display: none; margin: 0 14px 10px; padding: 8px 12px; border-radius: 6px; font-size: 11px; background: rgba(211,47,47,0.1); border: 1px solid rgba(211,47,47,0.3); color: #ff6b6b; z-index: 5; }
  .banner.open { display: flex; align-items: center; justify-content: space-between; }
  .banner-action { background: transparent; border: 1px solid currentColor; border-radius: 4px; color: inherit; padding: 2px 8px; cursor: pointer; }

  /* ── Progress Strip ── */
  .progress-strip { display: none; padding: 8px 14px; font-size: 11px; color: var(--muted); flex-shrink: 0; background: var(--bg); z-index: 5; }
  .progress-strip.visible { display: flex; justify-content: space-between; align-items: center; }
  .spinner { width: 12px; height: 12px; border: 2px solid var(--muted); border-top-color: var(--text-bright); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; display: inline-block; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Input Area ── */
  .input-area-wrapper { padding: 10px 14px 14px; background: var(--bg); flex-shrink: 0; position: relative; z-index: 10; }
  .input-box-container {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    display: flex; flex-direction: column;
    transition: border-color 0.2s;
    position: relative;
    z-index: 1;
  }
  .input-box-container:focus-within { border-color: #555; }
  /* Generating state: pulsing border so user knows AI is working */
  .input-box-container.generating { border-color: var(--accent); animation: pulse-border 1.5s ease-in-out infinite; }
  @keyframes pulse-border { 0%,100% { border-color: var(--accent); } 50% { border-color: #005fa3; } }
  /* Make SVGs inside buttons non-interactive so clicks always reach the parent button */
  button svg, button svg * { pointer-events: none; }
  
  .input-box {
    background: transparent; border: none; padding: 10px 12px; color: var(--text-bright);
    font-size: 13px; resize: none; width: 100%; min-height: 38px; max-height: 180px; outline: none; font-family: inherit; line-height: 1.45;
    white-space: pre-wrap; word-break: normal; overflow-wrap: break-word; overflow-x: hidden; overflow-y: hidden; box-sizing: border-box;
  }
  .input-box::placeholder { color: var(--muted); }
  
  /* ── Toolbar inside Input ── */
  .input-toolbar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 8px 8px; gap: 4px;
  }
  .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 4px; }
  .toolbar-left { flex: 1; min-width: 0; } /* Allow left side to shrink */
  
  .icon-btn {
    background: transparent; border: none; color: var(--muted); width: 24px; height: 24px; flex-shrink: 0;
    border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-size: 14px; transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover { color: var(--text-bright); background: var(--hover-bg); }

  /* ── Model Select Dropdown ── */
  .model-select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-bright);
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 5px;
    outline: none;
    cursor: pointer;
    font-family: inherit;
    max-width: 175px;
  }
  .model-select:hover, .model-select:focus {
    border-color: var(--accent);
  }
  .model-select option {
    background: #252526;
    color: #ffffff;
  }

  /* ── Dropdown Button & Menu ── */
  .model-dropdown-container { position: relative; display: flex; min-width: 0; }
  .model-btn {
    background: transparent; border: none; color: var(--muted); font-size: 11px;
    padding: 4px 6px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px;
    transition: color 0.15s, background 0.15s; font-family: inherit;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; min-width: 0;
  }
  .model-btn:hover { color: var(--text-bright); background: var(--hover-bg); }

  /* Floating menu pointing UPWARDS */
  .dropdown-menu {
    display: none; position: absolute; bottom: calc(100% + 8px); 
    left: 0; min-width: 220px; max-width: 90vw;
    background: var(--surface); border: 1px solid var(--border-hover); border-radius: 6px;
    max-height: 320px; overflow-y: auto; overflow-x: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.6); padding: 4px 0; z-index: 10000;
  }
  .dropdown-menu.open { display: block; }
  
  .dropdown-item {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 8px 12px; cursor: pointer; color: var(--text); font-size: 12px;
    transition: background 0.1s; white-space: nowrap;
  }
  .dropdown-item:hover, .dropdown-item.selected { background: var(--hover-bg); color: var(--text-bright); }
  .dropdown-item .badge { font-size: 10px; color: var(--muted); flex-shrink: 0; }

  /* ── Send Button (Solid Circle) ── */
  .send-btn {
    background: var(--accent); border: none; color: white; width: 24px; height: 24px;
    border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, transform 0.1s; margin-left: 4px;
  }
  .send-btn:hover { background: #1184df; }
  .send-btn:active { transform: scale(0.95); }
  .send-btn svg { width: 12px; height: 12px; fill: currentColor; }
  .send-btn.cancel { background: #555; }

  /* ── Mode Selector ── */
  /* ctx-chip: quick library buttons in context dropdown */
  .ctx-chip {
    padding: 3px 9px; font-size: 10px; border-radius: 4px; cursor: pointer;
    background: var(--bg); border: 1px solid var(--border); color: var(--muted);
    transition: all 0.15s;
  }
  .ctx-chip:hover { border-color: var(--accent); color: var(--text-bright); background: rgba(124,58,237,0.1); }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: #555; }
</style>
</head>
<body>

<!-- Header -->
<div class="header" style="justify-content: space-between;">
  <div class="header-logo">ZOZO</div>
  <div style="display:flex; align-items:center; gap:4px;">
    <button class="icon-btn" id="btn-history" title="Chat History" style="font-size:12px;"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.5 3a.5.5 0 0 1 .5.5v4.207l2.146 2.147a.5.5 0 0 1-.708.708l-2.5-2.5A.5.5 0 0 1 7 7.5V3.5a.5.5 0 0 1 .5-.5z"/></svg></button>
    <button class="icon-btn" id="btn-new" title="New Chat" style="font-size:12px;"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z"/></svg></button>
  </div>
</div>

<!-- History Overlay -->
<div id="historyPanel" style="display:none; position:absolute; top:40px; left:0; right:0; bottom:0; background:var(--bg); z-index:100; flex-direction:column;">
  <div style="padding:14px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
    <strong style="color:var(--text-bright); font-size:13px;">Chat History</strong>
    <button class="icon-btn" id="btn-close-history" style="width:20px;height:20px;">✖</button>
  </div>
  <div id="historyList" style="flex:1; overflow-y:auto; padding:8px;"></div>
</div>

<!-- Messages Area -->
<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <h2>What do you want to build?</h2>
    <p>Describe your app. ZOZO writes the code.</p>
    <div class="examples-grid">
      <div class="example">Build a dark SaaS landing page with pricing</div>
      <div class="example">Build a web3 NFT marketplace</div>
      <div class="example">Fix the TypeScript errors in the main layout</div>
    </div>
  </div>
</div>

<!-- API Key Panel -->
<div class="apikey-panel" id="apikeyPanel">
  <div style="font-size:11px;color:var(--text-bright);font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a4 4 0 0 1 7.465-2H14a.5.5 0 0 1 .354.146l1.5 1.5a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0L13 9.207l-.646.647a.5.5 0 0 1-.708 0L11 9.207l-.646.647a.5.5 0 0 1-.708 0L9 9.207l-.646.647A.5.5 0 0 1 8 10H7.465A4 4 0 0 1 0 8zm4-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
    API Keys — Stored in OS Keychain
    <button onclick="closeApiPanel()" title="Close settings"
      style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--muted);
             width:20px;height:20px;display:flex;align-items:center;justify-content:center;
             border-radius:4px;padding:0;font-size:14px;line-height:1;
             transition:color 0.15s,background 0.15s;"
      onmouseover="this.style.color='var(--text)';this.style.background='var(--surface)'"
      onmouseout="this.style.color='var(--muted)';this.style.background='none'">✕</button>
  </div>
  <div class="apikey-provider-row" id="keyrow-Gemini">
    <div class="apikey-label-row">
      <span class="apikey-provider-name">Gemini</span>
      <span class="apikey-status" id="keystatus-Gemini"></span>
    </div>
    <div class="apikey-input-row" id="keyinput-Gemini">
      <input class="apikey-input" id="key-Gemini" type="password" placeholder="AIza..."/>
      <button class="apikey-save" data-provider="Gemini">Save</button>
    </div>
    <div class="apikey-saved-row" id="keysaved-Gemini" style="display:none;">
      <span style="color:#4ec9b0;font-size:11px;">✓ Saved</span>
      <button class="apikey-delete" data-provider="Gemini" title="Delete key">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
        Delete
      </button>
    </div>
  </div>
  <div class="apikey-provider-row" id="keyrow-Anthropic">
    <div class="apikey-label-row">
      <span class="apikey-provider-name">Anthropic</span>
      <span class="apikey-status" id="keystatus-Anthropic"></span>
    </div>
    <div class="apikey-input-row" id="keyinput-Anthropic">
      <input class="apikey-input" id="key-Anthropic" type="password" placeholder="sk-ant-..."/>
      <button class="apikey-save" data-provider="Anthropic">Save</button>
    </div>
    <div class="apikey-saved-row" id="keysaved-Anthropic" style="display:none;">
      <span style="color:#4ec9b0;font-size:11px;">✓ Saved</span>
      <button class="apikey-delete" data-provider="Anthropic" title="Delete key">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
        Delete
      </button>
    </div>
  </div>
  <div class="apikey-provider-row" id="keyrow-OpenAI">
    <div class="apikey-label-row">
      <span class="apikey-provider-name">OpenAI</span>
      <span class="apikey-status" id="keystatus-OpenAI"></span>
    </div>
    <div class="apikey-input-row" id="keyinput-OpenAI">
      <input class="apikey-input" id="key-OpenAI" type="password" placeholder="sk-..."/>
      <button class="apikey-save" data-provider="OpenAI">Save</button>
    </div>
    <div class="apikey-saved-row" id="keysaved-OpenAI" style="display:none;">
      <span style="color:#4ec9b0;font-size:11px;">✓ Saved</span>
      <button class="apikey-delete" data-provider="OpenAI" title="Delete key">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
        Delete
      </button>
    </div>
  </div>
  <!-- Firecrawl separator + row -->
  <div style="border-top:1px solid var(--border);margin:10px 0 8px;"></div>
  <div style="font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
    🔥 <span>Firecrawl — scrape real sites for design inspiration</span>
    <a href="https://firecrawl.dev" style="color:var(--accent);text-decoration:none;margin-left:auto;font-size:10px;">Get key ↗</a>
  </div>
  <div class="apikey-provider-row" id="keyrow-Firecrawl">
    <div class="apikey-label-row">
      <span class="apikey-provider-name">Firecrawl</span>
      <span class="apikey-status" id="keystatus-Firecrawl"></span>
    </div>
    <div class="apikey-input-row" id="keyinput-Firecrawl">
      <input class="apikey-input" id="key-Firecrawl" type="password" placeholder="fc-..."/>
      <button class="apikey-save" data-provider="Firecrawl">Save</button>
    </div>
    <div class="apikey-saved-row" id="keysaved-Firecrawl" style="display:none;">
      <span style="color:#4ec9b0;font-size:11px;">✓ Saved</span>
      <button class="apikey-delete" data-provider="Firecrawl" title="Delete key">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
        Delete
      </button>
    </div>
  </div>
</div>


<!-- Error Banner -->
<div class="banner" id="errorBanner">
  <span id="errorText"></span>
  <button class="banner-action" id="btn-banner-settings">Settings</button>
</div>

<!-- Progress Strip -->
<div class="progress-strip" id="progress-strip">
  <div>
    <div class="spinner"></div>
    <span id="step-name">Working...</span>
  </div>
</div>

<!-- Input Area Clone -->
<div class="input-area-wrapper">
  <div class="input-box-container">
    <textarea class="input-box" id="input" placeholder="Message ZOZO..." rows="1"></textarea>
    
    <div class="input-toolbar">
      <div class="toolbar-left">
        <!-- Add Context Menu -->
        <div class="model-dropdown-container" id="contextWrap">
          <button class="icon-btn" id="btn-context" title="Add URL / template / MCP">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z"/></svg>
          </button>
          
          <div class="dropdown-menu" id="contextDropdown" style="min-width:220px;">
            <div style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border-hover);margin-bottom:6px;">Add Context</div>
            <div style="padding:0 8px 8px;">
              <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Paste URL, template link, or MCP endpoint</div>
              <div style="display:flex;gap:4px;">
                <input id="ctx-url-input" type="text" placeholder="https://ui.aceternity.com/..." autocomplete="off"
                  style="flex:1;font-size:11px;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text-bright);outline:none;"/>
                <button onclick="addUrlContext()" style="padding:5px 8px;font-size:11px;background:var(--accent);border:none;border-radius:5px;color:#fff;cursor:pointer;white-space:nowrap;">Add</button>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;" id="ctx-tags"></div>
              <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
                <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Popular libraries</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  <button onclick="quickCtx('https://reactbits.dev')" class="ctx-chip" style="color:#ec4899;border-color:rgba(236,72,153,0.3)">React Bits</button>
                  <button onclick="quickCtx('https://threejs.org')" class="ctx-chip" style="color:#06b6d4;border-color:rgba(6,182,212,0.3)">Three.js</button>
                  <button onclick="quickCtx('https://ui.aceternity.com')" class="ctx-chip">Aceternity</button>
                  <button onclick="quickCtx('https://motion.dev')" class="ctx-chip">Motion</button>
                  <button onclick="quickCtx('https://21st.dev')" class="ctx-chip">21st.dev</button>
                  <button onclick="quickCtx('https://react.dev')" class="ctx-chip">React</button>
                  <button onclick="quickCtx('https://nextjs.org/docs')" class="ctx-chip">Next.js</button>
                  <button onclick="quickCtx('https://vitejs.dev')" class="ctx-chip">Vite</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <select id="modelSelect" class="model-select" title="Choose AI Model">
          <option value="gemini-3.5-flash-medium">⚡ Gemini 1.5 Flash (Free)</option>
          <option value="gemini-3.5-flash-high">🧠 Gemini 1.5 Pro (Free)</option>
          <option value="gemini-3.5-flash-low">🚀 Gemini Flash-8B (Fast)</option>
          <option value="claude-sonnet-4.6">🎭 Claude 3.5 Sonnet</option>
          <option value="claude-opus-4.6">👑 Claude 3 Opus</option>
          <option value="gpt-6-astra">🤖 GPT-4o</option>
          <option value="gpt-6.1-sol">⚡ GPT-4o-mini</option>
        </select>
      </div>

      <div class="toolbar-right">
        <!-- Settings -->
        <button class="icon-btn" id="btn-settings" onclick="toggleApiPanel()" title="API Settings">⚙</button>
        
        <!-- Send Button -->
        <button class="send-btn" id="sendBtn" onclick="handleSendOrCancel()" title="Send message">
          <svg id="icon-send" viewBox="0 0 16 16"><path d="M8 2L2 8h4v6h4V8h4L8 2z"/></svg>
          <svg id="icon-stop" viewBox="0 0 16 16" style="display:none;"><rect x="4" y="4" width="8" height="8"/></svg>
        </button>
      </div>
    </div>
  </div>
</div>

<script nonce="${nonce}">
var vscode = acquireVsCodeApi();

// Catch any JS error and display it so we can debug
window.onerror = function(msg, src, line, col, err) {
  try {
    var banner = document.getElementById('errorBanner');
    if (banner) { banner.textContent = 'JS Error: ' + msg + ' (line ' + line + ')'; banner.classList.add('open'); }
  } catch(e) {}
  return false;
};

var isRunning = false;
var mode = 'chat';
var MODELS = ${modelsJson};
var selectedModel = MODELS.find(m => m.id === 'gemini-3.5-flash-medium') || MODELS[0];
var _ctxUrls = []; // attached URL/template contexts

function setRunningUI(running) {
  isRunning = running;
  var btn = document.getElementById('sendBtn');
  var ibc = document.querySelector('.input-box-container');
  var iconSend = document.getElementById('icon-send');
  var iconStop = document.getElementById('icon-stop');
  if (btn) { running ? btn.classList.add('cancel') : btn.classList.remove('cancel'); }
  if (ibc) { running ? ibc.classList.add('generating') : ibc.classList.remove('generating'); }
  if (iconSend) iconSend.style.display = running ? 'none' : 'block';
  if (iconStop) iconStop.style.display = running ? 'block' : 'none';
}

function handleSendOrCancel() {
  if (isRunning) {
    vscode.postMessage({ command: 'cancelBuild' });
    setRunningUI(false);
  } else {
    send();
  }
}

function autoResizeInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  var sh = el.scrollHeight;
  if (sh > 180) {
    el.style.height = '180px';
    el.style.overflowY = 'auto';
  } else {
    el.style.height = Math.max(38, sh) + 'px';
    el.style.overflowY = 'hidden';
  }
}

var inputEl = document.getElementById('input');
if (inputEl) {
  inputEl.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendOrCancel();
    }
  });
  inputEl.addEventListener('input', function() {
    autoResizeInput(this);
  });
}

(function init() {
  var sel = document.getElementById('modelSelect');
  if (sel) {
    sel.value = selectedModel.id;
    sel.onchange = function() {
      var val = this.value;
      selectedModel = MODELS.find(function(m) { return m.id === val; }) || MODELS[0];
      vscode.postMessage({ command: 'checkApiKey', provider: selectedModel.provider });
    };
  }

  // Check which API keys are already saved
  vscode.postMessage({ command: 'checkAllKeys' });
})();

document.addEventListener('click', function(e) {
  var el = e.target;
  if (!el.closest) el = el.parentElement;
  if (!el) return;
  
  var cw = document.getElementById('contextWrap');
  if (cw && !cw.contains(el)) closeContextDropdown();

  var example = el.closest('.example');
  if (example) { useExample(example); return; }

  var btnOrAction = el.closest('button, .close-context, .apikey-save, .apikey-delete, .delete-chat-btn, .load-chat-btn');
  if (!btnOrAction) return;

  if (btnOrAction.id === 'btn-context') { toggleContextDropdown(); return; }
  if (btnOrAction.classList.contains('close-context')) { closeContextDropdown(); return; }
  if (btnOrAction.classList.contains('apikey-save')) { saveKey(btnOrAction.getAttribute('data-provider')); return; }
  if (btnOrAction.classList.contains('apikey-delete')) { deleteKey(btnOrAction.getAttribute('data-provider')); return; }
  if (btnOrAction.classList.contains('delete-chat-btn')) { deleteChat(parseInt(btnOrAction.getAttribute('data-index')), e); return; }
  if (btnOrAction.classList.contains('load-chat-btn')) { loadChat(parseInt(btnOrAction.getAttribute('data-index'))); return; }
});

function toggleContextDropdown() { document.getElementById('contextDropdown').classList.toggle('open'); }
function closeContextDropdown() { document.getElementById('contextDropdown').classList.remove('open'); }


function toggleApiPanel() { 
  document.getElementById('apikeyPanel').classList.toggle('open');
  if (document.getElementById('apikeyPanel').classList.contains('open')) {
    vscode.postMessage({ command: 'checkAllKeys' });
  }
}
function saveKey(provider) {
  var val = document.getElementById('key-'+provider).value;
  if(val) { vscode.postMessage({ command: 'saveApiKey', provider: provider, key: val }); document.getElementById('key-'+provider).value=''; }
}
function deleteKey(provider) {
  vscode.postMessage({ command: 'deleteApiKey', provider: provider });
}
function setKeyState(provider, saved) {
  var inputRow = document.getElementById('keyinput-' + provider);
  var savedRow = document.getElementById('keysaved-' + provider);
  if (!inputRow || !savedRow) return;
  if (saved) {
    inputRow.style.display = 'none';
    savedRow.style.display = 'flex';
  } else {
    inputRow.style.display = 'flex';
    savedRow.style.display = 'none';
  }
}


function handleSendOrCancel() { if(isRunning) vscode.postMessage({ command: 'cancelBuild' }); else send(); }

function newChat() {
  var msgs = document.getElementById('messages');
  var welcomeEl = document.getElementById('welcome');
  var welcomeClone = welcomeEl ? welcomeEl.cloneNode(true) : null;
  msgs.innerHTML = '';
  if (welcomeClone) {
    welcomeClone.style.display = 'block';
    msgs.appendChild(welcomeClone);
  }
  document.getElementById('errorBanner').classList.remove('open');
  vscode.postMessage({ command: 'clearChat' });
}

document.getElementById('btn-new').onclick = newChat;
document.getElementById('btn-history').onclick = function() {
  document.getElementById('historyPanel').style.display = 'flex';
  vscode.postMessage({ command: 'getHistory' });
};
document.getElementById('btn-close-history').onclick = function() {
  document.getElementById('historyPanel').style.display = 'none';
};

function loadChat(index) {
  vscode.postMessage({ command: 'loadChat', index: index });
}

function editMessage(btn, text) {
  var msgDiv = btn.closest('.msg');
  var contentDiv = msgDiv.querySelector('.msg-content');
  if (!contentDiv) return;
  contentDiv.style.display = 'none';
  var bubble = msgDiv.querySelector('.bubble');
  if (bubble) bubble.style.width = '100%';
  
  // Hide the send-edit row if it was shown
  var sendEditRow = msgDiv.querySelector('.send-edit-row');
  if (sendEditRow) sendEditRow.style.display = 'none';
  
  var editContainer = msgDiv.querySelector('.edit-container');
  if (!editContainer) {
    editContainer = document.createElement('div');
    editContainer.className = 'edit-container';
    editContainer.style.marginTop = '8px';
    editContainer.style.marginBottom = '12px';
    editContainer.style.width = '100%';
    
    var textarea = document.createElement('textarea');
    textarea.style.width = '100%';
    textarea.style.boxSizing = 'border-box';
    textarea.style.background = 'var(--bg)';
    textarea.style.border = '1px solid #555';
    textarea.style.borderRadius = '6px';
    textarea.style.padding = '8px 10px';
    textarea.style.color = 'var(--text-bright)';
    textarea.style.fontSize = '13px';
    textarea.style.fontFamily = 'inherit';
    textarea.style.lineHeight = '1.5';
    textarea.style.resize = 'none';
    textarea.style.overflow = 'hidden';
    textarea.style.minHeight = '50px';
    textarea.style.outline = 'none';
    textarea.value = text;
    textarea.oninput = function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 400) + 'px';
    };
    setTimeout(function() { textarea.oninput(); }, 10);
    
    var btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';
    btnRow.style.marginTop = '6px';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.alignItems = 'center';
    
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:3px 10px;font-size:11px;background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:4px;cursor:pointer;';
    cancelBtn.onclick = function() {
      editContainer.style.display = 'none';
      contentDiv.style.display = 'block';
      var bubble = msgDiv.querySelector('.bubble');
      if (bubble) bubble.style.width = '';
    };
    
    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'padding:3px 10px;font-size:11px;background:var(--accent);border:none;color:#fff;border-radius:4px;cursor:pointer;font-weight:500;';
    saveBtn.onclick = function() {
      var newText = textarea.value.trim();
      if (!newText) return;
      var escText = newText.replace(/</g,'&lt;');
      contentDiv.innerHTML = escText;
      contentDiv.style.display = 'block';
      editContainer.style.display = 'none';
      var bubble = msgDiv.querySelector('.bubble');
      if (bubble) bubble.style.width = '';
      
      // Update data-text for copy
      var copyBtn = msgDiv.querySelector('[data-copy-btn]');
      if (copyBtn) copyBtn.setAttribute('data-text', newText);
      
      // Update edit button data
      var editBtn = msgDiv.querySelector('[data-edit-btn]');
      if (editBtn) editBtn.setAttribute('data-text', newText);
      
      // Save to backend
      var msgs2 = document.getElementById('messages').children;
      var msgIndex = -1;
      for (var i = 0; i < msgs2.length; i++) {
        if (msgs2[i].classList.contains('welcome')) continue;
        if (msgs2[i].classList.contains('msg')) msgIndex++;
        if (msgs2[i] === msgDiv) break;
      }
      vscode.postMessage({ command: 'editMessageBackend', index: msgIndex, text: newText });
      
      // Show "Send to AI" button
      var sendEditRow = msgDiv.querySelector('.send-edit-row');
      if (!sendEditRow) {
        sendEditRow = document.createElement('div');
        sendEditRow.className = 'send-edit-row';
        sendEditRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;padding:6px 10px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:6px;cursor:pointer;transition:background 0.2s;';
        sendEditRow.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="#60a5fa"><path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576 6.636 10.07Zm6.787-8.201L1.591 6.602l4.339 2.76 7.494-7.493Z"/></svg>' +
          '<span style="font-size:11px;color:#60a5fa;font-weight:500;">Send edited message to AI</span>' +
          '<svg width="10" height="10" viewBox="0 0 16 16" fill="#60a5fa" style="margin-left:2px;"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>';
        sendEditRow.onmouseover = function() { this.style.background = 'rgba(59,130,246,0.2)'; };
        sendEditRow.onmouseout = function() { this.style.background = 'rgba(59,130,246,0.1)'; };
        sendEditRow.onclick = function() {
          // Remove all messages after this one from UI
          while (msgDiv.nextSibling) msgDiv.nextSibling.remove();
          sendEditRow.remove();
          
          // Truncate history in backend
          var msgs3 = document.getElementById('messages').children;
          var keepCount = 0;
          for (var j = 0; j < msgs3.length; j++) {
            if (msgs3[j].classList.contains('welcome')) continue;
            if (msgs3[j] === msgDiv) break;
            keepCount++;
          }
          vscode.postMessage({ command: 'truncateHistory', keepCount: keepCount + 1 });
          
          // Set UI to running state - chat_start event will create the AI reply bubble
          isRunning = true;
          document.getElementById('sendBtn').classList.add('cancel');
          document.getElementById('icon-send').style.display = 'none';
          document.getElementById('icon-stop').style.display = 'block';
          
          // Actually send to AI using the real pipeline
          vscode.postMessage({ command: 'sendMessage', text: newText, mode: mode, modelId: selectedModel.id, provider: selectedModel.provider });
        };
        contentDiv.parentNode.appendChild(sendEditRow);
      } else {
        sendEditRow.style.display = 'flex';
      }
    };
    
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    editContainer.appendChild(textarea);
    editContainer.appendChild(btnRow);
    contentDiv.parentNode.insertBefore(editContainer, contentDiv.nextSibling);
  } else {
    editContainer.style.display = 'block';
    editContainer.querySelector('textarea').value = text;
    setTimeout(function() { editContainer.querySelector('textarea').oninput(); }, 10);
  }
}

function revertMessage(btn) {
  var msgDiv = btn.closest('.msg');
  // Get the raw text from the message content
  var msgText = '';
  var copyEl = msgDiv.querySelector('[data-copy-btn]');
  if (copyEl && copyEl._rawText) {
    msgText = copyEl._rawText;
  } else {
    var contentEl = msgDiv.querySelector('.msg-content');
    if (contentEl) msgText = contentEl.textContent || '';
  }
  var msgs = document.getElementById('messages').children;
  var keepCount = 0;
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].classList.contains('welcome')) continue;
    if (msgs[i] === msgDiv) break;
    keepCount++;
  }
  vscode.postMessage({ command: 'confirmRevert', keepCount: keepCount, text: msgText });
}
function copyText(text) {
  vscode.postMessage({ command: 'copyText', text: text });
}

function deleteChat(index, e) {
  if(e) e.stopPropagation();
  vscode.postMessage({ command: 'deleteChat', index: index });
  setTimeout(function() { vscode.postMessage({ command: 'getHistory' }); }, 50);
}

function send() {
  var el = document.getElementById('input');
  var text = el.value.trim();
  if (!text) return;

  var msgs = document.getElementById('messages');
  var timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  var escText = text.replace(/</g,'&lt;');
  
  var bubbleHtml = '<div style="display:flex; flex-direction:column;">' +
    '<div class="msg-content" style="font-size:13px; font-weight:500; margin-bottom:12px; word-break:break-word;">' + escText + '</div>' +
    '<div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--muted); width:100%; gap:16px;">' +
      '<span>' + timeStr + '</span>' +
      '<div style="display:flex; gap:20px;">' +
        '<svg data-copy-btn data-text="" title="Copy" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="cursor:pointer;"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1h-3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5z"/></svg>' +
        '<svg data-edit-btn data-text="" title="Edit" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="cursor:pointer;"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>' +
        '<svg data-revert-btn title="Undo changes up to this point" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="cursor:pointer;"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/></svg>' +
      '</div>' +
    '</div>' +
  '</div>';

  msgs.insertAdjacentHTML('beforeend', '<div class="msg user"><div class="bubble">' + bubbleHtml + '</div></div>');
  
  // Set the text data on the icons via DOM (avoids escaping issues)
  var lastBubble = msgs.lastElementChild;
  var rawText = text;
  var copyBtnEl = lastBubble.querySelector('[data-copy-btn]');
  var editBtnEl = lastBubble.querySelector('[data-edit-btn]');
  if (copyBtnEl) copyBtnEl._rawText = rawText;
  if (editBtnEl) editBtnEl._rawText = rawText;
  msgs.scrollTop = msgs.scrollHeight;
  
  el.value = '';
  el.style.height = '38px';
  el.style.overflowY = 'hidden';
  var w = document.getElementById('welcome'); if(w) w.style.display = 'none';
  document.getElementById('errorBanner').classList.remove('open');

  // Attach URL contexts if any
  var ctxSuffix = '';
  if (_ctxUrls.length > 0) {
    ctxSuffix = '\n\n[Context URLs: ' + _ctxUrls.join(', ') + ']';
    _ctxUrls = [];
    document.getElementById('ctx-tags').innerHTML = '';
  }

  // Set running state in UI
  isRunning = true;
  var sBtn = document.getElementById('sendBtn');
  if (sBtn) sBtn.classList.add('cancel');
  var sIcon = document.getElementById('icon-send');
  if (sIcon) sIcon.style.display = 'none';
  var stopIcon = document.getElementById('icon-stop');
  if (stopIcon) stopIcon.style.display = 'block';

  // Always send to AI backend — the backend AI agent handles clarifying, planning, and building naturally
  vscode.postMessage({ command: 'sendMessage', text: text + ctxSuffix, mode: 'chat', modelId: selectedModel.id, provider: selectedModel.provider });
}

// ── Build confirmation card ────────────────────────────────────────────────────
// Phase 1: Framework + Design Strategy (Auto Governor vs Component Links)
function showBuildConfirmCard(prompt, ctxSuffix) {
  var msgs = document.getElementById('messages');
  if (!msgs) return;

  // Detect framework from prompt
  var frameworkHint = '';
  if (/\bnext\.?js\b/i.test(prompt))        frameworkHint = 'next';
  else if (/\bvite\b/i.test(prompt))        frameworkHint = 'vite';
  else if (/\bsvelte\b/i.test(prompt))      frameworkHint = 'svelte';
  else if (/\bvue\b/i.test(prompt))         frameworkHint = 'vue';
  else if (/\bnuxt\b/i.test(prompt))        frameworkHint = 'nuxt';
  else if (/\bremix\b/i.test(prompt))       frameworkHint = 'remix';
  else if (/\bastro\b/i.test(prompt))       frameworkHint = 'astro';
  else if (/\bhtml|vanilla/i.test(prompt))  frameworkHint = 'html';
  else if (/\breact\b/i.test(prompt))       frameworkHint = 'react-vite';
  else if (/\bflutter\b/i.test(prompt))     frameworkHint = 'flutter';
  var selectedFw = frameworkHint || 'next';
  window._componentStrategy = 'auto'; // default: Senior Governor picks components
  window._componentLinks = [];

  var frameworks = [
    { id:'next',       label:'Next.js',    icon:'▲' },
    { id:'react-vite', label:'React/Vite', icon:'⚡' },
    { id:'svelte',     label:'Svelte',     icon:'🧡' },
    { id:'vue',        label:'Vue',        icon:'💚' },
    { id:'nuxt',       label:'Nuxt',       icon:'💚' },
    { id:'remix',      label:'Remix',      icon:'🎵' },
    { id:'astro',      label:'Astro',      icon:'🚀' },
    { id:'html',       label:'HTML/CSS',   icon:'🌐' },
    { id:'flutter',    label:'Flutter',    icon:'🐦' },
  ];

  var fwChips = frameworks.map(function(f) {
    var isActive = (f.id === selectedFw);
    return '<button onclick="selectFw(this,\'' + f.id + '\')" data-fw="' + f.id + '"' +
      ' style="padding:4px 10px;font-size:10px;border-radius:5px;cursor:pointer;transition:all 0.15s;border:1px solid ' +
      (isActive ? '#7c3aed;background:rgba(124,58,237,0.18);color:#a78bfa' : 'var(--border);background:var(--bg);color:var(--muted)') + ';">'+
      f.icon + ' ' + f.label + '</button>';
  }).join('');

  var strategySection =
    '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">' +
    '<div style="font-size:10px;color:var(--muted);margin-bottom:7px;">🎨 Design &amp; Component Strategy</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
    // Auto mode button
    '<button id="strategy-auto" onclick="selectStrategy(\'auto\')" style="flex:1;padding:7px 8px;font-size:10px;border-radius:6px;cursor:pointer;border:1px solid #7c3aed;background:rgba(124,58,237,0.15);color:#a78bfa;font-weight:600;transition:all 0.15s;">' +
    '🧠 Auto Governor<br><span style="font-size:9px;font-weight:400;opacity:0.75;">ZOZO picks best libs (React Bits, Aceternity, Magic UI)</span></button>' +
    // Links mode button
    '<button id="strategy-links" onclick="selectStrategy(\'links\')" style="flex:1;padding:7px 8px;font-size:10px;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--muted);transition:all 0.15s;">' +
    '🔗 I have component links<br><span style="font-size:9px;font-weight:400;opacity:0.75;">React Bits, Aceternity, Shadcn, Magic UI</span></button>' +
    '</div>' +
    // Link input area (hidden by default, shown when "links" mode selected)
    '<div id="comp-link-area" style="display:none;">' +
    '<div style="font-size:9px;color:var(--muted);margin-bottom:4px;">Paste component URL(s) — one per line:</div>' +
    '<textarea id="comp-link-input" placeholder="https://reactbits.dev/components/flex-carousel\nhttps://ui.aceternity.com/components/card-hover-effect"' +
    ' style="width:100%;height:64px;font-size:10px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text-bright);resize:none;font-family:monospace;box-sizing:border-box;"></textarea>' +
    '<div style="font-size:9px;color:var(--muted);margin-top:4px;">ZOZO will scrape exact code, CSS &amp; npm deps from each link.</div>' +
    '</div>' +
    '</div>';

  var cardHtml =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
    '<span style="font-size:16px">🚀</span>' +
    '<span style="font-size:12px;font-weight:700;color:var(--text-bright)">Ready to build?</span>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5;padding:8px 10px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">' +
    prompt.slice(0, 140) + (prompt.length > 140 ? '...' : '') +
    '</div>' +
    '<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Framework / Tech stack</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;" id="fw-chips">' + fwChips + '</div>' +
    strategySection +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
    '<button onclick="confirmBuild()" style="flex:1;padding:8px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">🚀 Build it</button>' +
    '<button onclick="cancelBuildCard()" style="padding:8px 14px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:11px;cursor:pointer;">✕ Cancel</button>' +
    '</div></div>';

  msgs.insertAdjacentHTML('beforeend',
    '<div class="msg system" id="build-confirm-card"><div class="bubble" style="padding:0">' + cardHtml + '</div></div>');
  msgs.scrollTop = msgs.scrollHeight;

  window._pendingBuildPrompt = prompt;
  window._pendingCtxSuffix = ctxSuffix || '';
  window._selectedFw = selectedFw;
}

function selectFw(btn, fw) {
  document.querySelectorAll('#fw-chips button').forEach(function(b) {
    b.style.borderColor = 'var(--border)';
    b.style.background = 'var(--bg)';
    b.style.color = 'var(--muted)';
  });
  btn.style.borderColor = '#7c3aed';
  btn.style.background = 'rgba(124,58,237,0.18)';
  btn.style.color = '#a78bfa';
  window._selectedFw = fw;
}

function selectStrategy(mode) {
  window._componentStrategy = mode;
  var autoBtn  = document.getElementById('strategy-auto');
  var linksBtn = document.getElementById('strategy-links');
  var linkArea = document.getElementById('comp-link-area');
  if (!autoBtn || !linksBtn) return;
  if (mode === 'auto') {
    autoBtn.style.borderColor  = '#7c3aed';
    autoBtn.style.background   = 'rgba(124,58,237,0.15)';
    autoBtn.style.color        = '#a78bfa';
    linksBtn.style.borderColor = 'var(--border)';
    linksBtn.style.background  = 'var(--bg)';
    linksBtn.style.color       = 'var(--muted)';
    if (linkArea) linkArea.style.display = 'none';
  } else {
    linksBtn.style.borderColor = '#7c3aed';
    linksBtn.style.background  = 'rgba(124,58,237,0.15)';
    linksBtn.style.color       = '#a78bfa';
    autoBtn.style.borderColor  = 'var(--border)';
    autoBtn.style.background   = 'var(--bg)';
    autoBtn.style.color        = 'var(--muted)';
    if (linkArea) linkArea.style.display = 'block';
  }
}

function confirmBuild() {
  var card = document.getElementById('build-confirm-card');
  if (card) card.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });
  var prompt   = window._pendingBuildPrompt || '';
  var ctx      = window._pendingCtxSuffix || '';
  var fw       = window._selectedFw || 'next';
  var strategy = window._componentStrategy || 'auto';

  // Collect component links if user pasted them
  var compLinksStr = '';
  if (strategy === 'links') {
    var textarea = document.getElementById('comp-link-input');
    var raw = textarea ? textarea.value.trim() : '';
    var links = raw.split(/\n+/).map(function(l) { return l.trim(); }).filter(Boolean);
    if (links.length > 0) compLinksStr = '\n\n[ComponentLinks: ' + links.join('|') + ']';
  }

  var fullPrompt = prompt + (ctx || '') +
    '\n\n[Framework: ' + fw + ']' +
    '\n[ComponentStrategy: ' + strategy + ']' +
    compLinksStr;

  isRunning = true;
  document.getElementById('sendBtn').classList.add('cancel');
  document.getElementById('icon-send').style.display = 'none';
  document.getElementById('icon-stop').style.display = 'block';
  vscode.postMessage({ command: 'sendMessage', text: fullPrompt, mode: 'build', modelId: selectedModel.id, provider: selectedModel.provider });
}

function cancelBuildCard() {
  var card = document.getElementById('build-confirm-card');
  if (card) card.remove();
}

// ── URL context helpers ─────────────────────────────────────────────────
function addUrlContext() {
  var inp = document.getElementById('ctx-url-input');
  var val = (inp ? inp.value.trim() : '');
  if (!val) return;
  quickCtx(val);
  if (inp) inp.value = '';
}
function quickCtx(url) {
  if (_ctxUrls.indexOf(url) !== -1) return;
  _ctxUrls.push(url);
  var tags = document.getElementById('ctx-tags');
  if (tags) {
    var label = url.replace(/^https?:\/\//,'').split('/')[0];
    tags.insertAdjacentHTML('beforeend',
      '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;font-size:10px;' +
      'background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.4);border-radius:4px;color:#a78bfa;">' +
      label + '<span onclick="removeCtx(\'' + url + '\',this)" style="cursor:pointer;opacity:0.7">✕</span></span>');
  }
  closeContextDropdown();
}
function removeCtx(url, el) {
  _ctxUrls = _ctxUrls.filter(function(u) { return u !== url; });
  if (el && el.parentElement) el.parentElement.remove();
}

function useExample(el) {
  var input = document.getElementById('input');
  if (input) {
    input.value = el.textContent.trim();
    send();
  }
}

${markdownFnCode}

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (msg.type === 'apiKeyStatus') {
    setKeyState(msg.provider, msg.hasKey);
    if (!msg.hasKey && document.getElementById('apikeyPanel').classList.contains('open')) {
      // already showing panel, just let user see the input
    } else if (!msg.hasKey && msg.provider === selectedModel.provider) {
      document.getElementById('errorText').textContent = '⚠ ' + msg.provider + ' key required. Enter key in Settings below.';
      document.getElementById('errorBanner').classList.add('open');
      document.getElementById('apikeyPanel').classList.add('open');
    }
  } else if (msg.type === 'apiKeySaved') {
    setKeyState(msg.provider, true);
    document.getElementById('errorBanner').classList.remove('open');
  } else if (msg.type === 'apiKeyDeleted') {
    setKeyState(msg.provider, false);
  } else if (msg.type === 'executeRevert') {
    var msgs = document.getElementById('messages').children;
    var keepCount = msg.keepCount;
    var currIdx = 0;
    var foundMsg = null;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].classList.contains('welcome')) continue;
      if (currIdx === keepCount) {
        foundMsg = msgs[i];
        break;
      }
      currIdx++;
    }
    if (foundMsg) {
      vscode.postMessage({ command: 'truncateHistory', keepCount: keepCount });
      while (foundMsg.nextSibling) foundMsg.nextSibling.remove();
      foundMsg.remove();
    }
    // Put the reverted message text into the input box (like Antigravity)
    if (msg.text) {
      var inputEl = document.getElementById('input');
      inputEl.value = msg.text;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
      inputEl.focus();
    }
  } else if (msg.type === 'history_loaded') {
    var list = document.getElementById('historyList');
    var html = '';
    if (!msg.history || msg.history.length === 0) {
      html = '<div style="color:var(--muted); font-size:12px; text-align:center; margin-top:20px;">No chat history found.</div>';
    } else {
      msg.history.forEach(function(session, i) {
        html += '<div class="dropdown-item" style="border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">' +
                '<div style="flex:1; cursor:pointer; overflow:hidden; display:flex; align-items:center;" class="load-chat-btn" data-index="' + i + '">' +
                  '<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (session.title || 'Chat ' + (i+1)) + '</span>' +
                  '<span style="font-size:10px; color:var(--muted); margin-left:8px;">' + new Date(session.timestamp).toLocaleDateString() + '</span>' +
                '</div>' +
                '<button title="Delete Chat" class="delete-chat-btn" data-index="' + i + '" style="background:transparent; border:none; color:var(--muted); cursor:pointer; padding:4px; font-size:14px; margin-left:8px;">🗑️</button>' +
                '</div>';
      });
    }
    list.innerHTML = html;
  } else if (msg.type === 'chat_restored') {
    var msgs = document.getElementById('messages');
    msgs.innerHTML = '';
    msg.messages.forEach(function(m) {
      if (m.role === 'user') {
        var timeStr = new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var escText = m.content.replace(/</g,'&lt;');
        var rawText2 = m.content;
        var bubbleHtml = '<div style="display:flex; flex-direction:column;">' +
          '<div class="msg-content" style="font-size:13px; font-weight:500; margin-bottom:12px; word-break:break-word;">' + escText + '</div>' +
          '<div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--muted); width:100%; gap:16px;">' +
            '<span>' + timeStr + '</span>' +
            '<div style="display:flex; gap:20px;">' +
              '<svg data-copy-btn title="Copy" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="cursor:pointer;"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1h-3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5z"/></svg>' +
              '<svg data-edit-btn title="Edit" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="cursor:pointer;"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>' +
              '<svg data-revert-btn title="Undo changes up to this point" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="cursor:pointer;"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/></svg>' +
            '</div>' +
          '</div>' +
        '</div>';
        msgs.insertAdjacentHTML('beforeend', '<div class="msg user"><div class="bubble">' + bubbleHtml + '</div></div>');
        var lastBub = msgs.lastElementChild;
        var cEl = lastBub.querySelector('[data-copy-btn]'); if (cEl) cEl._rawText = rawText2;
        var eEl = lastBub.querySelector('[data-edit-btn]'); if (eEl) eEl._rawText = rawText2;
      } else {
        msgs.insertAdjacentHTML('beforeend', '<div class="msg system"><div class="bubble">' + renderMarkdown(m.content) + '</div></div>');
      }
    });
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('historyPanel').style.display = 'none';
    var w = document.getElementById('welcome'); if(w) w.style.display = 'none';
  } else if (msg.type === 'pipeline_event') {
    var ev = msg.event;
    var btn = document.getElementById('sendBtn');
    var ibc = document.querySelector('.input-box-container');
    var iconSend = document.getElementById('icon-send');
    var iconStop = document.getElementById('icon-stop');

    function setRunningUI(running) {
      isRunning = running;
      if (btn) { running ? btn.classList.add('cancel') : btn.classList.remove('cancel'); }
      if (ibc) { running ? ibc.classList.add('generating') : ibc.classList.remove('generating'); }
      if (iconSend) iconSend.style.display = running ? 'none' : 'block';
      if (iconStop) iconStop.style.display = running ? 'block' : 'none';
    }

    // ── Conversational Chat Events ──
    if (ev.type === 'chat_start') {
      var msgs = document.getElementById('messages');
      if (msgs) {
        var bubbleId = 'ai-msg-' + Date.now();
        msgs.insertAdjacentHTML('beforeend', '<div class="msg system"><div class="bubble" id="' + bubbleId + '"></div></div>');
        window.activeAiBubble = document.getElementById(bubbleId);
        window.aiBubbleContent = '';
      }
      setRunningUI(true);
    } else if (ev.type === 'chat_chunk') {
      if (window.activeAiBubble) {
        window.aiBubbleContent += (ev.chunk || '');
        window.activeAiBubble.innerHTML = renderMarkdown(window.aiBubbleContent);
        var msgs = document.getElementById('messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      }
    } else if (ev.type === 'chat_end') {
      if (window.activeAiBubble && window.aiBubbleContent) {
        window.activeAiBubble.innerHTML = renderMarkdown(window.aiBubbleContent);
      }
      setRunningUI(false);
      window.activeAiBubble = null;
    } else if (ev.type === 'chat_system_message') {
      setRunningUI(false);
      var msgs = document.getElementById('messages');
      if (msgs) {
        var style = ev.isError ? 'color:#ff6b6b' : '';
        var rendered = ev.isError ? ev.text.replace(/</g,'&lt;').replace(/\\n/g,'<br>') : renderMarkdown(ev.text);
        msgs.insertAdjacentHTML('beforeend', '<div class="msg system"><div class="bubble" style="' + style + '">' + rendered + '</div></div>');
        msgs.scrollTop = msgs.scrollHeight;
      }
      var w = document.getElementById('welcome'); if(w) w.style.display = 'none';
    }

    // ── Build Progress Events ──
    if (ev.type === 'session_start') {
      setRunningUI(true);
      var ps = document.getElementById('progress-strip');
      var sn = document.getElementById('step-name');
      if (ps) ps.classList.add('visible');
      if (sn) sn.textContent = 'Starting build...';
    } else if (ev.type === 'build_complete' || ev.type === 'build_failed' || ev.type === 'build_cancelled') {
      setRunningUI(false);
      var ps = document.getElementById('progress-strip');
      if (ps) ps.classList.remove('visible');
      var msgs = document.getElementById('messages');
      if (msgs) {
        if (ev.type === 'build_failed' && ev.error) {
          msgs.insertAdjacentHTML('beforeend', '<div class="msg system"><div class="bubble" style="color:#ff6b6b">❌ Build failed: ' + ev.error + '</div></div>');
        } else if (ev.type === 'build_complete') {
          msgs.insertAdjacentHTML('beforeend', '<div class="msg system"><div class="bubble" style="color:#4caf50">✅ Build complete. Check the output channel!</div></div>');
        }
        msgs.scrollTop = msgs.scrollHeight;
      }
    } else if (ev.type === 'step_start') {
      var sn = document.getElementById('step-name');
      if (sn) sn.textContent = ev.stepName;

    // ── File Generation Streaming ──────────────────────────────────────────
    } else if (ev.type === 'file_generating') {
      var msgs = document.getElementById('messages');
      if (!msgs) return;
      var logId = 'gen-log-' + (ev.filePath || '').replace(/[^a-z0-9]/gi, '-');
      var existing = document.getElementById(logId);
      if (!existing) {
        msgs.insertAdjacentHTML('beforeend',
          '<div class="msg system" id="wrap-' + logId + '">' +
          '<div class="bubble" style="padding:8px 12px; font-family:monospace; font-size:11px;">' +
          '<span style="color:#858585">📄 </span>' +
          '<span id="' + logId + '" style="color:#cccccc">' + (ev.filePath || '') + '</span>' +
          '<span style="color:#858585; margin-left:8px; animation:blink 1s infinite" id="blink-' + logId + '">▋</span>' +
          '</div></div>');
        msgs.scrollTop = msgs.scrollHeight;
      }
    } else if (ev.type === 'file_complete') {
      var logId2 = 'gen-log-' + (ev.filePath || '').replace(/[^a-z0-9]/gi, '-');
      var el2 = document.getElementById(logId2);
      var blink = document.getElementById('blink-' + logId2);
      if (el2) { el2.style.color = '#4ec9b0'; }
      if (blink) { blink.textContent = ' ✅ (' + (ev.lineCount || 0) + ' lines)'; blink.style.animation = 'none'; blink.style.color = '#4ec9b0'; }

    // ── Build Scorecard ────────────────────────────────────────────────────
    } else if (ev.type === 'build_scorecard') {
      var sc = ev.scorecard || {};
      var msgs = document.getElementById('messages');
      if (!msgs) return;
      var grade = sc.overallGrade || '?';
      var gradeColor = grade === 'A' ? '#4caf50' : grade === 'B' ? '#8bc34a' : grade === 'C' ? '#ffc107' : grade === 'D' ? '#ff9800' : '#f44336';
      function row(icon, label, val, target, ok) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;">' +
          '<span>' + (ok ? '✅' : '⚠️') + '</span>' +
          '<span style="flex:1;color:var(--muted)">' + label + '</span>' +
          '<span style="color:var(--text-bright);font-family:monospace">' + val + '</span>' +
          (target ? '<span style="color:var(--muted)">→ ' + target + '</span>' : '') +
          '</div>';
      }
      var sc_html =
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:4px;">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
        '<span style="font-size:20px;font-weight:700;color:' + gradeColor + '">' + grade + '</span>' +
        '<span style="font-size:12px;font-weight:600;color:var(--text-bright)">Build Scorecard</span>' +
        '</div>' +
        row('', 'Build success', sc.buildSuccess ? 'YES' : 'NO', 'YES', sc.buildSuccess) +
        row('', 'File efficiency', (sc.fileEfficiency || 0) + '%', '≥ 80%', (sc.fileEfficiency || 0) >= 80) +
        row('', 'Quality score', (sc.qualityScore || 0) + '/100', '≥ 70', (sc.qualityScore || 0) >= 70) +
        row('', 'TypeScript errors', sc.tsErrors || 0, '= 0', (sc.tsErrors || 0) === 0) +
        row('', 'Files generated', sc.filesGenerated || 0, '', true) +
        row('', 'Quality retries', sc.retryCount || 0, '', (sc.retryCount || 0) === 0) +
        row('', 'Build time', Math.round((sc.buildDurationMs || 0) / 1000) + 's', '', true) +
        row('', 'Est. cost', '$' + (sc.estimatedCostUsd || 0).toFixed(3), '', true) +
        '</div>';
      msgs.insertAdjacentHTML('beforeend', '<div class="msg system"><div class="bubble" style="padding:0">' + sc_html + '</div></div>');
      msgs.scrollTop = msgs.scrollHeight;

    // ── Wave Preview ───────────────────────────────────────────────────────
    } else if (ev.type === 'wave_complete') {
      var msgs = document.getElementById('messages');
      if (!msgs) return;
      var wn = ev.waveNumber || 0;
      var files = (ev.filesInWave || []).slice(0, 6);
      var moreCount = (ev.filesInWave || []).length - files.length;
      var fileList = files.map(function(f) { return '<span style="display:block;font-size:10px;color:var(--muted);margin:1px 0">📄 ' + f + '</span>'; }).join('');
      if (moreCount > 0) fileList += '<span style="font-size:10px;color:var(--muted)">... and ' + moreCount + ' more</span>';
      var waveHtml =
        '<div style="background:var(--surface);border:1px solid #4ec9b033;border-radius:8px;padding:12px 14px;">' +
        '<div style="color:#4ec9b0;font-size:12px;font-weight:600;margin-bottom:8px;">✅ ' + (ev.waveLabel || 'Wave ' + wn) + ' complete</div>' +
        '<div style="margin-bottom:10px;">' + fileList + '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="waveDecide(\'wave_approved\',' + wn + ')" style="flex:1;padding:6px;background:#4ec9b0;border:none;border-radius:5px;color:#000;font-size:11px;font-weight:600;cursor:pointer;">Continue →</button>' +
        '<button onclick="waveDecide(\'wave_modify\',' + wn + ')" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;cursor:pointer;">✏️ Modify</button>' +
        '<button onclick="waveDecide(\'wave_stopped\',' + wn + ')" style="padding:6px 10px;background:var(--bg);border:1px solid rgba(244,67,54,0.4);border-radius:5px;color:#f48771;font-size:11px;cursor:pointer;">⏹ Stop</button>' +
        '</div></div>';
      msgs.insertAdjacentHTML('beforeend', '<div class="msg system" id="wave-card-' + wn + '"><div class="bubble" style="padding:0">' + waveHtml + '</div></div>');
      msgs.scrollTop = msgs.scrollHeight;

    // ── Intent Card ───────────────────────────────────────────────────────
    } else if (ev.type === 'intent_card') {
      var msgs = document.getElementById('messages');
      if (!msgs) return;
      window._intentAnswers = {};
      window._intentSessionId = ev.sessionId || '';
      var questions = ev.questions || [];
      var qHtml = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-top:4px;">';
      qHtml += '<div style="font-size:12px;font-weight:600;color:var(--text-bright);margin-bottom:12px;">🎨 Quick setup — choose your preferences</div>';
      questions.forEach(function(q, qi) {
        qHtml += '<div style="margin-bottom:12px;" id="ic-q-' + qi + '">';
        qHtml += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">' + q.text + '</div>';
        qHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
        (q.options || []).forEach(function(opt) {
          var rec = opt.recommended ? ' style="border-color:#7c3aed;color:#a78bfa"' : '';
          qHtml += '<button onclick="intentPick(this,\'' + q.id + '\',\'' + opt.id + '\',' + qi + ')"' + rec +
            ' data-qid="' + q.id + '" data-val="' + opt.id + '"' +
            ' style="display:flex;flex-direction:column;align-items:flex-start;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;cursor:pointer;text-align:left;min-width:80px;">' +
            '<span style="font-size:14px">' + (opt.icon || '') + '</span>' +
            '<span style="font-size:11px;font-weight:500;color:var(--text-bright);margin-top:2px">' + opt.label + '</span>' +
            '<span style="font-size:10px;color:var(--muted)">' + (opt.description || '') + '</span>' +
            '</button>';
        });
        qHtml += '</div></div>';
      });
      qHtml += '<button onclick="intentSubmit()" id="btn-intent-submit" disabled style="margin-top:6px;width:100%;padding:8px;background:#7c3aed;border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;opacity:0.4;">Build it →</button>';
      qHtml += '</div>';
      msgs.insertAdjacentHTML('beforeend', '<div class="msg system" id="intent-card"><div class="bubble" style="padding:0">' + qHtml + '</div></div>');
      msgs.scrollTop = msgs.scrollHeight;
      window._intentTotal = questions.length;

    // ── Firecrawl Confirmation Card ────────────────────────────────────────
    } else if (ev.type === 'firecrawl_prompt') {
      var msgs = document.getElementById('messages');
      if (!msgs) return;
      var fc_sid = ev.sessionId || '';
      var fcHtml =
        '<div style="background:linear-gradient(135deg,rgba(251,146,60,0.08),rgba(239,68,68,0.06));' +
        'border:1px solid rgba(251,146,60,0.35);border-radius:10px;padding:14px 16px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
        '<span style="font-size:18px">🔥</span>' +
        '<span style="font-size:12px;font-weight:700;color:#fb923c">Scrape the web for design?</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:12px;line-height:1.5">' +
        'Firecrawl will extract real UI patterns from sites matching your app type. ' +
        'Adds ~10s but produces significantly better designs.' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="firecrawlDecide(true,\'' + fc_sid + '\')" id="fc-yes" ' +
        'style="flex:1;padding:8px;background:linear-gradient(135deg,#fb923c,#ef4444);border:none;' +
        'border-radius:6px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;">' +
        '🔥 Yes, scrape it</button>' +
        '<button onclick="firecrawlDecide(false,\'' + fc_sid + '\')" id="fc-no" ' +
        'style="padding:8px 16px;background:var(--bg);border:1px solid var(--border);' +
        'border-radius:6px;color:var(--muted);font-size:11px;cursor:pointer;">' +
        'Skip</button>' +
        '</div></div>';
      msgs.insertAdjacentHTML('beforeend',
        '<div class="msg system" id="fc-card"><div class="bubble" style="padding:0">' + fcHtml + '</div></div>');
      msgs.scrollTop = msgs.scrollHeight;
    } else if (ev.type === 'plan_ready') {
      // ── ChatGPT-style Plan Card ────────────────────────────────────────────
      var msgs = document.getElementById('messages');
      if (!msgs) return;
      var sid = ev.sessionId || '';
      var files = ev.planFiles || [];
      var stack = ev.planTechStack || [];
      var framework = ev.planFramework || 'Unknown';
      var taskType = ev.planTaskType || 'app';
      var budget = ev.planBudget || 15;
      var efficiency = ev.planEfficiency || 100;
      var folderTree = ev.planFolderStructure || '';

      // File list rows — show first 12, collapse rest
      var fileRows = '';
      var showAll = files.length <= 12;
      var visibleFiles = showAll ? files : files.slice(0, 12);
      visibleFiles.forEach(function(f) {
        var ext = f.split('.').pop() || '';
        var icon = ext === 'tsx' || ext === 'ts' ? '🔷' : ext === 'css' ? '🎨' : ext === 'json' ? '📋' : '📄';
        fileRows += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">' +
          '<span style="font-size:12px;">' + icon + '</span>' +
          '<span style="font-size:11px;color:var(--text-bright);font-family:monospace;">' + f + '</span>' +
          '</div>';
      });
      if (!showAll) {
        fileRows += '<div style="font-size:10px;color:var(--muted);padding:4px 0;cursor:pointer;" onclick="this.parentElement.innerHTML+=\'' +
          files.slice(12).map(function(f){ return '<div style=\\"padding:3px 0;font-size:11px;font-family:monospace;color:var(--text-bright);\\">' + f + '</div>'; }).join('') +
          '\';this.remove();">+ ' + (files.length - 12) + ' more files — click to expand</div>';
      }

      // Efficiency badge
      var effColor = efficiency >= 80 ? '#22c55e' : efficiency >= 60 ? '#f59e0b' : '#ef4444';
      var effLabel = efficiency >= 80 ? 'Efficient' : efficiency >= 60 ? 'Moderate' : 'Over-planned';

      var planHtml =
        '<div style="background:var(--surface);border:1px solid rgba(99,102,241,0.4);border-radius:12px;overflow:hidden;">' +
        // Header
        '<div style="background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1));padding:14px 16px;border-bottom:1px solid rgba(99,102,241,0.2);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:20px;">📋</span>' +
        '<div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-bright);">Build Plan</div>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:1px;">' + taskType.toUpperCase() + ' · ' + framework + '</div>' +
        '</div></div>' +
        '<div style="text-align:right;">' +
        '<div style="font-size:18px;font-weight:800;color:' + effColor + ';">' + efficiency + '%</div>' +
        '<div style="font-size:9px;color:' + effColor + ';">' + effLabel + '</div>' +
        '</div></div></div>' +
        // Tech stack chips
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">' +
        '<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Tech Stack</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:5px;">' +
        stack.map(function(s) {
          return '<span style="padding:3px 9px;font-size:10px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);border-radius:5px;color:#a5b4fc;">' + s + '</span>';
        }).join('') +
        '</div></div>' +
        // Files list
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;">Files to Create</div>' +
        '<span style="font-size:10px;color:var(--muted);">' + files.length + ' / ' + budget + ' budget</span>' +
        '</div>' +
        '<div style="max-height:200px;overflow-y:auto;padding-right:4px;">' + fileRows + '</div>' +
        '</div>' +
        // Folder tree (if present)
        (folderTree ? '<div style="padding:10px 16px;border-bottom:1px solid var(--border);"><div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Folder Structure</div><pre style="font-size:10px;color:var(--muted);margin:0;font-family:monospace;white-space:pre-wrap;">' + folderTree + '</pre></div>' : '') +
        // Action buttons
        '<div style="padding:12px 16px;display:flex;gap:8px;">' +
        '<button onclick="planDecide(\'approve\',\'' + sid + '\')" id="plan-approve-btn" ' +
        'style="flex:1;padding:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:7px;' +
        'color:#fff;font-size:12px;font-weight:700;cursor:pointer;transition:opacity 0.2s;">' +
        '✅ Approve & Build</button>' +
        '<button onclick="planDecide(\'modify\',\'' + sid + '\')" ' +
        'style="padding:10px 14px;background:var(--bg);border:1px solid rgba(99,102,241,0.4);border-radius:7px;' +
        'color:#a5b4fc;font-size:11px;cursor:pointer;">✏️ Modify</button>' +
        '<button onclick="planDecide(\'cancel\',\'' + sid + '\')" ' +
        'style="padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:7px;' +
        'color:var(--muted);font-size:11px;cursor:pointer;">✕ Cancel</button>' +
        '</div></div>';

      msgs.insertAdjacentHTML('beforeend',
        '<div class="msg system" id="plan-card"><div class="bubble" style="padding:0">' + planHtml + '</div></div>');
      msgs.scrollTop = msgs.scrollHeight;
    }
  }
});
// ── Delegated event handler for Copy/Edit/Revert icons ──
document.getElementById('messages').addEventListener('click', function(e) {
  try {
    var el = e.target;
    if (!el.closest) el = el.parentElement;
    if (!el) return;
    
    var copyBtn = el.closest('[data-copy-btn]');
    var editBtn = el.closest('[data-edit-btn]');
    var revertBtn = el.closest('[data-revert-btn]');
    if (copyBtn) {
      var txt = copyBtn._rawText || '';
      vscode.postMessage({ command: 'copyText', text: txt });
      // Swap to tick/checkmark icon for 2s
      var originalInner = copyBtn.innerHTML;
      var originalTitle = copyBtn.getAttribute('title') || 'Copy';
      copyBtn.innerHTML = '<path fill-rule="evenodd" d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>';
      copyBtn.style.color = '#4caf50';
      copyBtn.setAttribute('title', 'Copied!');
      setTimeout(function() {
        copyBtn.innerHTML = originalInner;
        copyBtn.style.color = '';
        copyBtn.setAttribute('title', originalTitle);
      }, 2000);
    } else if (editBtn) {
      var txt = editBtn._rawText || '';
      editMessage(editBtn, txt);
    } else if (revertBtn) {
      revertMessage(revertBtn);
    }
  } catch(err) {}
});

// ── Plan approval handlers ─────────────────────────────────────────────────
function planDecide(action, sessionId) {
  var card = document.getElementById('plan-card');
  if (action === 'approve') {
    if (card) card.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });
    // Show "Building..." status inside the card
    var approveBtn = document.getElementById('plan-approve-btn');
    if (approveBtn) approveBtn.textContent = '⚡ Building...';
    vscode.postMessage({ command: 'planApproved', sessionId: sessionId });
  } else if (action === 'modify') {
    // Put the pending prompt back in the input box so user can adjust
    var inputEl = document.getElementById('input');
    if (inputEl && window._pendingBuildPrompt) {
      inputEl.value = window._pendingBuildPrompt;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
      inputEl.focus();
    }
    if (card) card.remove();
    vscode.postMessage({ command: 'planCancelled', sessionId: sessionId });
  } else {
    if (card) card.remove();
    vscode.postMessage({ command: 'planCancelled', sessionId: sessionId });
    // Reset running state
    isRunning = false;
    document.getElementById('sendBtn').classList.remove('cancel');
    document.getElementById('icon-send').style.display = 'block';
    document.getElementById('icon-stop').style.display = 'none';
  }
}

// ── API Key Panel close ────────────────────────────────────────────────────
function closeApiPanel() {
  var panel = document.getElementById('apikeyPanel');
  var chat  = document.getElementById('chatArea');
  if (panel) panel.style.display = 'none';
  if (chat)  chat.style.display  = 'flex';
}

// ── Wave decision helpers ──────────────────────────────────────────────────
function waveDecide(type, waveNumber) {
  var card = document.getElementById('wave-card-' + waveNumber);
  if (card) {
    card.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.4'; });
  }
  vscode.postMessage({ command: type, sessionId: '', waveNumber: waveNumber });
}

// ── Firecrawl decision helper ──────────────────────────────────────────────
function firecrawlDecide(approved, sessionId) {
  var card = document.getElementById('fc-card');
  if (card) {
    card.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.4'; });
    // Show result inline
    var label = card.querySelector('#fc-yes');
    if (label) label.textContent = approved ? '🔥 Scraping...' : 'Skipped';
  }
  vscode.postMessage({ command: 'firecrawl_confirm', sessionId: sessionId, approved: approved });
}

// ── Intent card helpers ────────────────────────────────────────────────────
function intentPick(btn, qid, val, qi) {
  // Deselect siblings in same question group
  var group = btn.closest('[id^="ic-q-"]');
  if (group) {
    group.querySelectorAll('button').forEach(function(b) {
      b.style.borderColor = 'var(--border)';
      b.style.background = 'var(--bg)';
    });
  }
  btn.style.borderColor = '#7c3aed';
  btn.style.background = 'rgba(124,58,237,0.12)';
  if (!window._intentAnswers) window._intentAnswers = {};
  window._intentAnswers[qid] = val;
  // Enable submit when all questions answered
  var answered = Object.keys(window._intentAnswers).length;
  var submitBtn = document.getElementById('btn-intent-submit');
  if (submitBtn && answered >= (window._intentTotal || 1)) {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
  }
}

function intentSubmit() {
  var card = document.getElementById('intent-card');
  if (card) card.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.4'; });
  vscode.postMessage({
    command: 'intent_submit',
    sessionId: window._intentSessionId || '',
    answers: window._intentAnswers || {}
  });
}

</script>
</body>
</html>`
  }
}
