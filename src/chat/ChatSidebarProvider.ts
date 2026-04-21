import * as vscode from 'vscode'
import { PipelineEventBus } from '../engine/PipelineEventBus'

/**
 * ChatSidebarProvider
 *
 * Registers ZOZO as a WebviewViewProvider so it appears
 * in the VS Code activity bar (left sidebar) as a persistent panel.
 * Same HTML as ChatPanel but shown in the sidebar instead of a tab.
 */
export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private _context: vscode.ExtensionContext

  constructor(context: vscode.ExtensionContext) {
    this._context = context

    // Subscribe to pipeline events — forward to sidebar webview
    const bus = PipelineEventBus.getInstance()
    bus.subscribe(event => {
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

    // Handle messages from sidebar webview
    webviewView.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'sendMessage':
          // Trigger build with prompt from sidebar
          await vscode.commands.executeCommand('zozo.promptAI', {
            prompt: message.text,
            mode: message.mode ?? 'normal',
          })
          break
        case 'cancelBuild':
          PipelineEventBus.getInstance().cancel()
          break
        case 'openSettings':
          await vscode.commands.executeCommand('zozo.openSettings')
          break
        case 'setMode':
          // Store mode preference
          await this._context.globalState.update('zozo.mode', message.mode)
          break
      }
    }, undefined, this._context.subscriptions)
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f; --surface: #111118; --border: rgba(255,255,255,0.06);
    --accent: #7c3aed; --text: #e4e4e7; --muted: #71717a;
    --success: #4ec9b0; --warn: #dcdcaa; --error: #f48771;
  }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--vscode-font-family, system-ui);
    font-size: 13px; height: 100vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px; border-bottom: 1px solid var(--border);
    background: var(--surface); flex-shrink: 0;
  }
  .logo { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--accent); }
  .mode-toggle { display: flex; background: var(--bg); border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
  .mode-btn { padding: 2px 8px; font-size: 10px; cursor: pointer; border: none; background: transparent; color: var(--muted); }
  .mode-btn.active { background: var(--accent); color: #fff; }
  #btn-max.active { background: linear-gradient(90deg,#dc2626,#ea580c); }
  .model-chip { font-size: 9px; padding: 1px 6px; background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25); border-radius: 8px; color: #a78bfa; cursor: pointer; }
  .messages { flex: 1; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 10px; }
  .welcome { padding: 20px 12px; text-align: center; }
  .welcome h2 { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .welcome p { font-size: 11px; color: var(--muted); line-height: 1.5; margin-bottom: 12px; }
  .example { padding: 6px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 7px; font-size: 11px; cursor: pointer; margin-bottom: 5px; transition: border-color .15s; }
  .example:hover { border-color: var(--accent); }
  .msg { display: flex; flex-direction: column; gap: 2px; }
  .msg.user { align-items: flex-end; }
  .msg.system { align-items: flex-start; }
  .bubble { max-width: 90%; padding: 6px 10px; border-radius: 10px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
  .msg.user .bubble { background: var(--accent); color: #fff; border-bottom-right-radius: 2px; }
  .msg.system .bubble { background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 2px; }
  .progress-strip { display: none; padding: 6px 10px; border-top: 1px solid var(--border); background: var(--surface); }
  .progress-strip.visible { display: block; }
  .progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .step-name { font-size: 10px; font-weight: 500; }
  .cancel-btn { font-size: 9px; padding: 1px 6px; background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 3px; cursor: pointer; }
  .bar-track { height: 2px; background: var(--border); border-radius: 1px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--accent); border-radius: 1px; width: 0%; transition: width .4s ease; }
  .quality-text { font-size: 9px; color: var(--muted); margin-top: 3px; display: none; }
  .stream-text { font-size: 9px; color: var(--muted); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; opacity: .6; }
  .input-area { padding: 6px 10px; border-top: 1px solid var(--border); display: flex; gap: 5px; align-items: flex-end; background: var(--surface); flex-shrink: 0; }
  .input-box { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 6px 8px; color: var(--text); font-size: 11px; resize: none; min-height: 30px; max-height: 100px; outline: none; font-family: inherit; }
  .input-box:focus { border-color: var(--accent); }
  .send-btn { background: var(--accent); border: none; color: #fff; border-radius: 6px; width: 26px; height: 26px; cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cost-hint { font-size: 9px; color: var(--warn); display: none; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
</style>
</head>
<body>

<div class="topbar">
  <span class="logo">\u26A1 ZOZO</span>
  <div style="display:flex;align-items:center;gap:6px;">
    <div class="mode-toggle">
      <button class="mode-btn active" id="btn-normal" onclick="setMode('normal')" title="Sonnet \u00B7 Fast \u00B7 Free">N</button>
      <button class="mode-btn" id="btn-ultra" onclick="setMode('ultra')" title="Opus \u00B7 Balanced">U</button>
      <button class="mode-btn" id="btn-max" onclick="setMode('max')" title="Opus ALL steps \u00B7 Max quality">\uD83D\uDD25</button>
    </div>
    <span class="model-chip" id="model-chip" onclick="openSettings()">sonnet-4.6</span>
  </div>
</div>

<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <div style="font-size:24px;margin-bottom:8px;">\u26A1</div>
    <h2>ZOZO is ready</h2>
    <p>Describe what to build.<br>ZOZO writes, fixes, and deploys it.</p>
    <div onclick="useExample(this)" class="example">build a dark SaaS landing page</div>
    <div onclick="useExample(this)" class="example">build a web3 NFT marketplace</div>
    <div onclick="useExample(this)" class="example">make the hero button purple</div>
  </div>
</div>

<div class="progress-strip" id="progress-strip">
  <div class="progress-header">
    <span class="step-name" id="step-name">Starting...</span>
    <div style="display:flex;gap:4px;align-items:center;">
      <span id="cost-hint" class="cost-hint"></span>
      <button class="cancel-btn" onclick="cancelBuild()">\u2715</button>
    </div>
  </div>
  <div class="bar-track"><div class="bar-fill" id="bar-fill"></div></div>
  <div class="quality-text" id="quality-text"></div>
  <div class="stream-text" id="stream-text"></div>
</div>

<div class="input-area">
  <textarea class="input-box" id="input" placeholder="What to build..." rows="1"
    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}"
    oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"></textarea>
  <button class="send-btn" onclick="send()">\u2191</button>
</div>

<script>
var vscode = acquireVsCodeApi();
var mode = 'normal';
var step = 0;
var TOTAL = 15;

function setMode(m) {
  mode = m;
  ['normal','ultra','max'].forEach(function(x) {
    document.getElementById('btn-'+x).classList.toggle('active', x===m);
  });
  var names = {normal:'sonnet-4.6', ultra:'opus-4.6', max:'opus-4.6 \uD83D\uDD25'};
  document.getElementById('model-chip').textContent = names[m];
  var costs = {normal:'', ultra:'~$0.10-0.60', max:'\u26A0 $0.50-3.00'};
  var ch = document.getElementById('cost-hint');
  ch.textContent = costs[m]; ch.style.display = costs[m] ? 'inline' : 'none';
  vscode.postMessage({command:'setMode', mode:m});
}

function send() {
  var el = document.getElementById('input');
  var text = el.value.trim();
  if (!text) return;
  addMsg('user', text);
  el.value = ''; el.style.height = 'auto';
  var wel = document.getElementById('welcome');
  if (wel) wel.remove();
  vscode.postMessage({command:'sendMessage', text:text, mode:mode});
}

function useExample(el) {
  document.getElementById('input').value = el.textContent.trim();
  document.getElementById('input').focus();
  var wel = document.getElementById('welcome');
  if (wel) wel.remove();
}

function cancelBuild() { vscode.postMessage({command:'cancelBuild'}); }
function openSettings() { vscode.postMessage({command:'openSettings'}); }

function addMsg(role, text) {
  var msgs = document.getElementById('messages');
  var d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = '<div class="bubble">' + text.replace(/</g,'&lt;') + '</div>';
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function showProgress() { document.getElementById('progress-strip').classList.add('visible'); }
function hideProgress() {
  document.getElementById('progress-strip').classList.remove('visible');
  document.getElementById('bar-fill').style.width = '0%';
  document.getElementById('quality-text').style.display = 'none';
  document.getElementById('stream-text').textContent = '';
  step = 0;
}
function updateBar(p) { document.getElementById('bar-fill').style.width = p + '%'; }

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (msg.type !== 'pipeline_event') return;
  var ev = msg.event;
  if (!ev) return;
  switch(ev.type) {
    case 'session_start':
      showProgress(); updateBar(5);
      document.getElementById('step-name').textContent = 'Starting...';
      break;
    case 'step_start':
      document.getElementById('step-name').textContent = ev.stepName || '...';
      break;
    case 'step_complete':
      step = ev.stepNumber || step + 1;
      updateBar(Math.min(95, Math.round(step/TOTAL*90)+5));
      break;
    case 'llm_chunk': {
      var s = document.getElementById('stream-text');
      s.dataset.buf = (s.dataset.buf||'') + (ev.chunk||'');
      var f = s.dataset.buf;
      s.textContent = f.length > 80 ? '\u2026'+f.slice(-80) : f;
      break;
    }
    case 'quality_category':
      document.getElementById('quality-text').style.display = 'block';
      document.getElementById('quality-text').textContent = '\uD83D\uDD0D ' + ev.category;
      break;
    case 'quality_complete':
      document.getElementById('quality-text').textContent =
        (ev.qualityScore >= 85 ? '\u2728' : ev.qualityScore >= 65 ? '\u2705' : '\u26A0\uFE0F') +
        ' ' + ev.qualityVerdict + ' (' + ev.qualityScore + '/100)';
      break;
    case 'build_complete':
      updateBar(100);
      document.getElementById('step-name').textContent = '\u2705 Done \u2014 ' + (ev.fileCount||0) + ' files';
      addMsg('system', '\u2705 Build complete \u2014 ' + (ev.fileCount||0) + ' files. Run: npm run dev');
      setTimeout(hideProgress, 4000);
      var st = document.getElementById('stream-text');
      st.dataset.buf = ''; st.textContent = '';
      break;
    case 'build_failed':
      document.getElementById('step-name').textContent = '\u274C ' + (ev.error||'failed');
      addMsg('system', '\u274C ' + (ev.error||'Build failed'));
      setTimeout(hideProgress, 5000);
      break;
    case 'build_cancelled':
      document.getElementById('step-name').textContent = '\u23F9 Cancelled';
      setTimeout(hideProgress, 2000);
      break;
    case 'step_failed':
      if (ev.error && ev.error.indexOf('Rate limited') >= 0) {
        document.getElementById('step-name').textContent = '\u23F3 ' + ev.error;
      }
      break;
  }
});
</script>
</body>
</html>`
  }
}
