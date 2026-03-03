import assert from "assert";
import { redactTokens, redactUrl, isValidProvider, isValidId, isValidRunId, isValidRootId, isPathSafe, safePath, PathTraversalError, clampLimit, getDashboardToken, verifyDashboardToken } from "../security";

let passed = 0;
let failed = 0;
const queue: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  queue.push({ name, fn });
}

async function runAll(): Promise<void> {
  for (const item of queue) {
    try {
      item.fn();
      console.log(`  ✓ ${item.name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${item.name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

test("redactTokens: redacts GitHub PAT in URL", () => {
  const url = "https://myuser:ghp_ABC1234567890123456789012345678901234@github.com/repo.git";
  const result = redactTokens(url);
  assert.ok(!result.includes("ghp_"), "Token should be redacted");
  assert.ok(result.includes("[REDACTED]"));
});

test("redactTokens: redacts token=value pattern", () => {
  const s = "failed to push: token=ghp_supersecrettoken123";
  const result = redactTokens(s);
  assert.ok(!result.includes("ghp_supersecrettoken123"));
  assert.ok(result.includes("token=[REDACTED]"));
});

test("redactTokens: does not modify clean strings", () => {
  const clean = "Push succeeded to https://github.com/user/repo.git";
  const result = redactTokens(clean);
  assert.strictEqual(result, clean);
});

test("redactUrl: redacts embedded credentials in URL", () => {
  const url = "https://x-oauth:ghp_longtokenvalue1234567890123456789@github.com/org/repo.git";
  const result = redactUrl(url);
  assert.ok(!result.includes("ghp_"), "GitHub PAT should be redacted");
});

test("isValidProvider: accepts known providers", () => {
  assert.ok(isValidProvider("cline"));
  assert.ok(isValidProvider("roo"));
  assert.ok(isValidProvider("kilo"));
  assert.ok(isValidProvider("openclaw"));
});

test("isValidProvider: rejects unknown providers", () => {
  assert.ok(!isValidProvider("cursor"));
  assert.ok(!isValidProvider(""));
  assert.ok(!isValidProvider(null));
  assert.ok(!isValidProvider(42));
});

test("isValidId: accepts normal task IDs", () => {
  assert.ok(isValidId("abc123"));
  assert.ok(isValidId("00000000-0000-0000-0000-000000000001"));
  assert.ok(isValidId("main/session123"));  // openclaw format
});

test("isValidId: rejects traversal attempts", () => {
  assert.ok(!isValidId("../../../etc/passwd"));
  assert.ok(!isValidId(".."));
  assert.ok(!isValidId(""));
  assert.ok(!isValidId("\0malicious"));
});

test("isValidRunId: accepts valid UUID", () => {
  assert.ok(isValidRunId("550e8400-e29b-41d4-a716-446655440000"));
});

test("isValidRunId: rejects malformed IDs", () => {
  assert.ok(!isValidRunId("not-a-uuid"));
  assert.ok(!isValidRunId(""));
  assert.ok(!isValidRunId("../etc/passwd"));
});

test("isValidRootId: accepts normal root IDs", () => {
  assert.ok(isValidRootId("vscode-local"));
  assert.ok(isValidRootId("env-override"));
  assert.ok(isValidRootId("vscode_server"));
});

test("isValidRootId: rejects invalid root IDs", () => {
  assert.ok(!isValidRootId("../bad"));
  assert.ok(!isValidRootId(""));
  assert.ok(!isValidRootId("a".repeat(65)));
});

test("isPathSafe: accepts path within parent", () => {
  assert.ok(isPathSafe("/home/user/data/tasks", "/home/user/data/tasks/abc123"));
});

test("isPathSafe: rejects traversal escape", () => {
  assert.ok(!isPathSafe("/home/user/data/tasks", "/home/user/data/other"));
  assert.ok(!isPathSafe("/home/user/data/tasks", "/home/user/data/tasks/../secrets"));
});

// ─── safePath tests ──────────────────────────────────────────────────────────

test("safePath: resolves valid child path", () => {
  const result = safePath("/home/user/data", "tasks/abc123");
  assert.ok(result.startsWith("/home/user/data/"));
  assert.ok(result.includes("abc123"));
});

test("safePath: throws on traversal attempt (../)", () => {
  assert.throws(() => safePath("/home/user/data", "../../../etc/passwd"), PathTraversalError);
});

test("safePath: throws on absolute path injection", () => {
  assert.throws(() => safePath("/home/user/data", "/etc/passwd"), PathTraversalError);
});

test("safePath: throws on null byte injection", () => {
  assert.throws(() => safePath("/home/user/data", "tasks\0/malicious"), PathTraversalError);
});

test("safePath: throws on backslash injection", () => {
  assert.throws(() => safePath("/home/user/data", "tasks\\..\\secrets"), PathTraversalError);
});

test("safePath: allows normal nested paths", () => {
  const result = safePath("/data", "tasks/subtask/file.json");
  assert.ok(result.startsWith("/data/"));
});

// ─── clampLimit tests ────────────────────────────────────────────────────────

test("clampLimit: returns default for undefined", () => {
  assert.strictEqual(clampLimit(undefined, 100, 500), 100);
});

test("clampLimit: returns clamped value", () => {
  assert.strictEqual(clampLimit("50", 100, 500), 50);
  assert.strictEqual(clampLimit("999", 100, 500), 500);
  assert.strictEqual(clampLimit("0", 100, 500), 100);
  assert.strictEqual(clampLimit("-5", 100, 500), 100);
});

// ─── Dashboard auth token tests ──────────────────────────────────────────────

test("getDashboardToken: returns consistent token", () => {
  const t1 = getDashboardToken();
  const t2 = getDashboardToken();
  assert.strictEqual(t1, t2, "Token should be stable within process");
  assert.ok(t1.length >= 32, "Token should be at least 32 chars");
});

test("verifyDashboardToken: accepts valid token", () => {
  const token = getDashboardToken();
  assert.ok(verifyDashboardToken(token));
});

test("verifyDashboardToken: rejects invalid token", () => {
  assert.ok(!verifyDashboardToken("wrong-token"));
  assert.ok(!verifyDashboardToken(undefined));
  assert.ok(!verifyDashboardToken(""));
});

runAll();
