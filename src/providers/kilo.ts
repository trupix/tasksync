import fs from "fs";
import os from "os";
import path from "path";
import { IProvider, ProviderRoot } from "./interface";

export class KiloProvider implements IProvider {
  getProviderName(): string {
    return "kilo";
  }

  getRoots(): ProviderRoot[] {
    const roots: ProviderRoot[] = [];

    // 1. Environment Override
    if (process.env.KILO_DIR) {
      roots.push({
        id: "env-override",
        label: "Environment Override",
        path: path.resolve(process.env.KILO_DIR),
      });
    }

    // 2. Standard Local VS Code
    const standardPath = path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "kilocode.kilo-code");
    const linuxPath = path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "kilocode.kilo-code");
    const winPath = path.join(os.homedir(), "AppData", "Roaming", "Code", "User", "globalStorage", "kilocode.kilo-code");
    
    const localPath = process.platform === "darwin" ? standardPath : process.platform === "win32" ? winPath : linuxPath;

    if (fs.existsSync(localPath)) {
      roots.push({
        id: "vscode-local",
        label: "VS Code (Local)",
        path: localPath,
      });
    }

    // 3. VS Code Server
    const serverPath = path.join(os.homedir(), ".vscode-server", "data", "User", "globalStorage", "kilocode.kilo-code");
    if (fs.existsSync(serverPath)) {
      roots.push({
        id: "vscode-server",
        label: "VS Code Server",
        path: serverPath,
      });
    }

    // If nothing exists but no override was provided, return the standard path as a default candidate
    if (roots.length === 0) {
      roots.push({
        id: "vscode-local",
        label: "VS Code (Local)",
        path: localPath,
      });
    }

    return roots;
  }

  validateRoot(rootPath: string): boolean {
    if (!fs.existsSync(rootPath)) {
      console.error(
        `\n✗  Kilo data directory not found: ${rootPath}\n` +
        `   Make sure Kilo is installed and has been run at least once.\n` +
        `   You can override the path via the KILO_DIR environment variable.\n`
      );
      return false;
    }

    try {
      fs.accessSync(rootPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      console.error(
        `\n✗  Cannot read/write Kilo data directory: ${rootPath}\n` +
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