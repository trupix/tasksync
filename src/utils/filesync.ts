/**
 * filesync.ts — Copies provider data between a provider's actual data directory
 * and its subfolder inside the unified sync repo working tree.
 *
 * Two modes:
 *  - copyLocalToRepo  (local → staging) : MIRROR — makes staging an exact copy
 *    of local (adds, updates, removes). Used before committing.
 *  - copyRepoToLocal  (staging → local) : MERGE  — adds and updates files in local
 *    from staging, but does NOT delete local-only files. Used after pulling.
 */
import fs from "fs";
import path from "path";

// --- Exclusion patterns -------------------------------------------------------

const EXCLUDE_REGEXES: RegExp[] = [
  /[/\\]\.git([/\\]|$)/,                    // git metadata
  /secrets\.json$/i,
  /\.(token|auth|credentials)$/i,
  /(_secret|_token)[^/\\]*/i,
  /[/\\](cache|temp|logs)([/\\]|$)/i,
  /\.log$/i,
  /[/\\]node_modules([/\\]|$)/,
  /[/\\]puppeteer([/\\]|$)/,
  /[/\\]\.chromium-browser-snapshots([/\\]|$)/,
  /\.crdownload$/,
  /\.DS_Store$/,
  /Thumbs\.db$/i,
  /\.(sock|pid)$/,
  /\.TaskSync_manifest\.json$/,             // manifest is managed separately
];

const LARGE_FILE_WARN_BYTES = 50 * 1024 * 1024; // 50 MB

export function shouldExclude(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return EXCLUDE_REGEXES.some(r => r.test(normalized));
}

// --- Public API ---------------------------------------------------------------

/**
 * Copy local provider data dir → sync repo subfolder (mirror mode).
 * Makes the subfolder an EXACT mirror of the local dir:
 *   - Adds new files
 *   - Overwrites modified files
 *   - Removes files in dest that no longer exist in src
 *
 * Called before `git commit` to snapshot the current local state.
 */
export function copyLocalToRepo(localDataPath: string, syncSubfolderPath: string): void {
  if (!fs.existsSync(localDataPath)) return;
  fs.mkdirSync(syncSubfolderPath, { recursive: true });
  copyFilesInto(localDataPath, syncSubfolderPath);
  removeOrphans(localDataPath, syncSubfolderPath);
}

/**
 * Copy sync repo subfolder → local provider data dir (merge mode).
 * MERGES into local:
 *   - Adds new files from repo to local
 *   - Overwrites modified files in local with repo versions
 *   - Does NOT remove files that exist locally but not in the repo
 *     (preserves tasks created on this machine that haven't been pushed yet)
 *
 * Called after `git pull --rebase` to deliver remote changes to the local provider.
 */
export function copyRepoToLocal(syncSubfolderPath: string, localDataPath: string): void {
  if (!fs.existsSync(syncSubfolderPath)) return;
  fs.mkdirSync(localDataPath, { recursive: true });
  copyFilesInto(syncSubfolderPath, localDataPath);
  // Note: does NOT call removeOrphans — merge, not mirror
}

// --- Internal -----------------------------------------------------------------

/** Recursively copy all eligible files and directories from srcDir into destDir. */
function copyFilesInto(srcDir: string, destDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (shouldExclude(srcPath)) continue;

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyFilesInto(srcPath, destPath);
    } else if (entry.isFile()) {
      try {
        const srcStat = fs.statSync(srcPath);
        if (srcStat.size > LARGE_FILE_WARN_BYTES) {
          console.warn(`  \u26a0  Large file skipped from sync (${(srcStat.size / 1024 / 1024).toFixed(1)} MB): ${entry.name}`);
          continue;
        }
        // Only copy if dest is missing or source is newer/different size
        let doCopy = true;
        if (fs.existsSync(destPath)) {
          const destStat = fs.statSync(destPath);
          doCopy = srcStat.size !== destStat.size || srcStat.mtimeMs > destStat.mtimeMs;
        }
        if (doCopy) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(srcPath, destPath);
        }
      } catch {
        // Skip unreadable/locked files silently
      }
    }
  }
}

/**
 * Remove files and directories that exist in destDir but not in srcDir.
 * Used for the mirror (local → staging) direction only.
 */
function removeOrphans(srcDir: string, destDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(destDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const destPath = path.join(destDir, entry.name);
    const srcPath = path.join(srcDir, entry.name);

    if (!fs.existsSync(srcPath)) {
      try {
        if (entry.isDirectory()) {
          fs.rmSync(destPath, { recursive: true, force: true });
        } else {
          fs.rmSync(destPath, { force: true });
        }
      } catch { /* ignore */ }
    } else if (entry.isDirectory()) {
      removeOrphans(srcPath, destPath);
    }
  }
}
