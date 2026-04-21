import * as vscode from "vscode";
import { exec } from "child_process";

export async function runTerminalCommand(command: string): Promise<string> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error(
      "ZOZO CommandNode: No workspace folder open. Cannot execute command."
    );
  }

  const cwd = workspaceFolders[0].uri.fsPath;

  return new Promise<string>((resolve, reject) => {
    exec(command, { cwd, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error) {
        const failureMessage = [
          `🔴 ZOZO CommandNode: Command failed.`,
          `Command: ${command}`,
          `Exit Code: ${error.code}`,
          `stderr: ${stderr}`,
          `stdout: ${stdout}`,
        ].join("\n");

        reject(new Error(failureMessage));
        return;
      }

      if (stderr && stderr.trim().length > 0) {
        vscode.window.showWarningMessage(
          `⚠️ ZOZO CommandNode stderr: ${stderr.substring(0, 200)}`
        );
      }

      vscode.window.showInformationMessage(
        `✅ ZOZO CommandNode: Executed → ${command}`
      );

      resolve(stdout);
    });
  });
}
