import { execFile, ExecFileOptions } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Validate a git remote URL before use.
 * Allows https://, git://, git@host:..., and ssh:// schemes.
 * Rejects anything else (e.g. file://, shell metacharacters, newlines).
 */
export function validateRemoteUrl(url: string): void {
  if (typeof url !== "string" || url.trim() === "") {
    throw new GitError("Remote URL must be a non-empty string");
  }
  // Reject control characters, newlines, null bytes
  if (/[\x00-\x1f]/.test(url)) {
    throw new GitError("Remote URL contains invalid control characters");
  }
  // Reject shell metacharacters that should never appear in a URL
  if (/[;|&`$(){}!#]/.test(url)) {
    throw new GitError("Remote URL contains disallowed characters");
  }

  const isHttps = /^https?:\/\/.+/.test(url);
  const isSsh = /^git@[^:]+:.+/.test(url) || /^ssh:\/\/.+/.test(url);
  const isGitProto = /^git:\/\/.+/.test(url);

  if (!isHttps && !isSsh && !isGitProto) {
    throw new GitError(
      `Unsupported remote URL scheme: ${url}\n` +
      `  Supported: https://, git@host:path, ssh://, git://`
    );
  }
}

/**
 * Run a git command inside `cwd`. All arguments are passed as an array
 * to execFile — no shell is involved, eliminating injection risk.
 *
 * Throws a cleaned-up GitError on non-zero exit code.
 */
async function git(args: string[], cwd: string): Promise<GitExecResult> {
  try {
    const opts: ExecFileOptions = { cwd, env: { ...process.env }, encoding: "utf8" as const };
    const result = await execFileAsync("git", args, opts);
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (e: any) {
    const message = (e.stderr || e.stdout || e.message || String(e)).trim();
    throw new GitError(message);
  }
}

/**
 * Run a git command with custom environment variables merged in.
 * Used for ephemeral credential passing via GIT_ASKPASS.
 */
async function gitWithEnv(
  args: string[],
  cwd: string,
  env: Record<string, string>
): Promise<GitExecResult> {
  try {
    const opts: ExecFileOptions = {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8" as const,
    };
    const result = await execFileAsync("git", args, opts);
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (e: any) {
    const message = (e.stderr || e.stdout || e.message || String(e)).trim();
    throw new GitError(message);
  }
}

/** Typed git error — never carries a stack trace when printed. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
    this.stack = undefined;
  }
}

// --- Ephemeral credential helpers --------------------------------------------

import fs from "fs";
import path from "path";
import os from "os";

/**
 * Build environment variables that supply a PAT ephemerally to a single
 * git command via GIT_ASKPASS. No credential is written to disk or git config.
 *
 * Returns env vars to merge into the child process environment, and a
 * cleanup function to remove the temporary helper script.
 */
export function buildEphemeralCredentialEnv(pat: string): {
  env: Record<string, string>;
  cleanup: () => void;
} {
  // Create a tiny script that echoes the token (GIT_ASKPASS protocol)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "TaskSync-cred-"));
  const scriptPath = path.join(tmpDir, "askpass.sh");

  // The script simply prints the PAT — git calls it and reads stdout
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho "${pat.replace(/"/g, '\\"')}"\n`, {
    mode: 0o700,
    encoding: "utf8",
  });

  return {
    env: {
      GIT_ASKPASS: scriptPath,
      GIT_TERMINAL_PROMPT: "0",
    },
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

// --- Repository state -------------------------------------------------------

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function hasRemote(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await git(["remote"], cwd);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await git(["config", "remote.origin.url"], cwd);
    return sanitizeRemoteUrl(stdout.trim());
  } catch {
    return null;
  }
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await git(["status", "--porcelain"], cwd);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Returns list of files with merge conflicts. */
export async function getConflictedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await git(
      ["diff", "--name-only", "--diff-filter=U"],
      cwd
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// --- Repository operations ---------------------------------------------------

export async function initRepo(cwd: string): Promise<void> {
  await git(["init"], cwd);
  await git(["branch", "-M", "main"], cwd);
}

export async function setRemote(cwd: string, url: string): Promise<void> {
  validateRemoteUrl(url);
  // Remove existing origin (ignore error if it doesn't exist)
  try {
    await git(["remote", "remove", "origin"], cwd);
  } catch {
    /* ok */
  }
  await git(["remote", "add", "origin", url], cwd);
}

/**
 * Stage all changes, skip files larger than `maxMb` MB with a warning.
 */
export async function addAll(cwd: string, maxMb = 50): Promise<void> {
  await warnOversizedFiles(cwd, maxMb);
  await git(["add", "."], cwd);
}

export async function commit(
  cwd: string,
  message: string
): Promise<boolean> {
  try {
    await git(["commit", "-m", message], cwd);
    return true;
  } catch (e: any) {
    if (e.message.includes("nothing to commit")) return false;
    throw e;
  }
}

/**
 * Pull with rebase. If a PAT is needed, pass it and it will be supplied
 * ephemerally via GIT_ASKPASS — never written to disk.
 */
export async function pullRebase(
  cwd: string,
  pat?: string
): Promise<void> {
  try {
    if (pat) {
      const cred = buildEphemeralCredentialEnv(pat);
      try {
        await gitWithEnv(
          ["pull", "origin", "main", "--rebase"],
          cwd,
          cred.env
        );
      } finally {
        cred.cleanup();
      }
    } else {
      await git(["pull", "origin", "main", "--rebase"], cwd);
    }
  } catch (e: any) {
    const conflicts = await getConflictedFiles(cwd);
    if (conflicts.length > 0) {
      throw new GitError(
        `Merge conflict detected in ${conflicts.length} file(s):\n` +
          conflicts.map((f) => `  ${f}`).join("\n") +
          "\n\n" +
          `To resolve:\n` +
          `  1. Open the conflicted files listed above and resolve the markers.\n` +
          `  2. Run:  cd "${cwd}" && git add . && git rebase --continue\n` +
          `  3. Then run:  TaskSync sync\n`
      );
    }
    if (
      e.message.includes("Authentication") ||
      e.message.includes("403") ||
      e.message.includes("401")
    ) {
      throw new GitError(
        `Authentication failed when pulling from remote.\n` +
          `  • If using HTTPS, pass --pat <token> or set TaskSync_GIT_TOKEN.\n` +
          `  • If using SSH, ensure your key is loaded in ssh-agent.\n`
      );
    }
    throw e;
  }
}

/**
 * Push to remote. If a PAT is needed, pass it and it will be supplied
 * ephemerally via GIT_ASKPASS — never written to disk.
 */
export async function push(cwd: string, pat?: string): Promise<void> {
  try {
    if (pat) {
      const cred = buildEphemeralCredentialEnv(pat);
      try {
        await gitWithEnv(
          ["push", "-u", "origin", "main"],
          cwd,
          cred.env
        );
      } finally {
        cred.cleanup();
      }
    } else {
      await git(["push", "-u", "origin", "main"], cwd);
    }
  } catch (e: any) {
    if (
      e.message.includes("Authentication") ||
      e.message.includes("403") ||
      e.message.includes("401")
    ) {
      throw new GitError(
        `Authentication failed when pushing to remote.\n` +
          `  • If using HTTPS, pass --pat <token> or set TaskSync_GIT_TOKEN.\n` +
          `  • If using SSH, ensure your key is loaded in ssh-agent.\n`
      );
    }
    if (e.message.includes("rejected")) {
      throw new GitError(
        `Push rejected by remote. Your local branch is behind.\n` +
          `  Run: TaskSync sync  (this will pull --rebase then push again)\n`
      );
    }
    throw e;
  }
}

// --- Helpers -----------------------------------------------------------------

/**
 * Remove embedded credentials from a remote URL (for display purposes).
 */
export function sanitizeRemoteUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return url;
  }
}

/** Scan tracked + untracked files and warn about anything exceeding `maxMb`. */
async function warnOversizedFiles(cwd: string, maxMb: number): Promise<void> {
  try {
    // Use execFile with find — no shell, args as array
    const { stdout } = await execFileAsync("find", [
      ".",
      "-not",
      "-path",
      "./.git/*",
      "-type",
      "f",
      "-size",
      `+${maxMb}M`,
    ], { cwd });
    const files = (stdout ?? "").trim().split("\n").filter(Boolean);
    if (files.length > 0) {
      console.warn(
        `\n?  The following files exceed ${maxMb} MB and will be skipped:\n` +
          files.map((f) => `   ${f}`).join("\n") +
          "\n" +
          `   Add them to .gitignore inside ${cwd} to silence this warning.\n`
      );
    }
  } catch {
    // find not available / permission issue — skip silently.
  }
}
