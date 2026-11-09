const code = [
  'function renderMarkdown(text) {',
  '  var escaped = text',
  '    .replace(/&/g, "&amp;")',
  '    .replace(/</g, "&lt;")',
  '    .replace(/>/g, "&gt;");',
  '  var bt = String.fromCharCode(96);',
  '  var tbt = bt+bt+bt;',
  '  var tripleRe = new RegExp(tbt+"(\\\\w*)\\\\n?([\\\\s\\\\S]*?)"+tbt, "g");',
  '  escaped = escaped.replace(tripleRe, function(m, lang, code) {',
  '    return "<pre><code>" + code.trim() + "</code></pre>";',
  '  });',
  '  var inlineRe = new RegExp(bt+"([^"+bt+"]+)"+bt, "g");',
  '  escaped = escaped.replace(inlineRe, "<code>$1</code>");',
  '  escaped = escaped.replace(/^### (.+)$/gm, "<h3>$1</h3>");',
  '  escaped = escaped.replace(/^## (.+)$/gm, "<h2>$1</h2>");',
  '  escaped = escaped.replace(/^# (.+)$/gm, "<h2>$1</h2>");',
  '  escaped = escaped.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");',
  '  escaped = escaped.replace(/\\*(.+?)\\*/g, "<em>$1</em>");',
  '  escaped = escaped.replace(/^---+$/gm, "<hr>");',
  '  escaped = escaped.replace(/^[*-] (.+)$/gm, "<li>$1</li>");',
  '  escaped = escaped.replace(/(<li>[\\s\\S]*?<\\/li>)+/g, "<ul>$&</ul>");',
  '  escaped = escaped.replace(/^\\d+\\. (.+)$/gm, "<li>$1</li>");',
  '  escaped = escaped.replace(/\\n/g, "<br>");',
  '  escaped = escaped.replace(/<pre>([\\s\\S]*?)<\\/pre>/g, function(m, inner) {',
  '    return "<pre>" + inner.replace(/<br>/g, "\\n") + "</pre>";',
  '  });',
  '  return escaped;',
  '}'
].join('\n');

try {
  new Function(code);
  console.log('OK!');
} catch (e) {
  console.log('ERROR:', e.message);
}
