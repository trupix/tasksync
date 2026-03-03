import fs from "fs";
import path from "path";

export const MANIFEST_FILENAME = ".TaskSync_manifest.json";
export const TaskSync_VERSION = "0.1.0";

export interface TaskSyncManifest {
  provider: string;
  TaskSyncVersion: string;
  schemaVersion: number;
  workspaceId: string;
  initializedAt: string;
  lastSyncedAt: string | null;
  rootId?: string;
  rootLabel?: string;
  workspaceMode?: "single-root" | "multi-root";
  attachedRoots?: Array<{ rootId: string; rootLabel: string; pathHint: string }>;
}

/**
 * Write a fresh manifest into the provider's data directory.
 * Called once during `TaskSync init`.
 */
export function writeManifest(dataPath: string, manifest: TaskSyncManifest): void {
  const manifestPath = path.join(dataPath, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

/**
 * Read the manifest from the provider's data directory.
 * Returns null if the manifest file doesn't exist or is unreadable.
 */
export function readManifest(dataPath: string): TaskSyncManifest | null {
  const manifestPath = path.join(dataPath, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    return JSON.parse(raw) as TaskSyncManifest;
  } catch {
    return null;
  }
}

/**
 * Update the `lastSyncedAt` timestamp in an existing manifest.
 * No-op if manifest doesn't exist yet.
 */
export function touchLastSynced(dataPath: string): void {
  const manifest = readManifest(dataPath);
  if (!manifest) return;

  manifest.lastSyncedAt = new Date().toISOString();
  writeManifest(dataPath, manifest);
}
