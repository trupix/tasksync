import fs from "fs";
import os from "os";
import path from "path";
import { IProvider, ProviderRoot } from "./interface";

export class ClineProvider implements IProvider {
  getProviderName(): string {
    return "cline";
  }

  getRoots(): ProviderRoot[] {
    const roots: ProviderRoot[] = [];

    // 1. Environment Override
    if (process.env.CLINE_DIR) {
      roots.push({
        id: "env-override",
        label: "Environment Override",
        path: path.resolve(process.env.CLINE_DIR),
      });
    }

    // 2. VS Code Extension globalStorage (primary — where the VS Code Cline extension stores data)
    const platform = os.platform();
    let vscodeGlobalStorage: string;
    if (platform === "darwin") {
      vscodeGlobalStorage = path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev");
    } else if (platform === "win32") {
      vscodeGlobalStorage = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User", "globalStorage", "saoudrizwan.claude-dev");
    } else {
      // Linux
      vscodeGlobalStorage = path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev");
    }

    if (fs.existsSync(vscodeGlobalStorage)) {
      roots.push({
        id: "vscode-extension",
        label: "VS Code",
        path: vscodeGlobalStorage,
      });
    }

    // 3. Cline CLI (~/.cline/data — used by the Cline terminal CLI)
    const cliPath = path.join(os.homedir(), ".cline", "data");
    if (fs.existsSync(cliPath)) {
      roots.push({
        id: "cli",
        label: "CLI",
        path: cliPath,
      });
    }

    // If nothing exists but no override was provided, return the extension path as default
    if (roots.length === 0) {
      roots.push({
        id: "vscode-extension",
        label: "VS Code Extension",
        path: vscodeGlobalStorage,
      });
    }

    return roots;
  }

  validateRoot(rootPath: string): boolean {
    if (!fs.existsSync(rootPath)) {
      console.error(
        `\n✗  Cline data directory not found: ${rootPath}\n` +
        `   Make sure Cline is installed and has been run at least once.\n` +
        `   You can override the path via the CLINE_DIR environment variable.\n`
      );
      return false;
    }

    try {
      fs.accessSync(rootPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      console.error(
        `\n✗  Cannot read/write Cline data directory: ${rootPath}\n` +
        `   Check file permissions and try again.\n`
      );
      return false;
    }

    return true;
  }

  getSchemaVersion(): number {
    return 1;
  }
}
