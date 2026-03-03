import { IProvider } from "../providers/interface";
import { loadPat } from "../utils/auth";
import {
    addAll,
    commit, hasRemote,
    initRepo,
    isGitRepo,
    pullRebase,
    push,
    setRemote
} from "../utils/git";
import { ensureGitignore } from "../utils/gitignore";
import { generateWorkspaceId } from "../utils/identity";
import {
    TaskSync_VERSION,
    readManifest,
    touchLastSynced,
    writeManifest,
} from "../utils/manifest";

// --- Typed errors for callers to handle ---------------------------------------

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

export interface InitOptions {
  repoUrl: string;
  pat?: string;
}

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
      if (!isTransientGitError(e) || attempt === maxAttempts) {
        throw e;
      }
      const delayMs = 250 * Math.pow(2, attempt - 1);
      console.warn(`? ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

/**
 * Resolve the PAT to use for git operations.
 * Priority:
 *   1. Explicit --pat flag
 *   2. TaskSync_GIT_TOKEN env var
 *   3. ~/.TaskSync/auth.json (stored by `TaskSync auth`)
 *   4. undefined ? falls back to SSH / git credential helper
 */
function resolvePat(opts?: { pat?: string }): string | undefined {
  return opts?.pat || process.env.TaskSync_GIT_TOKEN || loadPat() || undefined;
}

/**
 * Initialise TaskSync for a provider:
 *  1. Ensure the data directory exists.
 *  2. Write a comprehensive .gitignore.
 *  3. Init git repo (if not already).
 *  4. Write .TaskSync_manifest.json (create workspaceId).
 *  5. Set remote (clean URL — no embedded credentials).
 *  6. Stage ? commit ? pull ? push (PAT passed ephemerally).
 *
 * Throws ProviderValidationError if the root is invalid.
 */
export async function runInit(provider: IProvider, rootId: string, rootPath: string, rootLabel: string, opts: InitOptions): Promise<void> {
  const dataPath = rootPath;
  const pat = resolvePat(opts);

  if (!provider.validateRoot(rootPath)) {
    throw new ProviderValidationError(
      `Provider "${provider.getProviderName()}" root validation failed for: ${rootPath}`
    );
  }

  // 1. Write comprehensive .gitignore
  console.log("? Writing .gitignore rules...");
  ensureGitignore(dataPath);

  // 2. Init git repo
  const alreadyRepo = await isGitRepo(dataPath);
  if (!alreadyRepo) {
    console.log("? Initialising git repository...");
    await initRepo(dataPath);
  } else {
    console.log("? Git repository already initialised.");
  }

  // 3. Create or update manifest (preserve existing workspaceId across re-inits)
  const existingManifest = readManifest(dataPath);
  const workspaceId = existingManifest?.workspaceId ?? generateWorkspaceId();

  console.log("? Writing manifest...");
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

  // 4. Set remote (clean URL — no credentials embedded)
  console.log("? Configuring remote...");
  await setRemote(dataPath, opts.repoUrl);

  // 5. Initial commit
  console.log("? Staging files...");
  await addAll(dataPath);

  const committed = await commit(dataPath, "TaskSync: init");
  if (committed) {
    console.log("? Initial commit created.");
  } else {
    console.log("? Nothing new to commit.");
  }

  // 6. Pull then push (PAT passed ephemerally via GIT_ASKPASS)
  const remote = await hasRemote(dataPath);
  if (remote) {
    console.log("? Pulling from remote...");
    try {
      await withRetry("pull", () => pullRebase(dataPath, pat));
    } catch (e: any) {
      // Remote may be completely empty on first push — that's fine.
      if (!e.message?.includes("couldn't find remote ref") && !e.message?.includes("does not appear to be a git repository")) {
        throw e;
      }
    }

    console.log("? Pushing to remote...");
    await withRetry("push", () => push(dataPath, pat));
  }

  touchLastSynced(dataPath);

  const manifest = readManifest(dataPath)!;
  console.log(`\n?  TaskSync initialised successfully!`);
  console.log(`   Provider:     ${provider.getProviderName()}`);
  console.log(`   Data path:    ${dataPath}`);
  console.log(`   Workspace ID: ${manifest.workspaceId}`);
  console.log(`   Remote:       ${opts.repoUrl}\n`);
}

/**
 * Sync the provider data directory:
 *  1. pull --rebase (fetch remote changes first)
 *  2. git add (stage local changes)
 *  3. commit only if there are changes
 *  4. push
 *  5. update manifest lastSyncedAt
 *
 * PAT is resolved from TaskSync_GIT_TOKEN env var (or SSH is used).
 *
 * Throws ProviderValidationError, SyncNotInitializedError, or SyncNoRemoteError
 * on failure instead of calling process.exit().
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
      `${dataPath} is not a git repository.\n` +
      `   Run:  TaskSync init <repo-url> [--pat <token>]`
    );
  }

  if (!(await hasRemote(dataPath))) {
    throw new SyncNoRemoteError(
      `No remote configured for ${dataPath}.\n` +
      `   Run:  TaskSync init <repo-url> [--pat <token>]`
    );
  }

  // Step 1: pull --rebase FIRST (PAT passed ephemerally)
  console.log("? Pulling remote changes...");
  await withRetry("pull", () => pullRebase(dataPath, pat));

  // Step 2: stage
  await addAll(dataPath);

  // Step 3: commit only if dirty
  const committed = await commit(dataPath, "TaskSync: sync");
  if (committed) {
    console.log("? Local changes committed.");
  } else {
    console.log("? No local changes to commit.");
  }

  // Step 4: push (PAT passed ephemerally)
  console.log("? Pushing to remote...");
  await withRetry("push", () => push(dataPath, pat));

  // Step 5: update manifest
  touchLastSynced(dataPath);

  console.log(`\n?  Sync complete — ${new Date().toLocaleTimeString()}\n`);
}
