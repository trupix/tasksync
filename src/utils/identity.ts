import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const TaskSync_CONFIG_DIR = path.join(os.homedir(), ".TaskSync");
const MACHINE_CONFIG_PATH = path.join(TaskSync_CONFIG_DIR, "config.json");

export interface MachineConfig {
  machineId: string;
  createdAt: string;
}

/**
 * Returns the machine's persistent identity.
 * Creates `~/.TaskSync/config.json` on first run — this file is LOCAL ONLY
 * and is never committed to the sync repository.
 */
export function getMachineId(): string {
  ensureConfigDir();

  if (fs.existsSync(MACHINE_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(MACHINE_CONFIG_PATH, "utf8");
      const config = JSON.parse(raw) as MachineConfig;
      if (config.machineId) return config.machineId;
    } catch {
      // Corrupt config — regenerate below.
    }
  }

  const config: MachineConfig = {
    machineId: uuidv4(),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(MACHINE_CONFIG_PATH, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600, // owner read/write only
  });

  return config.machineId;
}

/** Generate a fresh workspace UUID (called once during `TaskSync init`). */
export function generateWorkspaceId(): string {
  return uuidv4();
}

function ensureConfigDir(): void {
  if (!fs.existsSync(TaskSync_CONFIG_DIR)) {
    fs.mkdirSync(TaskSync_CONFIG_DIR, { recursive: true });
  }
}
