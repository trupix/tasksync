import fs from "fs";
import path from "path";
import { IProvider, ProviderRoot } from "../providers/interface";
import { loadPat } from "../utils/auth";
import {
  addAll,
  commit,
  hasRemote,
  initRepo,
  isGitRepo,
  pullRebase,
  push,
  setRemote,
} from "../utils/git";
import { ensureGitignore } from "../utils/gitignore";
import { generateWorkspaceId, getSyncRepoPath, setSyncConfig } from "../utils/identity";
import {
  TaskSync_VERSION,
  readManifest,
  touchLastSynced,
  writeManifest,
  readUnifiedManifest,
  writeUnifiedManifest,
  touchUnifiedLastSynced,
  UnifiedManifest,
} from "../utils/manifest";
import { copyLocalToRepo, copyRepoToLocal } from "../utils/filesync";

// --- Typed errors -------------------------------------------------------------

export class ProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderValidationError";
  }
}

export class SyncNotInitializedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncNotInitializedError";
  }
}

export class SyncNoRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncNoRemoteError";
  }
}

// --- Unified sync types -------------------------------------------------------

export interface UnifiedSyncTarget {
  provider: IProvider;
  root: ProviderRoot;
}

export interface UnifiedInitOptions {
  repoUrl: string;
  pat?: string;
  /** Defaults to ~/.TaskSync/sync */
  syncRepoPath?: string;
}

// --- Helpers ------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGitError(e: any): boolean {
  const msg = String(e?.message ?? "").toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("connection reset") ||
    msg.includes("connection refused") ||
    msg.includes("temporary failure") ||
    msg.includes("network is unreachable") ||
    msg.includes("remote end hung up") ||
    msg.includes("could not resolve host")
  );
}

async function withRetry<T>(label: string, op: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await op();
    } catch (e: any) {
      lastErr = e;
      if (!isTransientGitError(e) || attempt === maxAttempts) throw e;
      const delayMs = 250 * Math.pow(2, attempt - 1);
      console.warn(`  \u26a0 ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

function resolvePat(opts?: { pat?: string }): string | undefined {
  return opts?.pat || process.env.TaskSync_GIT_TOKEN || loadPat() || undefined;
}

// ============================================================================
// UNIFIED MODEL — one repo, one subfolder per provider
// ============================================================================

/**
 * Initialize the unified sync repo for one or more providers.
 *
 * 1. Create the sync working tree at ~/.TaskSync/sync (or syncRepoPath).
 * 2. Write a combined .gitignore.
 * 3. Git init the working tree.
 * 4. Copy each provider's data dir into its <providerName>/ subfolder.
 * 5. Write .TaskSync_manifest.json at the repo root.
 * 6. Set remote, commit, pull, push.
 * 7. Save sync config to ~/.TaskSync/config.json.
 */
export async function runUnifiedInit(
  targets: UnifiedSyncTarget[],
  opts: UnifiedInitOptions
): Promise<void> {
  const syncRepoPath = opts.syncRepoPath ?? getSyncRepoPath();
  const pat = resolvePat(opts);

  // 1. Create sync directory
  fs.mkdirSync(syncRepoPath, { recursive: true });

  // 2. Write .gitignore
  console.log("  Writing .gitignore...");
  ensureGitignore(syncRepoPath);

  // 3. Init git repo
  const alreadyRepo = await isGitRepo(syncRepoPath);
  if (!alreadyRepo) {
    console.log("  Initializing git repository...");
    await initRepo(syncRepoPath);
  }

  // 4. Build manifest
  const existing = readUnifiedManifest(syncRepoPath);
  const workspaceId = existing?.workspaceId ?? generateWorkspaceId();
  const now = new Date().toISOString();

  const providerEntries: UnifiedManifest["providers"] = existing?.providers ?? {};
  for (const { provider, root } of targets) {
    const name = provider.getProviderName();
    providerEntries[name] = {
      dataPath: root.path,
      lastSyncedAt: providerEntries[name]?.lastSyncedAt ?? null,
      enabled: true,
    };
  }

  const manifest: UnifiedManifest = {
    schemaVersion: 2,
    workspaceId,
    repoUrl: opts.repoUrl,
    initializedAt: existing?.initializedAt ?? now,
    providers: providerEntries,
  };
  writeUnifiedManifest(syncRepoPath, manifest);

  // 5. Copy each provider's data into its subfolder
  for (const { provider, root } of targets) {
    const name = provider.getProviderName();
    const subfolder = path.join(syncRepoPath, name);
    console.log(`  Snapshotting ${name}...`);
    copyLocalToRepo(root.path, subfolder);
  }

  // 6. Set remote, commit, pull, push
  console.log("  Configuring remote...");
  await setRemote(syncRepoPath, opts.repoUrl);

  await addAll(syncRepoPath);
  const committed = await commit(syncRepoPath, "TaskSync: init");
  if (committed) {
    console.log("  Initial commit created.");
  } else {
    console.log("  Nothing new to commit.");
  }

  const remote = await hasRemote(syncRepoPath);
  if (remote) {
    console.log("  Pulling from remote...");
    try {
      await withRetry("pull", () => pullRebase(syncRepoPath, pat));
    } catch (e: any) {
      if (
        !e.message?.includes("couldn't find remote ref") &&
        !e.message?.includes("does not appear to be a git repository")
      ) {
        throw e;
      }
    }
    console.log("  Pushing to remote...");
    await withRetry("push", () => push(syncRepoPath, pat));
  }

  // 7. Save sync config to machine config
  setSyncConfig(syncRepoPath, opts.repoUrl);

  // Update manifest timestamps
  for (const { provider } of targets) {
    touchUnifiedLastSynced(syncRepoPath, provider.getProviderName());
  }

  const finalManifest = readUnifiedManifest(syncRepoPath)!;
  console.log(`\n\u2713  TaskSync initialized successfully!`);
  console.log(`   Sync repo:  ${syncRepoPath}`);
  console.log(`   Remote:     ${opts.repoUrl}`);
  console.log(`   Workspace:  ${finalManifest.workspaceId}`);
  console.log(`   Providers:  ${targets.map(t => t.provider.getProviderName()).join(", ")}\n`);
}

/**
 * Sync one or more providers using the unified repo model.
 *
 * 1. git pull --rebase (get latest remote state into staging).
 * 2. Copy staging subfolders → local provider data dirs (merge: no deletes).
 * 3. Copy local provider data dirs → staging subfolders (mirror: full snapshot).
 * 4. git add, commit if dirty, push.
 * 5. Update manifest lastSyncedAt for each synced provider.
 */
export async function runUnifiedSync(
  targets: UnifiedSyncTarget[],
  opts?: { pat?: string }
): Promise<void> {
  const syncRepoPath = getSyncRepoPath();
  const pat = resolvePat(opts);

  if (!(await isGitRepo(syncRepoPath))) {
    throw new SyncNotInitializedError(
      `Sync repo not initialized at ${syncRepoPath}.\n   Run:  TaskSync init <repo-url>`
    );
  }

  if (!(await hasRemote(syncRepoPath))) {
    throw new SyncNoRemoteError(
      `No remote configured for sync repo.\n   Run:  TaskSync init <repo-url>`
    );
  }

  // 1. Pull latest
  console.log("  Pulling remote changes...");
  await withRetry("pull", () => pullRebase(syncRepoPath, pat));

  // 2. Apply repo → local (merge: no deletes, preserves local-only files)
  for (const { provider, root } of targets) {
    const name = provider.getProviderName();
    const subfolder = path.join(syncRepoPath, name);
    if (fs.existsSync(subfolder)) {
      console.log(`  Applying ${name} changes from repo to local...`);
      copyRepoToLocal(subfolder, root.path);
    }
  }

  // 3. Copy local → repo (mirror: full snapshot of current local state)
  for (const { provider, root } of targets) {
    const name = provider.getProviderName();
    const subfolder = path.join(syncRepoPath, name);
    console.log(`  Snapshotting ${name} to repo...`);
    copyLocalToRepo(root.path, subfolder);
  }

  // 4. Commit and push
  await addAll(syncRepoPath);
  const committed = await commit(syncRepoPath, "TaskSync: sync");
  if (committed) {
    console.log("  Local changes committed.");
  } else {
    console.log("  No local changes to commit.");
  }

  console.log("  Pushing to remote...");
  await withRetry("push", () => push(syncRepoPath, pat));

  // 5. Update manifest
  for (const { provider } of targets) {
    touchUnifiedLastSynced(syncRepoPath, provider.getProviderName());
  }

  console.log(`\n\u2713  Sync complete \u2014 ${new Date().toLocaleTimeString()}\n`);
}

// ============================================================================
// LEGACY MODEL — kept for backward compatibility (one git repo per provider)
// ============================================================================

export interface InitOptions {
  repoUrl: string;
  pat?: string;
}

/**
 * @deprecated Use runUnifiedInit instead.
 * Initializes a per-provider git repo directly inside the provider's data dir.
 */
export async function runInit(
  provider: IProvider,
  rootId: string,
  rootPath: string,
  rootLabel: string,
  opts: InitOptions
): Promise<void> {
  const dataPath = rootPath;
  const pat = resolvePat(opts);

  if (!provider.validateRoot(rootPath)) {
    throw new ProviderValidationError(
      `Provider "${provider.getProviderName()}" root validation failed for: ${rootPath}`
    );
  }

  console.log("  Writing .gitignore rules...");
  ensureGitignore(dataPath);

  const alreadyRepo = await isGitRepo(dataPath);
  if (!alreadyRepo) {
    console.log("  Initialising git repository...");
    await initRepo(dataPath);
  }

  const existingManifest = readManifest(dataPath);
  const workspaceId = existingManifest?.workspaceId ?? generateWorkspaceId();

  console.log("  Writing manifest...");
  writeManifest(dataPath, {
    provider: provider.getProviderName(),
    TaskSyncVersion: TaskSync_VERSION,
    schemaVersion: provider.getSchemaVersion(),
    workspaceId,
    initializedAt: existingManifest?.initializedAt ?? new Date().toISOString(),
    lastSyncedAt: existingManifest?.lastSyncedAt ?? null,
    rootId,
    rootLabel,
    workspaceMode: existingManifest?.workspaceMode ?? "single-root",
    attachedRoots: existingManifest?.attachedRoots ?? [],
  });

  console.log("  Configuring remote...");
  await setRemote(dataPath, opts.repoUrl);

  console.log("  Staging files...");
  await addAll(dataPath);

  const committed = await commit(dataPath, "TaskSync: init");
  if (committed) console.log("  Initial commit created.");
  else console.log("  Nothing new to commit.");

  const remote = await hasRemote(dataPath);
  if (remote) {
    console.log("  Pulling from remote...");
    try {
      await withRetry("pull", () => pullRebase(dataPath, pat));
    } catch (e: any) {
      if (
        !e.message?.includes("couldn't find remote ref") &&
        !e.message?.includes("does not appear to be a git repository")
      ) {
        throw e;
      }
    }
    console.log("  Pushing to remote...");
    await withRetry("push", () => push(dataPath, pat));
  }

  touchLastSynced(dataPath);

  const manifest = readManifest(dataPath)!;
  console.log(`\n\u2713  TaskSync initialised successfully!`);
  console.log(`   Provider:     ${provider.getProviderName()}`);
  console.log(`   Data path:    ${dataPath}`);
  console.log(`   Workspace ID: ${manifest.workspaceId}`);
  console.log(`   Remote:       ${opts.repoUrl}\n`);
}

/**
 * @deprecated Use runUnifiedSync instead.
 * Syncs a per-provider git repo directly inside the provider's data dir.
 */
export async function runSync(provider: IProvider, rootPath: string): Promise<void> {
  const dataPath = rootPath;
  const pat = resolvePat();

  if (!provider.validateRoot(rootPath)) {
    throw new ProviderValidationError(
      `Provider "${provider.getProviderName()}" root validation failed for: ${rootPath}`
    );
  }

  if (!(await isGitRepo(dataPath))) {
    throw new SyncNotInitializedError(
      `${dataPath} is not a git repository.\n   Run:  TaskSync init <repo-url> [--pat <token>]`
    );
  }

  if (!(await hasRemote(dataPath))) {
    throw new SyncNoRemoteError(
      `No remote configured for ${dataPath}.\n   Run:  TaskSync init <repo-url> [--pat <token>]`
    );
  }

  console.log("  Pulling remote changes...");
  await withRetry("pull", () => pullRebase(dataPath, pat));

  await addAll(dataPath);

  const committed = await commit(dataPath, "TaskSync: sync");
  if (committed) console.log("  Local changes committed.");
  else console.log("  No local changes to commit.");

  console.log("  Pushing to remote...");
  await withRetry("push", () => push(dataPath, pat));

  touchLastSynced(dataPath);

  console.log(`\n\u2713  Sync complete \u2014 ${new Date().toLocaleTimeString()}\n`);
}
