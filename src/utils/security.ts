/**
 * Security utilities for TaskSync.
 *
 * - Token redaction for logs and error messages
 * - Request validation helpers for mutation routes
 * - Path traversal guards
 * - Centralized filesystem safety enforcement
 * - Dashboard auth token management
 */

import crypto from "crypto";
import path from "path";
import fs from "fs";

// --- Token redaction ----------------------------------------------------------

const TOKEN_PATTERNS = [
  // GitHub PATs: ghp_, gho_, github_pat_, ghs_, ghr_
  /ghp_[A-Za-z0-9_]{36,}/g,
  /gho_[A-Za-z0-9_]{36,}/g,
  /github_pat_[A-Za-z0-9_]{82}/g,
  /ghs_[A-Za-z0-9_]{36,}/g,
  /ghr_[A-Za-z0-9_]{36,}/g,
  // Generic bearer tokens embedded in URLs
  /\/\/[^:@]+:[A-Za-z0-9_\-\.]{10,}@/g,
  // Generic secrets: key=<value> or token=<value>
  /\b(pat|token|secret|key|password|credential)=[^\s&"']+/gi,
];

/**
 * Replace sensitive tokens in a string with redacted placeholders.
 */
export function redactTokens(s: string): string {
  let result = s;
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // For URL embedded credentials: keep the protocol/host shape
      if (match.startsWith("//") && match.includes("@")) {
        return "//[user]:[REDACTED]@";
      }
      // For key=value patterns, keep the key
      const eqIdx = match.indexOf("=");
      if (eqIdx !== -1) {
        return match.substring(0, eqIdx + 1) + "[REDACTED]";
      }
      return "[REDACTED]";
    });
  }
  return result;
}

/**
 * Redact tokens from a URL, returning a safe version for logging.
 * e.g. https://user:ghp_token@github.com/repo ? https://[user]:[REDACTED]@github.com/repo
 */
export function redactUrl(url: string): string {
  return redactTokens(url);
}

// --- Path traversal guard -----------------------------------------------------

/**
 * Ensure that resolvedPath is strictly under parentDir.
 * Returns true if safe, false if a traversal attempt is detected.
 * Normalizes paths first to catch `..` components.
 */
export function isPathSafe(parentDir: string, resolvedPath: string): boolean {
  const normalParent = path.normalize(parentDir);
  const normalResolved = path.normalize(resolvedPath);
  const withSep = normalParent.endsWith(path.sep) ? normalParent : normalParent + path.sep;
  return normalResolved.startsWith(withSep) || normalResolved === normalParent;
}

/**
 * Resolve a child path safely under a parent directory.
 * Throws if the resulting path escapes the parent (traversal attempt).
 * This is the centralized entrypoint — all filesystem mutations must use this.
 */
export function safePath(parentDir: string, childSegment: string): string {
  // Reject null bytes immediately
  if (childSegment.includes("\0")) {
    throw new PathTraversalError(`Path contains null bytes: ${childSegment}`);
  }
  // Reject backslashes (Windows path injection on Unix)
  if (childSegment.includes("\\")) {
    throw new PathTraversalError(`Path contains backslash: ${childSegment}`);
  }
  // Reject absolute paths
  if (path.isAbsolute(childSegment)) {
    throw new PathTraversalError(`Absolute path not allowed: ${childSegment}`);
  }

  const resolved = path.resolve(parentDir, childSegment);
  if (!isPathSafe(parentDir, resolved)) {
    throw new PathTraversalError(
      `Path traversal detected: "${childSegment}" escapes "${parentDir}"`
    );
  }
  return resolved;
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

/**
 * Safely read a file that must reside within parentDir.
 * Returns file contents as string, or throws on traversal / read failure.
 */
export function safeReadFile(parentDir: string, childSegment: string): string {
  const resolved = safePath(parentDir, childSegment);
  return fs.readFileSync(resolved, "utf8");
}

/**
 * Safely write content to a file that must reside within parentDir.
 * Throws on traversal attempt.
 */
export function safeWriteFile(parentDir: string, childSegment: string, content: string): void {
  const resolved = safePath(parentDir, childSegment);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolved, content, "utf8");
}

/**
 * Safely create a directory under parentDir.
 */
export function safeMkdir(parentDir: string, childSegment: string): string {
  const resolved = safePath(parentDir, childSegment);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

/**
 * Safely write a file atomically (write temp file then rename).
 */
export function safeWriteFileAtomic(parentDir: string, childSegment: string, content: string): void {
  const resolved = safePath(parentDir, childSegment);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpName = `.TaskSync-tmp-${crypto.randomUUID()}`;
  const tmpPath = path.join(dir, tmpName);
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, resolved);
}

/**
 * Safely remove a directory that must reside within parentDir.
 * Throws on traversal attempt.
 */
export function safeRmDir(parentDir: string, childSegment: string): void {
  const resolved = safePath(parentDir, childSegment);
  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

// --- Request field validators ------------------------------------------------

const VALID_PROVIDERS = ["cline", "roo", "kilo", "openclaw"];

/**
 * Validate that a provider name is one of the known providers.
 */
export function isValidProvider(provider: unknown): provider is string {
  return typeof provider === "string" && VALID_PROVIDERS.includes(provider.toLowerCase());
}

/**
 * Validate that a taskId field is a non-empty string without
 * path traversal characters.
 * Allows "/" for provider-specific formats (e.g. openclaw's "agentId/sessionId").
 */
export function isValidId(id: unknown): id is string {
  if (typeof id !== "string" || id.trim() === "") return false;
  // No null bytes, backslashes, or ".." traversal sequences
  if (id.includes("..") || id.includes("\\") || id.includes("\0")) return false;
  return true;
}

/**
 * Validate a runId (UUID format or simple hex string).
 */
export function isValidRunId(id: unknown): id is string {
  if (typeof id !== "string" || id.trim() === "") return false;
  // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

/**
 * Validate a root ID: alphanumeric + hyphens/underscores only.
 */
export function isValidRootId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_\-]+$/.test(id) && id.length > 0 && id.length <= 64;
}

/**
 * Validate a positive integer (for pagination limits, etc.).
 */
export function isPositiveInt(val: unknown): val is number {
  if (typeof val === "number") return Number.isInteger(val) && val > 0;
  if (typeof val === "string") {
    const n = parseInt(val, 10);
    return !isNaN(n) && n > 0 && String(n) === val;
  }
  return false;
}

/**
 * Parse and clamp a limit parameter for pagination.
 * Returns a safe integer between 1 and maxLimit.
 */
export function clampLimit(raw: unknown, defaultLimit: number, maxLimit: number): number {
  if (raw === undefined || raw === null || raw === "") return defaultLimit;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (isNaN(n) || n < 1) return defaultLimit;
  return Math.min(n, maxLimit);
}

// --- Dashboard auth token -----------------------------------------------------

/**
 * Generate or retrieve the dashboard auth token.
 * - If TaskSync_DASHBOARD_TOKEN env var is set, use that.
 * - Otherwise generate a random 32-byte hex token.
 *
 * The token is generated once per process lifetime.
 */
let _dashboardToken: string | null = null;

export function getDashboardToken(): string {
  if (_dashboardToken) return _dashboardToken;
  _dashboardToken = process.env.TaskSync_DASHBOARD_TOKEN || crypto.randomBytes(32).toString("hex");
  return _dashboardToken;
}

/**
 * Verify that a request carries a valid dashboard auth token.
 * Checks the x-TaskSync-token header.
 */
export function verifyDashboardToken(headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  const expected = getDashboardToken();
  // Constant-time comparison to prevent timing attacks
  if (headerValue.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
}
