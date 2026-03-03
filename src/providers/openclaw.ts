/**
 * OpenClaw provider.
 *
 * OpenClaw is a multi-channel AI gateway with an embedded Pi coding agent.
 * It stores sessions as JSONL files (one AgentMessage per line) at:
 *
 *   ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
 *
 * Legacy state dirs (.clawdbot, .moldbot, .moltbot) are also checked.
 * State dir can be overridden via OPENCLAW_STATE_DIR env variable.
 *
 * Reference: https://github.com/openclaw/openclaw
 */
import fs from "fs";
import os from "os";
import path from "path";
import { IProvider, ProviderRoot } from "./interface";

const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moldbot", ".moltbot"] as const;
const NEW_STATE_DIRNAME = ".openclaw";

export class OpenClawProvider implements IProvider {
  getProviderName(): string {
    return "openclaw";
  }

  getRoots(): ProviderRoot[] {
    const roots: ProviderRoot[] = [];

    // 1. Environment override
    const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
    if (override) {
      roots.push({
        id: "env-override",
        label: "Environment Override",
        path: path.resolve(override),
      });
      return roots;
    }

    const home = os.homedir();
    const newDir = path.join(home, NEW_STATE_DIRNAME);
    const legacyDirs = LEGACY_STATE_DIRNAMES.map((n) => ({ name: n, dir: path.join(home, n) }));

    // 2. New state dir (~/.openclaw)
    if (fs.existsSync(newDir)) {
      roots.push({
        id: "default",
        label: "OpenClaw (~/.openclaw)",
        path: newDir,
      });
    }

    // 3. Legacy state dirs (only add those that exist)
    for (const { name, dir } of legacyDirs) {
      if (fs.existsSync(dir)) {
        roots.push({
          id: name.slice(1), // e.g. "clawdbot"
          label: `OpenClaw (legacy ${name})`,
          path: dir,
        });
      }
    }

    // Default candidate if nothing exists yet
    if (roots.length === 0) {
      roots.push({
        id: "default",
        label: "OpenClaw (~/.openclaw)",
        path: newDir,
      });
    }

    return roots;
  }

  validateRoot(rootPath: string): boolean {
    if (!fs.existsSync(rootPath)) {
      // OpenClaw is simply not installed — silent false, no error spam
      return false;
    }

    try {
      fs.accessSync(rootPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      console.error(
        `\n✗  Cannot read/write OpenClaw state directory: ${rootPath}\n` +
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
