/**
 * Migration roundtrip test: exportTaskBundle → importTaskBundle
 *
 * Tests the provider-native file-copy migration path end-to-end using
 * temporary directory fixtures. No canonical layer involved.
 *
 * Run with: npx tsx src/core/tasks/__tests__/migration.test.ts
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportTaskBundle, importTaskBundle } from "../migration";
import { IProvider, ProviderRoot } from "../../../providers/interface";

// ── Minimal provider mocks ────────────────────────────────────────────────────

function makeProvider(name: string): IProvider {
  return {
    getProviderName: () => name,
    getRoots: () => [],
    validateRoot: () => true,
    getTasks: () => [],
  } as unknown as IProvider;
}

function makeRoot(rootPath: string): ProviderRoot {
  return {
    id: "test-root",
    label: "Test Root",
    path: rootPath,
  };
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

function createClineTaskFixture(rootPath: string, taskId: string): void {
  const taskDir = path.join(rootPath, "tasks", taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  // Minimal ui_messages.json (Cline/Roo share this format)
  fs.writeFileSync(
    path.join(taskDir, "ui_messages.json"),
    JSON.stringify([
      { type: "say", say: "task", text: "Hello test task", ts: Date.now() },
    ]),
    "utf8"
  );

  // Minimal api_conversation_history.json
  fs.writeFileSync(
    path.join(taskDir, "api_conversation_history.json"),
    JSON.stringify([
      { role: "user", content: [{ type: "text", text: "Hello test task" }] },
    ]),
    "utf8"
  );

  // Cline-specific file that should be skipped in cross-provider migration
  fs.writeFileSync(
    path.join(taskDir, "task_metadata.json"),
    JSON.stringify({ taskId, createdAt: Date.now() }),
    "utf8"
  );
}

function createRooRoot(rootPath: string): void {
  const tasksDir = path.join(rootPath, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  // Empty initial _index.json
  fs.writeFileSync(
    path.join(tasksDir, "_index.json"),
    JSON.stringify({ version: 1, updatedAt: Date.now(), entries: [] }),
    "utf8"
  );
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(
    () => { console.log(`  ✓ ${name}`); passed++; },
    (err) => { console.error(`  ✗ ${name}\n    ${err?.message ?? err}`); failed++; }
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nmigration.test.ts — provider-native bundle roundtrip\n");

  // Create isolated temp directories per test run
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasksync-migration-test-"));
  const clineRootPath = path.join(tmpRoot, "cline-root");
  const rooRootPath = path.join(tmpRoot, "roo-root");
  const sourceTaskId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  createClineTaskFixture(clineRootPath, sourceTaskId);
  createRooRoot(rooRootPath);

  const clineProvider = makeProvider("cline");
  const clineRoot = makeRoot(clineRootPath);

  const rooProvider = makeProvider("roo");
  const rooRoot = makeRoot(rooRootPath);

  let bundleDir = "";
  let newTaskId = "";

  await test("exportTaskBundle creates a bundle directory with bundle.json", async () => {
    bundleDir = await exportTaskBundle(clineProvider, clineRoot, sourceTaskId, "Test Task Title");
    assert.ok(fs.existsSync(bundleDir), "bundle directory should exist");
    const meta = JSON.parse(fs.readFileSync(path.join(bundleDir, "bundle.json"), "utf8"));
    assert.strictEqual(meta.bundleVersion, 1);
    assert.strictEqual(meta.from.provider, "cline");
    assert.strictEqual(meta.from.taskId, sourceTaskId);
    assert.strictEqual(meta.title, "Test Task Title");
  });

  await test("exportTaskBundle includes ui_messages.json in filesIncluded", async () => {
    const meta = JSON.parse(fs.readFileSync(path.join(bundleDir, "bundle.json"), "utf8"));
    assert.ok(
      meta.filesIncluded.includes("ui_messages.json"),
      "filesIncluded should contain ui_messages.json"
    );
  });

  await test("importTaskBundle returns a new UUID task ID", async () => {
    newTaskId = await importTaskBundle(rooProvider, rooRoot, bundleDir);
    assert.ok(newTaskId.length > 0, "newTaskId should be non-empty");
    // Should be UUID format
    assert.match(
      newTaskId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "newTaskId should be UUID format"
    );
  });

  await test("Roo _index.json entry exists with required fields", async () => {
    const indexPath = path.join(rooRootPath, "tasks", "_index.json");
    assert.ok(fs.existsSync(indexPath), "_index.json should exist");
    const idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.ok(Array.isArray(idx.entries), "entries should be an array");
    assert.ok(idx.entries.length > 0, "entries should have at least one entry");

    const entry = idx.entries.find((e: any) => e.id === newTaskId);
    assert.ok(entry, `entry with id ${newTaskId} should exist in _index.json`);
    assert.ok(typeof entry.id === "string", "entry.id should be a string");
    assert.ok(typeof entry.number === "number", "entry.number should be a number");
    assert.ok(typeof entry.task === "string", "entry.task should be a string");
    assert.ok(typeof entry.ts === "number", "entry.ts should be a number");
    assert.ok(typeof entry.workspace === "string", "entry.workspace should be a string");
  });

  await test("history_item.json exists inside the new task folder", async () => {
    const historyItemPath = path.join(rooRootPath, "tasks", newTaskId, "history_item.json");
    assert.ok(fs.existsSync(historyItemPath), "history_item.json should exist");
    const hi = JSON.parse(fs.readFileSync(historyItemPath, "utf8"));
    assert.strictEqual(hi.id, newTaskId, "history_item.json id should match newTaskId");
  });

  await test("ui_messages.json was copied to the new task folder", async () => {
    const uiMessagesPath = path.join(rooRootPath, "tasks", newTaskId, "ui_messages.json");
    assert.ok(fs.existsSync(uiMessagesPath), "ui_messages.json should be copied");
    const msgs = JSON.parse(fs.readFileSync(uiMessagesPath, "utf8"));
    assert.ok(Array.isArray(msgs), "ui_messages.json should be a JSON array");
    assert.ok(msgs.length > 0, "ui_messages.json should have at least one message");
  });

  await test("Cline-specific task_metadata.json is NOT copied (cross-provider skip)", async () => {
    const skippedPath = path.join(rooRootPath, "tasks", newTaskId, "task_metadata.json");
    assert.ok(
      !fs.existsSync(skippedPath),
      "task_metadata.json (Cline-specific) should NOT be copied to Roo"
    );
  });

  await test("provenance file is written with correct source info", async () => {
    const provPath = path.join(rooRootPath, "tasks", newTaskId, ".TaskSync_provenance.json");
    assert.ok(fs.existsSync(provPath), ".TaskSync_provenance.json should exist");
    const prov = JSON.parse(fs.readFileSync(provPath, "utf8"));
    assert.strictEqual(prov.importedFrom.provider, "cline");
    assert.strictEqual(prov.importedFrom.taskId, sourceTaskId);
    assert.ok(typeof prov.importedAt === "string", "importedAt should be a string");
  });

  // Cleanup
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log();
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log();

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("Unexpected test error:", err);
  process.exit(1);
});
