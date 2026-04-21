import * as vscode from "vscode";

const KEY_PREFIX = "zozo.apiKey";

export class ZozoVault {
  private readonly secrets: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  async storeKey(provider: string, key: string): Promise<void> {
    await this.secrets.store(`${KEY_PREFIX}.${provider.toLowerCase()}`, key);
    vscode.window.showInformationMessage(
      `🔐 ZOZO Vault: ${provider} API key encrypted and stored in OS keychain.`
    );
  }

  async getKey(provider: string): Promise<string | undefined> {
    return this.secrets.get(`${KEY_PREFIX}.${provider.toLowerCase()}`);
  }
}
