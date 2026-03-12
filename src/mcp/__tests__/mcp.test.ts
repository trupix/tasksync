import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createProgram } from "../../cli";
import { TaskContextError, TaskContextService } from "../../core/tasks/context";
import { IProvider, ProviderRoot } from "../../providers/interface";
import { createTaskSyncMcpServer, TaskSyncMcpAdapter } from "../server";
import { getCapturedTasksDir, listCapturedTasks } from "../../core/tasks/captured";
import { CapturedProvider } from "../../providers/captured";

function makeProvider(name: string, rootPath: string): IProvider {
  const root: ProviderRoot = {
    id: "test-root",
    label: "Test Root",
    path: rootPath,
  };

  return {
    getProviderName: () => name,
    getRoots: () => [root],
    validateRoot: () => true,
    getSchemaVersion: () => 1,
  };
}

function createClineFixture(rootPath: string, taskId: string): void {
  const taskDir = path.join(rootPath, "tasks", taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  fs.writeFileSync(
    path.join(taskDir, "ui_messages.json"),
    JSON.stringify([
      { type: "say", say: "task", text: "Investigate MCP integration for TaskSync", ts: Date.now() - 1000 },
      { type: "say", say: "text", text: "Implemented read-only MCP server scaffolding.", ts: Date.now() },
    ]),
    "utf8"
  );

  fs.writeFileSync(
    path.join(taskDir, "api_conversation_history.json"),
    JSON.stringify([
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Current Working Directory (C:/Users/trupi/Projects/tasksync)\n# Workspace Configuration\n{\"workspaces\":{\"C:/Users/trupi/Projects/tasksync\":{\"hint\":\"tasksync\",\"associatedRemoteUrls\":[\"origin: git@github.com:trupix/tasksync.git\"]}}}\nRequirements: add a read-only MCP server and list high-value tools.",
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Decision: implement stdio transport first and keep provider parsing inside TaskSync core.",
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "TODO: add tests for list_tasks, get_task_summary, and rehydrate_task.",
          },
        ],
      },
    ]),
    "utf8"
  );
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(
    () => {
      console.log(`  ✓ ${name}`);
      passed++;
    },
    (err) => {
      console.error(`  ✗ ${name}\n    ${err?.message ?? err}`);
      failed++;
    }
  );
}

async function main() {
  console.log("\nmcp.test.ts — TaskSync MCP adapter, CLI boot, and capture_context\n");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasksync-mcp-test-"));
  const taskId = "1772813600465";
  createClineFixture(tmpRoot, taskId);

  const provider = makeProvider("cline", tmpRoot);
  const taskService = new TaskContextService([provider, new CapturedProvider()]);
  const adapter = new TaskSyncMcpAdapter(taskService);

  // -------------------------------------------------------------------------
  // Existing v1 tests (must not regress)
  // -------------------------------------------------------------------------

  await test("tasksync mcp command bootstraps successfully", async () => {
    let started = false;
    const program = createProgram({
      startMcpServer: async () => {
        started = true;
      },
    });

    await program.parseAsync(["node", "tasksync", "mcp"]);
    assert.strictEqual(started, true, "mcp command should invoke the injected MCP starter");
  });

  await test("MCP tool registration exposes all expected tools including capture_context", async () => {
    const { adapter: registeredAdapter } = createTaskSyncMcpServer(adapter);
    assert.deepStrictEqual(registeredAdapter.getToolDefinitions().map((tool) => tool.name), [
      "list_tasks",
      "search_tasks",
      "get_task_summary",
      "get_task_transcript",
      "get_workspace_context",
      "rehydrate_task",
      "capture_context",
    ]);
  });

  await test("capture_context tool has readOnly: false annotation", () => {
    const captureTool = adapter.getToolDefinitions().find((t) => t.name === "capture_context");
    assert.ok(captureTool, "capture_context tool should be defined");
    assert.strictEqual(captureTool.readOnly, false, "capture_context should have readOnly: false");
  });

  await test("list_tasks returns normalized results from fixture data", async () => {
    const result = await adapter.callTool("list_tasks", { provider: "cline" });
    assert.ok(Array.isArray(result), "list_tasks should return an array");
    assert.strictEqual(result.length, 1);
    assert.strictEqual((result[0] as any).provider, "cline");
    assert.strictEqual((result[0] as any).rootId, "test-root");
    assert.strictEqual((result[0] as any).workspaceLabel, "tasksync");
  });

  await test("get_task_summary derives a deterministic summary for the fixture task", async () => {
    const summary = await adapter.callTool("get_task_summary", {
      provider: "cline",
      rootId: "test-root",
      taskId,
    });

    assert.ok(typeof (summary as any).summary === "string");
    assert.match((summary as any).summary, /Task: Investigate MCP integration for TaskSync/);
    assert.match((summary as any).summary, /Repository: trupix\/tasksync/);
  });

  await test("rehydrate_task returns a structured continuation packet", async () => {
    const packet = await adapter.callTool("rehydrate_task", {
      provider: "cline",
      rootId: "test-root",
      taskId,
      mode: "requirements_and_todos",
    });

    assert.strictEqual((packet as any).packetType, "tasksync.rehydration");
    assert.strictEqual((packet as any).version, 1);
    assert.strictEqual((packet as any).mode, "requirements_and_todos");
    assert.ok(Array.isArray((packet as any).highlights));
    assert.match((packet as any).continuationPrompt, /resume execution/i);
  });

  await test("missing provider or task identifiers return explicit validation errors", async () => {
    await assert.rejects(
      adapter.callTool("get_task_summary", {
        provider: "cline",
      }),
      (error: any) => error instanceof TaskContextError && error.code === "INVALID_ARGUMENT"
    );
  });

  // -------------------------------------------------------------------------
  // capture_context tests
  // -------------------------------------------------------------------------

  // Track task IDs written during tests so we can clean up
  const capturedTaskIds: string[] = [];

  await test("capture_context creates a task and returns a stable reference", async () => {
    const result = await adapter.callTool("capture_context", {
      title: "Test capture: MCP v2 context hub design",
      summary: "Designing the capture_context MCP tool to make TaskSync a bi-directional context hub.",
      workspacePath: "/Users/test/projects/tasksync",
      decisions: ["Store captured tasks in ~/.TaskSync/captured/", "Use 'captured' as provider name"],
      todos: ["Add sync support for captured tasks", "Add search integration"],
      sourceApp: "test-suite",
    }) as any;

    assert.strictEqual(result.provider, "captured");
    assert.strictEqual(result.rootId, "local");
    assert.ok(typeof result.taskId === "string" && result.taskId.startsWith("cap_"));
    assert.strictEqual(result.status, "created");
    assert.ok(typeof result.capturedAt === "string");

    capturedTaskIds.push(result.taskId);
  });

  await test("capture_context requires non-empty title", async () => {
    await assert.rejects(
      adapter.callTool("capture_context", {
        title: "",
        summary: "Some summary",
      }),
      (error: any) => error instanceof TaskContextError && error.code === "INVALID_ARGUMENT"
    );
  });

  await test("capture_context requires non-empty summary", async () => {
    await assert.rejects(
      adapter.callTool("capture_context", {
        title: "A title",
        summary: "",
      }),
      (error: any) => error instanceof TaskContextError && error.code === "INVALID_ARGUMENT"
    );
  });

  await test("captured tasks appear in list_tasks results", async () => {
    // Capture a task directly via the service (not the full provider registry)
    const captureResult = await adapter.callTool("capture_context", {
      title: "Refactor auth module for multi-tenant support",
      summary: "Auth module needs to support multiple orgs.",
      workspacePath: "/Users/test/projects/myapp",
      sourceApp: "cursor",
    }) as any;

    capturedTaskIds.push(captureResult.taskId);

    // list_tasks for captured provider should include it
    const allTasks = await adapter.callTool("list_tasks", { provider: "captured" }) as any[];
    const found = allTasks.find((t: any) => t.taskId === captureResult.taskId);

    assert.ok(found, "captured task should appear in list_tasks results");
    assert.strictEqual(found.provider, "captured");
    assert.strictEqual(found.title, "Refactor auth module for multi-tenant support");
    assert.strictEqual(found.status, "captured");
  });

  await test("captured task can be retrieved via get_task_summary", async () => {
    const captureResult = await adapter.callTool("capture_context", {
      title: "Implement WebSocket streaming for real-time updates",
      summary: "Replace polling with WebSocket connections. Current latency is 2s, target <100ms.",
      decisions: ["Use Socket.io for compatibility", "Fall back to SSE for Safari"],
      todos: ["Add reconnection logic", "Handle auth token refresh"],
    }) as any;

    capturedTaskIds.push(captureResult.taskId);

    const summary = await adapter.callTool("get_task_summary", {
      provider: "captured",
      rootId: "local",
      taskId: captureResult.taskId,
    }) as any;

    assert.ok(typeof summary.summary === "string");
    assert.match(summary.summary, /Implement WebSocket streaming/);
  });

  await test("captured task can be rehydrated", async () => {
    const captureResult = await adapter.callTool("capture_context", {
      title: "Database migration to PostgreSQL",
      summary: "Migrating from SQLite to PostgreSQL for production scale.",
      workspacePath: "/Users/test/projects/backend",
      decisions: ["Use pg library", "Add connection pooling"],
      todos: ["Write migration scripts", "Update deployment docs"],
    }) as any;

    capturedTaskIds.push(captureResult.taskId);

    const packet = await adapter.callTool("rehydrate_task", {
      provider: "captured",
      rootId: "local",
      taskId: captureResult.taskId,
      mode: "summary",
    }) as any;

    assert.strictEqual(packet.packetType, "tasksync.rehydration");
    assert.strictEqual(packet.task.provider, "captured");
    assert.ok(packet.continuationPrompt.includes("Database migration to PostgreSQL"));
  });

  await test("captured task appears in search_tasks results", async () => {
    const captureResult = await adapter.callTool("capture_context", {
      title: "Optimize Elasticsearch indexing pipeline",
      summary: "Reduce index lag from 30s to under 5s.",
      sourceApp: "claude-desktop",
    }) as any;

    capturedTaskIds.push(captureResult.taskId);

    const searchResult = await adapter.callTool("search_tasks", {
      query: "Elasticsearch indexing",
    }) as any;

    const found = searchResult.results?.find((r: any) => r.taskId === captureResult.taskId);
    assert.ok(found, "captured task should appear in search_tasks results");
  });

  // -------------------------------------------------------------------------
  // CLI integration: mcp print-config and mcp doctor
  // -------------------------------------------------------------------------

  await test("tasksync mcp print-config outputs a usable config snippet", () => {
    const output = execFileSync(process.execPath, ["build/cli.js", "mcp", "print-config"], {
      cwd: path.resolve(__dirname, "..", "..", ".."),
    }).toString();

    assert.ok(output.includes("mcpServers"), "print-config should include mcpServers key");
    assert.ok(output.includes("tasksync"), "print-config should include tasksync entry");
  });

  await test("tasksync mcp doctor produces actionable output", () => {
    const output = execFileSync(process.execPath, ["build/cli.js", "mcp", "doctor"], {
      cwd: path.resolve(__dirname, "..", "..", ".."),
    }).toString();

    assert.ok(output.includes("TaskSync CLI"), "doctor should include CLI section");
    assert.ok(output.includes("MCP client setup"), "doctor should include MCP client section");
    assert.ok(output.includes("Captured context store"), "doctor should include captured store section");
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  // Remove any captured tasks written during tests
  const capturedDir = getCapturedTasksDir();
  for (const id of capturedTaskIds) {
    const taskDir = path.join(capturedDir, id);
    try {
      fs.rmSync(taskDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup failure
  }

  console.log();
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log();

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Unexpected test error:", error);
  process.exit(1);
});
