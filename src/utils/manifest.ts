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

// --- Unified manifest (single repo for all providers) -------------------------

export interface ProviderSyncEntry {
  dataPath: string;
  lastSyncedAt: string | null;
  enabled: boolean;
}

export interface UnifiedManifest {
  schemaVersion: number;
  workspaceId: string;
  repoUrl: string;
  initializedAt: string;
  providers: Record<string, ProviderSyncEntry>;
}

/**
 * Read the unified manifest from the sync repo root.
 * Returns null if not found or unreadable.
 */
export function readUnifiedManifest(syncRepoPath: string): UnifiedManifest | null {
  const manifestPath = path.join(syncRepoPath, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    return JSON.parse(raw) as UnifiedManifest;
  } catch {
    return null;
  }
}

/**
 * Write the unified manifest to the sync repo root.
 */
export function writeUnifiedManifest(syncRepoPath: string, manifest: UnifiedManifest): void {
  const manifestPath = path.join(syncRepoPath, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

/**
 * Update the `lastSyncedAt` timestamp for a specific provider in the unified manifest.
 */
export function touchUnifiedLastSynced(syncRepoPath: string, providerName: string): void {
  const manifest = readUnifiedManifest(syncRepoPath);
  if (!manifest?.providers[providerName]) return;
  manifest.providers[providerName].lastSyncedAt = new Date().toISOString();
  writeUnifiedManifest(syncRepoPath, manifest);
}
