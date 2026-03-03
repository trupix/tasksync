/**
 * Git injection regression tests.
 * Verifies that command injection payloads cannot execute via git wrapper.
 */
import assert from "assert";
import { validateRemoteUrl, GitError } from "../git";

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

// ─── URL validation ─────────────────────────────────────────────────────────

test("validateRemoteUrl: accepts valid HTTPS URL", () => {
  assert.doesNotThrow(() => validateRemoteUrl("https://github.com/user/repo.git"));
});

test("validateRemoteUrl: accepts valid SSH URL", () => {
  assert.doesNotThrow(() => validateRemoteUrl("git@github.com:user/repo.git"));
});

test("validateRemoteUrl: accepts ssh:// scheme", () => {
  assert.doesNotThrow(() => validateRemoteUrl("ssh://git@github.com/user/repo.git"));
});

test("validateRemoteUrl: rejects empty string", () => {
  assert.throws(() => validateRemoteUrl(""), GitError);
});

test("validateRemoteUrl: rejects shell injection via semicolon", () => {
  assert.throws(() => validateRemoteUrl("https://github.com/repo.git; rm -rf /"), GitError);
});

test("validateRemoteUrl: rejects shell injection via pipe", () => {
  assert.throws(() => validateRemoteUrl("https://github.com/repo.git | cat /etc/passwd"), GitError);
});

test("validateRemoteUrl: rejects shell injection via backtick", () => {
  assert.throws(() => validateRemoteUrl("https://github.com/`whoami`.git"), GitError);
});

test("validateRemoteUrl: rejects shell injection via $(...)", () => {
  assert.throws(() => validateRemoteUrl("https://github.com/$(whoami).git"), GitError);
});

test("validateRemoteUrl: rejects newline injection", () => {
  assert.throws(() => validateRemoteUrl("https://github.com/repo.git\nmalicious"), GitError);
});

test("validateRemoteUrl: rejects null byte injection", () => {
  assert.throws(() => validateRemoteUrl("https://github.com/repo.git\0malicious"), GitError);
});

test("validateRemoteUrl: rejects file:// scheme", () => {
  assert.throws(() => validateRemoteUrl("file:///etc/passwd"), GitError);
});

test("validateRemoteUrl: rejects unsupported scheme", () => {
  assert.throws(() => validateRemoteUrl("ftp://github.com/repo.git"), GitError);
});

test("validateRemoteUrl: rejects ampersand injection", () => {
  assert.throws(() => validateRemoteUrl("https://github.com/repo.git && echo pwned"), GitError);
});

runAll();
