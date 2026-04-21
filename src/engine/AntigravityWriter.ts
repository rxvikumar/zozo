import * as vscode from "vscode";

const ZOZO_ACTION_REGEX =
  /<zozo_action\s+type="write"\s+path="([^"]+)">([\s\S]*?)<\/zozo_action>/g;

const MARKDOWN_FENCE_REGEX = /^```(?:\w+)?\s*\n?|```\s*$/g;

export async function executeZozoStream(xmlPayload: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage(
      "❌ ZOZO Engine: No workspace folder is open. Aborting write stream."
    );
    return;
  }

  const rootUri = workspaceFolders[0].uri;
  let matchCount = 0;
  let match: RegExpExecArray | null;

  while ((match = ZOZO_ACTION_REGEX.exec(xmlPayload)) !== null) {
    const extractedPath = match[1];
    let code = match[2];

    // Strip any markdown fencing from the code block
    code = code.replace(MARKDOWN_FENCE_REGEX, "").trim();
    // Enforce LF line endings
    code = code.replace(/\r\n/g, '\n');

    const fileUri = vscode.Uri.joinPath(rootUri, extractedPath);

    // Ensure parent directory exists before writing
    const parentUri = vscode.Uri.joinPath(fileUri, "..");
    await vscode.workspace.fs.createDirectory(parentUri);

    // Write the file
    const encoded = new TextEncoder().encode(code);
    await vscode.workspace.fs.writeFile(fileUri, encoded);

    matchCount++;
    vscode.window.showInformationMessage(
      `✅ ZOZO Writer: Built file → ${extractedPath}`
    );
  }

  if (matchCount === 0) {
    vscode.window.showWarningMessage(
      "⚠️ ZOZO Writer: No <zozo_action> blocks found in the payload."
    );
  } else {
    vscode.window.showInformationMessage(
      `🚀 ZOZO Writer: Stream complete. ${matchCount} file(s) materialized.`
    );
  }
}

// ─── Single-file writer (VS Code API) ────────────────────────────────────────

export async function writeFile(filePath: string, content: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folder is open.");
  }

  // Enforce LF line endings — prevents OneDrive CRLF corruption
  const lfContent = content.replace(/\r\n/g, '\n');

  // Sanitize to valid UTF-8 — strips bullet points, zero-width chars, and other non-ASCII garbage
  // eslint-disable-next-line no-control-regex
  const safeContent = lfContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/\u2022/g, '-')   // bullet → dash
    .replace(/\u2013/g, '-')   // en-dash → dash
    .replace(/\u2014/g, '--')  // em-dash → --
    .replace(/\u2018|\u2019/g, "'")  // smart quotes → normal
    .replace(/\u201C|\u201D/g, '"')  // smart double quotes → normal

  const rootUri = workspaceFolders[0].uri;
  const fileUri = vscode.Uri.joinPath(rootUri, filePath);
  const parentUri = vscode.Uri.joinPath(fileUri, "..");

  await vscode.workspace.fs.createDirectory(parentUri);
  const encoded = new TextEncoder().encode(safeContent);
  await vscode.workspace.fs.writeFile(fileUri, encoded);
}

// ─── Batch writer ────────────────────────────────────────────────────────────

export async function writeMany(actions: Array<{ path: string; content: string }>): Promise<void> {
  for (const action of actions) {
    await writeFile(action.path, action.content);
  }
}
