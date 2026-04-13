import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { TaskSync_VERSION } from "../utils/manifest";
import {
  RehydrateMode,
  TaskContextError,
  TaskContextService,
} from "../core/tasks/context";
import type { CaptureInput } from "../core/tasks/captured";

interface McpToolDefinition {
  name: string;
  description: string;
  readOnly?: boolean;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export class TaskSyncMcpAdapter {
  constructor(private readonly taskService = new TaskContextService()) {}

  getToolDefinitions(): McpToolDefinition[] {
    return TASKSYNC_MCP_TOOLS;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "list_tasks":
        return this.taskService.listTasks({
          provider: asOptionalString(args.provider),
          workspace: asOptionalString(args.workspace),
          limit: asOptionalNumber(args.limit),
          sort: asOptionalSort(args.sort),
        });

      case "search_tasks":
        return this.taskService.searchTasks({
          query: asRequiredString(args.query, "query"),
          provider: asOptionalString(args.provider),
          workspace: asOptionalString(args.workspace),
          limit: asOptionalNumber(args.limit),
        });

      case "get_task_summary":
        return this.taskService.getTaskSummary(readLocator(args));

      case "get_task_transcript":
        return this.taskService.getTaskTranscript({
          ...readLocator(args),
          maxChars: asOptionalNumber(args.maxChars),
        });

      case "get_workspace_context":
        return this.taskService.getWorkspaceContext(readLocator(args));

      case "rehydrate_task":
        return this.taskService.rehydrateTask(readLocator(args), asRequiredMode(args.mode));

      case "capture_context":
        return this.taskService.captureContext(readCaptureInput(args));

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown TaskSync MCP tool: ${name}`);
    }
  }
}

export function createTaskSyncMcpServer(adapter = new TaskSyncMcpAdapter()) {
  const server = new Server(
    {
      name: "tasksync-mcp",
      title: "TaskSync MCP",
      version: TaskSync_VERSION,
      description:
        "TaskSync MCP server — local context hub for cross-assistant task discovery, transcript retrieval, workspace context, rehydration, and context capture.",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "TaskSync MCP provides read tools for task discovery, summaries, transcripts, workspace context, and continuation packets. It also provides capture_context — the only write tool — which stores portable working context from any assistant into TaskSync-owned storage for later rehydration. It does not inject native session history into host assistants.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: adapter.getToolDefinitions().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        title: tool.name,
        readOnlyHint: tool.readOnly !== false,
        destructiveHint: false,
        idempotentHint: tool.readOnly !== false,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await adapter.callTool(request.params.name, request.params.arguments ?? {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: { result },
      };
    } catch (error: any) {
      if (error instanceof McpError) throw error;

      if (error instanceof TaskContextError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `${error.code}: ${error.message}`,
            },
          ],
          structuredContent: {
            error: error.message,
            code: error.code,
          },
        };
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error?.message ?? String(error),
          },
        ],
      };
    }
  });

  server.onerror = (error) => {
    console.error("[TaskSync MCP Error]", error);
  };

  return { server, adapter };
}

export async function startTaskSyncMcpServer(): Promise<void> {
  const { server } = createTaskSyncMcpServer();
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error("TaskSync MCP server running on stdio");
}

function readLocator(args: Record<string, unknown>) {
  return {
    provider: asRequiredString(args.provider, "provider"),
    rootId: asRequiredString(args.rootId, "rootId"),
    taskId: asRequiredString(args.taskId, "taskId"),
  };
}

function asRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TaskContextError("INVALID_ARGUMENT", `Missing required string field: ${field}`);
  }
  return value.trim();
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalSort(value: unknown): "updated_desc" | "updated_asc" | "title_asc" | undefined {
  return value === "updated_desc" || value === "updated_asc" || value === "title_asc"
    ? value
    : undefined;
}

function asRequiredMode(value: unknown): RehydrateMode {
  if (
    value === "summary" ||
    value === "full_transcript" ||
    value === "decisions_only" ||
    value === "requirements_and_todos" ||
    value === "workspace_context"
  ) {
    return value;
  }
  throw new TaskContextError(
    "INVALID_MODE",
    "mode must be one of: summary, full_transcript, decisions_only, requirements_and_todos, workspace_context"
  );
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function readCaptureInput(args: Record<string, unknown>): CaptureInput {
  return {
    title: asRequiredString(args.title, "title"),
    summary: asRequiredString(args.summary, "summary"),
    workspacePath: asOptionalString(args.workspacePath),
    transcript: asOptionalString(args.transcript),
    decisions: asOptionalStringArray(args.decisions),
    todos: asOptionalStringArray(args.todos),
    touchedFiles: asOptionalStringArray(args.touchedFiles),
    sourceApp: asOptionalString(args.sourceApp),
    tags: asOptionalStringArray(args.tags),
  };
}

const TASKSYNC_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "list_tasks",
    description: "List normalized TaskSync tasks across detected provider roots.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Optional provider filter: cline, roo, openclaw, or captured." },
        workspace: { type: "string", description: "Optional workspace/project filter." },
        limit: { type: "number", description: "Optional max results." },
        sort: {
          type: "string",
          description: "Optional sort mode: updated_desc, updated_asc, or title_asc.",
        },
      },
    },
  },
  {
    name: "search_tasks",
    description: "Search TaskSync task history using titles, summaries, workspace metadata, and transcript previews.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text." },
        provider: { type: "string", description: "Optional provider filter." },
        workspace: { type: "string", description: "Optional workspace/project filter." },
        limit: { type: "number", description: "Optional max results." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_task_summary",
    description: "Return a concise deterministic summary for a single TaskSync task.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        rootId: { type: "string" },
        taskId: { type: "string" },
      },
      required: ["provider", "rootId", "taskId"],
    },
  },
  {
    name: "get_task_transcript",
    description: "Return a normalized transcript for a single TaskSync task with optional truncation.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        rootId: { type: "string" },
        taskId: { type: "string" },
        maxChars: { type: "number", description: "Optional maximum transcript characters to return." },
      },
      required: ["provider", "rootId", "taskId"],
    },
  },
  {
    name: "get_workspace_context",
    description: "Return workspace and repository metadata associated with a TaskSync task.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        rootId: { type: "string" },
        taskId: { type: "string" },
      },
      required: ["provider", "rootId", "taskId"],
    },
  },
  {
    name: "rehydrate_task",
    description: "Build a structured TaskSync continuation packet for cross-assistant task rehydration.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        rootId: { type: "string" },
        taskId: { type: "string" },
        mode: {
          type: "string",
          description:
            "Rehydration mode: summary, full_transcript, decisions_only, requirements_and_todos, or workspace_context.",
        },
      },
      required: ["provider", "rootId", "taskId", "mode"],
    },
  },
  {
    name: "capture_context",
    description:
      "Store portable working context from any MCP-capable assistant into TaskSync-owned storage. " +
      "Captured tasks become immediately available via list_tasks, search_tasks, get_task_summary, " +
      "get_task_transcript, get_workspace_context, and rehydrate_task. " +
      "This is the only write tool in TaskSync MCP — it writes exclusively to TaskSync-owned storage " +
      "and never mutates provider-native task stores.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short descriptive title for the task or session being captured." },
        summary: { type: "string", description: "Summary of the work done, goal, or current status." },
        workspacePath: { type: "string", description: "Optional absolute path to the project workspace." },
        transcript: { type: "string", description: "Optional conversation transcript. Supports User:/Assistant: role markers or freeform text." },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of key decisions made.",
        },
        todos: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of open todos or next steps.",
        },
        touchedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of files modified or referenced.",
        },
        sourceApp: { type: "string", description: "Optional name of the AI tool that captured this context (e.g. cursor, claude-desktop)." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for filtering or grouping.",
        },
      },
      required: ["title", "summary"],
    },
  },
];
