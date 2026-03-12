import fs from "fs";
import path from "path";
import { getTasksForRoot, TaskSummary, extractWorkspaceDetails, projectNameFromWorkspace } from "./indexer";
import {
  CaptureInput,
  createCapturedTask,
  getCapturedTask,
  readCapturedTranscript,
} from "./captured";
import {
  CanonicalTaskContext,
  createCanonicalTaskContext,
  renderCanonicalTranscript,
  renderFullContext,
  renderSmartContext,
} from "./canonical";
import { IProvider, ProviderRoot } from "../../providers/interface";
import {
  createProviderRegistry,
  detectAllTargets,
  getProviderByName,
  isAccessibleRootPath,
} from "../../providers/registry";

export interface TaskLocator {
  provider: string;
  rootId: string;
  taskId: string;
}

export interface ListTasksOptions {
  provider?: string;
  workspace?: string;
  limit?: number;
  sort?: "updated_desc" | "updated_asc" | "title_asc";
}

export interface SearchTasksOptions {
  query: string;
  provider?: string;
  workspace?: string;
  limit?: number;
}

export interface TranscriptOptions extends TaskLocator {
  maxChars?: number;
}

export interface NormalizedTaskRecord extends TaskLocator {
  title: string;
  status: string;
  providerLabel: string;
  rootLabel: string;
  providerRootPath: string;
  workspace?: string;
  workspaceLabel?: string;
  projectHint?: string;
  repoName?: string;
  createdAt?: string;
  updatedAt: string;
  imported?: boolean;
  summarySnippet?: string;
}

export interface TaskTranscriptEntry {
  index: number;
  role: string;
  timestamp?: string;
  content: string;
}

export interface TaskTranscriptResult {
  task: NormalizedTaskRecord;
  entries: TaskTranscriptEntry[];
  text: string;
  truncated: boolean;
  totalChars: number;
  returnedChars: number;
}

export interface TaskSummaryResult {
  task: NormalizedTaskRecord;
  summary: string;
  summarySnippet: string;
  userGoal?: string;
  assistantOutcome?: string;
  keyExcerpts: string[];
}

export interface TaskWorkspaceContext {
  provider: string;
  rootId: string;
  providerRootPath: string;
  workspacePath?: string;
  workspaceLabel?: string;
  projectHint?: string;
  repoName?: string;
  remoteUrls?: string[];
  branch?: string | null;
  touchedFiles?: string[];
}

export type RehydrateMode =
  | "summary"
  | "full_transcript"
  | "decisions_only"
  | "requirements_and_todos"
  | "workspace_context";

export type TaskContextRenderMode = "smart" | "full";

export interface RenderTaskContextOptions {
  mode?: TaskContextRenderMode;
  includeTooling?: boolean;
  maxChars?: number;
}

export interface RenderTaskContextResult {
  title: string;
  text: string;
  mode: TaskContextRenderMode;
  includeTooling: boolean;
  sourceFingerprint: string;
}

export interface RehydrationPacket {
  packetType: "tasksync.rehydration";
  version: 1;
  generatedAt: string;
  mode: RehydrateMode;
  task: NormalizedTaskRecord;
  summary: string;
  workspace: TaskWorkspaceContext;
  highlights: string[];
  transcript?: {
    text: string;
    truncated: boolean;
    returnedChars: number;
    totalChars: number;
  };
  continuationPrompt: string;
  limitations: string[];
}

export interface CaptureContextResult {
  provider: "captured";
  rootId: "local";
  taskId: string;
  status: "created";
  capturedAt: string;
}

export class TaskContextError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PROVIDER"
      | "ROOT_NOT_FOUND"
      | "ROOT_UNAVAILABLE"
      | "TASK_NOT_FOUND"
      | "INVALID_ARGUMENT"
      | "INVALID_QUERY"
      | "INVALID_MODE",
    message: string
  ) {
    super(message);
    this.name = "TaskContextError";
  }
}

interface ResolvedTask {
  provider: IProvider;
  root: ProviderRoot;
  summary: TaskSummary;
  normalized: NormalizedTaskRecord;
}

export class TaskContextService {
  private readonly canonicalCache = new Map<string, CanonicalTaskContext>();

  constructor(private readonly providers: IProvider[] = createProviderRegistry()) {}

  listTasks(options: ListTasksOptions = {}): NormalizedTaskRecord[] {
    const normalized = this.getCandidateTasks(options.provider)
      .map(({ provider, root, summary }) => this.normalizeTask(summary, provider, root))
      .filter((task) => matchesWorkspace(task, options.workspace));

    const sorted = sortTasks(normalized, options.sort ?? "updated_desc");
    return typeof options.limit === "number" ? sorted.slice(0, Math.max(options.limit, 0)) : sorted;
  }

  searchTasks(options: SearchTasksOptions): {
    query: string;
    results: Array<NormalizedTaskRecord & { score: number; matchedFields: string[]; preview: string }>;
  } {
    const query = options.query?.trim();
    if (!query) {
      throw new TaskContextError("INVALID_QUERY", "search_tasks requires a non-empty query string.");
    }

    const lowered = query.toLowerCase();
    const tasks = this.listTasks({
      provider: options.provider,
      workspace: options.workspace,
    });

    const results = tasks
      .map((task) => {
        const preview = this.getTranscriptPreview(task, 1200);
        const fields: Array<[string, string | undefined]> = [
          ["title", task.title],
          ["summarySnippet", task.summarySnippet],
          ["workspace", task.workspace],
          ["workspaceLabel", task.workspaceLabel],
          ["projectHint", task.projectHint],
          ["repoName", task.repoName],
          ["preview", preview],
        ];

        const matchedFields = fields
          .filter(([, value]) => value && value.toLowerCase().includes(lowered))
          .map(([name]) => name);

        if (matchedFields.length === 0) return null;

        const score = matchedFields.reduce((total, field) => {
          if (field === "title") return total + 5;
          if (field === "summarySnippet") return total + 3;
          if (field === "preview") return total + 2;
          return total + 1;
        }, 0);

        return {
          ...task,
          score,
          matchedFields,
          preview: clip(preview || task.summarySnippet || task.title, 280),
        };
      })
      .filter((value): value is NormalizedTaskRecord & { score: number; matchedFields: string[]; preview: string } => Boolean(value))
      .sort((a, b) => b.score - a.score || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return {
      query,
      results: typeof options.limit === "number" ? results.slice(0, Math.max(options.limit, 0)) : results,
    };
  }

  getTaskSummary(locator: TaskLocator): TaskSummaryResult {
    const canonical = this.getCanonicalTaskContext(locator);
    const firstUser = canonical.transcript.find((entry) => entry.role === "user")?.content;
    const lastAssistant = [...canonical.transcript].reverse().find((entry) => entry.role === "assistant")?.content;

    return {
      task: canonical.task,
      summary: canonical.summary,
      summarySnippet: clip(canonical.summary.replace(/\n+/g, " "), 240),
      userGoal: firstUser ? clip(squashWhitespace(firstUser), 280) : undefined,
      assistantOutcome: lastAssistant ? clip(squashWhitespace(lastAssistant), 280) : undefined,
      keyExcerpts:
        canonical.derived.keyExcerpts.length > 0
          ? canonical.derived.keyExcerpts
          : canonical.transcript.slice(0, 4).map((entry) => clip(squashWhitespace(entry.content), 220)),
    };
  }

  getTaskTranscript(options: TranscriptOptions): TaskTranscriptResult {
    const canonical = this.getCanonicalTaskContext(options);
    const rendered = renderCanonicalTranscript(canonical, {
      includeTooling: true,
      maxChars: options.maxChars,
    });

    return {
      task: canonical.task,
      entries: canonical.transcript.map(({ index, role, timestamp, content }) => ({
        index,
        role,
        timestamp,
        content,
      })),
      text: rendered.text,
      truncated: rendered.truncated,
      totalChars: rendered.totalChars,
      returnedChars: rendered.returnedChars,
    };
  }

  getWorkspaceContext(locator: TaskLocator): TaskWorkspaceContext {
    const canonical = this.getCanonicalTaskContext(locator);
    return {
      ...canonical.workspace,
    };
  }

  captureContext(input: CaptureInput): CaptureContextResult {
    if (!input.title || !input.title.trim()) {
      throw new TaskContextError("INVALID_ARGUMENT", "capture_context requires a non-empty title.");
    }
    if (!input.summary || !input.summary.trim()) {
      throw new TaskContextError("INVALID_ARGUMENT", "capture_context requires a non-empty summary.");
    }
    const result = createCapturedTask(input);
    return {
      provider: "captured",
      rootId: "local",
      taskId: result.taskId,
      status: "created",
      capturedAt: result.capturedAt,
    };
  }

  getCanonicalTaskContext(locator: TaskLocator): CanonicalTaskContext {
    const cacheKey = `${locator.provider}|${locator.rootId}|${locator.taskId}`;
    const resolved = this.resolveTask(locator);
    const cached = this.canonicalCache.get(cacheKey);
    if (cached && cached.task.updatedAt === resolved.normalized.updatedAt) {
      return cached;
    }

    const transcript = this.readTranscript(resolved);
    const details = this.readWorkspaceDetails(resolved);
    const workspace: TaskWorkspaceContext = {
      provider: resolved.normalized.provider,
      rootId: resolved.normalized.rootId,
      providerRootPath: resolved.root.path,
      workspacePath: resolved.normalized.workspace,
      workspaceLabel: resolved.normalized.workspaceLabel,
      projectHint: resolved.normalized.projectHint,
      repoName: resolved.normalized.repoName,
      remoteUrls: details.remoteUrls,
      branch: null,
      touchedFiles: [],
    };

    const firstUser = transcript.entries.find((entry) => entry.role === "user")?.content;
    const lastAssistant = [...transcript.entries].reverse().find((entry) => entry.role === "assistant")?.content;
    const summaryLines = [
      `Task: ${resolved.normalized.title}`,
      resolved.normalized.workspaceLabel ? `Workspace: ${resolved.normalized.workspaceLabel}` : undefined,
      resolved.normalized.repoName ? `Repository: ${resolved.normalized.repoName}` : undefined,
      firstUser ? `Primary request: ${clip(squashWhitespace(firstUser), 280)}` : undefined,
      lastAssistant ? `Latest assistant context: ${clip(squashWhitespace(lastAssistant), 280)}` : undefined,
    ].filter((line): line is string => Boolean(line));

    const canonical = createCanonicalTaskContext({
      locator,
      task: resolved.normalized,
      summary: summaryLines.join("\n"),
      workspace,
      transcriptEntries: transcript.entries,
      keyExcerpts: transcript.entries.slice(0, 4).map((entry) => clip(squashWhitespace(entry.content), 220)),
    });

    this.canonicalCache.set(cacheKey, canonical);
    return canonical;
  }

  renderTaskContext(locator: TaskLocator, options: RenderTaskContextOptions = {}): RenderTaskContextResult {
    const mode = options.mode ?? "smart";
    const canonical = this.getCanonicalTaskContext(locator);

    if (mode === "smart") {
      return {
        title: canonical.task.title,
        text: renderSmartContext(canonical),
        mode,
        includeTooling: false,
        sourceFingerprint: canonical.sourceFingerprint,
      };
    }

    const includeTooling = options.includeTooling !== false;
    return {
      title: canonical.task.title,
      text: renderFullContext(canonical, {
        includeTooling,
        maxChars: options.maxChars,
      }),
      mode,
      includeTooling,
      sourceFingerprint: canonical.sourceFingerprint,
    };
  }

  rehydrateTask(locator: TaskLocator, mode: RehydrateMode): RehydrationPacket {
    if (!isRehydrateMode(mode)) {
      throw new TaskContextError(
        "INVALID_MODE",
        `Unsupported rehydration mode: ${mode}. Supported modes: summary, full_transcript, decisions_only, requirements_and_todos, workspace_context.`
      );
    }

    const canonical = this.getCanonicalTaskContext(locator);
    const summary: TaskSummaryResult = {
      task: canonical.task,
      summary: canonical.summary,
      summarySnippet: clip(canonical.summary.replace(/\n+/g, " "), 240),
      userGoal: canonical.transcript.find((entry) => entry.role === "user")?.content,
      assistantOutcome: [...canonical.transcript].reverse().find((entry) => entry.role === "assistant")?.content,
      keyExcerpts: canonical.derived.keyExcerpts,
    };
    const workspace: TaskWorkspaceContext = {
      ...canonical.workspace,
    };
    const transcriptRender = renderCanonicalTranscript(canonical, {
      includeTooling: true,
      maxChars: mode === "full_transcript" ? 24000 : 8000,
    });
    const transcript: TaskTranscriptResult = {
      task: canonical.task,
      entries: canonical.transcript.map(({ index, role, timestamp, content }) => ({
        index,
        role,
        timestamp,
        content,
      })),
      text: transcriptRender.text,
      truncated: transcriptRender.truncated,
      totalChars: transcriptRender.totalChars,
      returnedChars: transcriptRender.returnedChars,
    };
    const highlights =
      mode === "decisions_only"
        ? canonical.derived.decisions
        : mode === "requirements_and_todos"
          ? [...canonical.derived.requirements, ...canonical.derived.todos]
          : mode === "workspace_context"
            ? [workspace.workspacePath, workspace.repoName, workspace.projectHint].filter((value): value is string => Boolean(value))
            : [summary.summarySnippet];

    return {
      packetType: "tasksync.rehydration",
      version: 1,
      generatedAt: new Date().toISOString(),
      mode,
      task: summary.task,
      summary: summary.summary,
      workspace,
      highlights: highlights.length > 0 ? highlights : summary.keyExcerpts,
      transcript:
        mode === "full_transcript"
          ? {
              text: transcriptRender.text,
              truncated: transcriptRender.truncated,
              returnedChars: transcriptRender.returnedChars,
              totalChars: transcriptRender.totalChars,
            }
          : undefined,
      continuationPrompt: buildContinuationPrompt(mode, summary, workspace, highlights, transcript),
      limitations: [
        "TaskSync MCP v1 is read-only and does not inject history into host assistants.",
        "Summaries and highlight extraction are deterministic best-effort fallbacks derived from stored task data.",
      ],
    };
  }

  private getCandidateTasks(providerName?: string): ResolvedTask[] {
    const targets = providerName
      ? this.getTargetsForProvider(providerName)
      : detectAllTargets(this.providers);

    return targets.flatMap(({ provider, root }) =>
      getTasksForRoot(provider, root).map((summary) => ({
        provider,
        root,
        summary,
        normalized: this.normalizeTask(summary, provider, root),
      }))
    );
  }

  private getTargetsForProvider(providerName: string): Array<{ provider: IProvider; root: ProviderRoot }> {
    const provider = getProviderByName(providerName, this.providers);
    if (!provider) {
      throw new TaskContextError("INVALID_PROVIDER", `Unknown provider: ${providerName}`);
    }

    // For providers that manage their own storage (e.g. captured), use validateRoot
    // which returns true unconditionally even before the directory is created.
    return provider
      .getRoots()
      .filter((root) => isAccessibleRootPath(root.path) || provider.validateRoot(root.path))
      .map((root) => ({ provider, root }));
  }

  private resolveTask(locator: TaskLocator): ResolvedTask {
    const provider = getProviderByName(locator.provider, this.providers);
    if (!provider) {
      throw new TaskContextError("INVALID_PROVIDER", `Unknown provider: ${locator.provider}`);
    }

    const root = provider.getRoots().find((candidate) => candidate.id === locator.rootId);
    if (!root) {
      throw new TaskContextError(
        "ROOT_NOT_FOUND",
        `Root ${locator.rootId} was not found for provider ${locator.provider}.`
      );
    }

    // For providers that manage their own storage lifecycle (e.g. captured),
    // validateRoot returns true unconditionally — the dir is created on first write.
    if (!isAccessibleRootPath(root.path) && !provider.validateRoot(root.path)) {
      throw new TaskContextError(
        "ROOT_UNAVAILABLE",
        `Root ${locator.rootId} for provider ${locator.provider} is not accessible on this machine.`
      );
    }

    const summary = getTasksForRoot(provider, root).find((task) => task.taskId === locator.taskId);
    if (!summary) {
      throw new TaskContextError(
        "TASK_NOT_FOUND",
        `Task ${locator.taskId} was not found for provider ${locator.provider} root ${locator.rootId}.`
      );
    }

    return {
      provider,
      root,
      summary,
      normalized: this.normalizeTask(summary, provider, root),
    };
  }

  private normalizeTask(summary: TaskSummary, provider: IProvider, root: ProviderRoot): NormalizedTaskRecord {
    const createdAt = deriveCreatedAt(summary, provider.getProviderName());
    const workspaceLabel =
      summary.projectHint ||
      summary.repoName?.split("/").pop() ||
      projectNameFromWorkspace(summary.workspace) ||
      undefined;

    return {
      provider: provider.getProviderName(),
      providerLabel: provider.getProviderName(),
      rootId: root.id,
      rootLabel: root.label,
      providerRootPath: root.path,
      taskId: summary.taskId,
      title: clip(squashWhitespace(summary.title), 500),
      status: summary.status,
      workspace: summary.workspace,
      workspaceLabel,
      projectHint: summary.projectHint,
      repoName: summary.repoName,
      createdAt,
      updatedAt: summary.updatedAt,
      imported: summary.imported,
      summarySnippet: clip(squashWhitespace(summary.title), 200),
    };
  }

  private readTranscript(resolved: ResolvedTask): TaskTranscriptResult {
    const entries =
      resolved.provider.getProviderName() === "openclaw"
        ? readOpenClawTranscript(resolved.root, resolved.summary.taskId)
        : resolved.provider.getProviderName() === "captured"
          ? readCapturedTranscript(resolved.summary.taskId)
          : readProviderTaskTranscript(resolved.root, resolved.summary.taskId);

    const fallbackEntries =
      entries.length > 0
        ? entries
        : [
            {
              index: 1,
              role: "user",
              content: resolved.summary.title,
            },
          ];

    const text = formatTranscriptText(fallbackEntries);

    return {
      task: resolved.normalized,
      entries: fallbackEntries,
      text,
      truncated: false,
      totalChars: text.length,
      returnedChars: text.length,
    };
  }

  private getTranscriptPreview(task: NormalizedTaskRecord, maxChars: number): string {
    try {
      return this.getTaskTranscript({
        provider: task.provider,
        rootId: task.rootId,
        taskId: task.taskId,
        maxChars,
      }).text;
    } catch {
      return task.summarySnippet || task.title;
    }
  }

  private readWorkspaceDetails(resolved: ResolvedTask) {
    if (resolved.provider.getProviderName() === "openclaw") {
      return { remoteUrls: [] as string[] };
    }

    if (resolved.provider.getProviderName() === "captured") {
      const record = getCapturedTask(resolved.summary.taskId);
      return { cwd: record?.workspacePath, remoteUrls: [] as string[] };
    }

    const taskDir = resolveWithinRoot(resolved.root.path, "tasks", resolved.summary.taskId);
    return extractWorkspaceDetails(taskDir);
  }
}

const DECISION_PATTERNS = [
  /\b(decid(?:e|ed|ing)|choice|chosen|we(?:'| wi)ll|switched|implemented|refactor(?:ed|ing)?|migrat(?:e|ed|ion)|added|removed|fixed)\b/i,
];

const REQUIREMENT_PATTERNS = [
  /\b(requirements?|definition of done|deliverables?|todo|to-do|next steps?|must|should|need to|important|support|focus on)\b/i,
];

function sortTasks(tasks: NormalizedTaskRecord[], sort: NonNullable<ListTasksOptions["sort"]>): NormalizedTaskRecord[] {
  const copy = [...tasks];
  if (sort === "updated_asc") {
    return copy.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  }
  if (sort === "title_asc") {
    return copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function matchesWorkspace(task: NormalizedTaskRecord, workspace?: string): boolean {
  if (!workspace) return true;
  const lowered = workspace.toLowerCase();
  return [task.workspace, task.workspaceLabel, task.projectHint, task.repoName]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(lowered));
}

function deriveCreatedAt(summary: TaskSummary, provider: string): string | undefined {
  if (/^\d{13}$/.test(summary.taskId)) {
    const fromTaskId = new Date(Number(summary.taskId));
    if (!Number.isNaN(fromTaskId.getTime())) return fromTaskId.toISOString();
  }

  if (provider === "kilo" && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(summary.taskId)) {
    const compact = summary.taskId.replace(/-/g, "");
    const millis = parseInt(compact.slice(0, 12), 16);
    if (Number.isFinite(millis)) {
      const fromUuid = new Date(millis);
      if (!Number.isNaN(fromUuid.getTime())) return fromUuid.toISOString();
    }
  }

  return summary.updatedAt;
}

function resolveWithinRoot(rootPath: string, ...segments: string[]): string {
  const resolved = path.resolve(rootPath, ...segments);
  const normalizedRoot = path.resolve(rootPath);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Resolved path escapes provider root: ${resolved}`);
  }
  return resolved;
}

function readProviderTaskTranscript(root: ProviderRoot, taskId: string): TaskTranscriptEntry[] {
  const taskDir = resolveWithinRoot(root.path, "tasks", taskId);
  const apiHistoryPath = path.join(taskDir, "api_conversation_history.json");
  const uiMessagesPath = path.join(taskDir, "ui_messages.json");

  if (fs.existsSync(apiHistoryPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(apiHistoryPath, "utf8"));
      if (Array.isArray(parsed)) {
        const entries = parsed
          .map((message, index) => normalizeTranscriptEntry(message, index + 1))
          .filter((entry): entry is TaskTranscriptEntry => Boolean(entry && entry.content));
        if (entries.length > 0) return entries;
      }
    } catch {
      // ignore parse errors and fall back to ui_messages.json
    }
  }

  if (fs.existsSync(uiMessagesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(uiMessagesPath, "utf8"));
      if (Array.isArray(parsed)) {
        return parsed
          .map((message, index) => normalizeUiMessageEntry(message, index + 1))
          .filter((entry): entry is TaskTranscriptEntry => Boolean(entry && entry.content));
      }
    } catch {
      // ignore
    }
  }

  return [];
}

function readOpenClawTranscript(root: ProviderRoot, taskId: string): TaskTranscriptEntry[] {
  const [agentId, sessionId] = taskId.split("/");
  if (!agentId || !sessionId) return [];

  const sessionPath = resolveWithinRoot(root.path, "agents", agentId, "sessions", `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionPath)) return [];

  try {
    const lines = fs
      .readFileSync(sessionPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines
      .map((line, index) => {
        try {
          return normalizeTranscriptEntry(JSON.parse(line), index + 1);
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is TaskTranscriptEntry => Boolean(entry && entry.content));
  } catch {
    return [];
  }
}

function normalizeTranscriptEntry(message: any, index: number): TaskTranscriptEntry | undefined {
  const content = normalizeContent(message?.content);
  if (!content) return undefined;

  return {
    index,
    role: normalizeRole(message?.role),
    timestamp: coerceTimestamp(message?.ts ?? message?.timestamp ?? message?.createdAt ?? message?.updatedAt),
    content,
  };
}

function normalizeUiMessageEntry(message: any, index: number): TaskTranscriptEntry | undefined {
  const rawText = typeof message?.text === "string" ? message.text : undefined;
  const content = rawText ? squashWhitespace(rawText) : undefined;
  if (!content) return undefined;

  return {
    index,
    role: message?.ask ? "user" : "assistant",
    timestamp: coerceTimestamp(message?.ts),
    content,
  };
}

function normalizeRole(role: unknown): string {
  return typeof role === "string" && role.trim() ? role.toLowerCase() : "unknown";
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return squashWhitespace(content);
  if (!Array.isArray(content)) return "";

  const chunks = content.flatMap((block) => normalizeContentBlock(block));
  return squashWhitespace(chunks.join("\n\n"));
}

function normalizeContentBlock(block: any): string[] {
  if (typeof block === "string") return [block];
  if (!block || typeof block !== "object") return [];

  if (typeof block.text === "string") return [block.text];
  if (block.type === "thinking" && typeof block.thinking === "string") return [`[Thinking] ${block.thinking}`];
  if (block.type === "tool_use") {
    return [`[Tool use] ${block.name || "unknown"}${block.input ? ` ${safeJson(block.input)}` : ""}`];
  }
  if (block.type === "tool_result") {
    const nested = Array.isArray(block.content)
      ? block.content.flatMap((item: any) => normalizeContentBlock(item)).join("\n")
      : typeof block.content === "string"
        ? block.content
        : safeJson(block.content);
    return [`[Tool result] ${nested}`];
  }
  if (block.type === "resource" && typeof block.resource?.text === "string") return [block.resource.text];
  if (block.type === "resource_link" && typeof block.uri === "string") return [`[Resource] ${block.uri}`];
  if (typeof block.content === "string") return [block.content];
  if (Array.isArray(block.content)) return block.content.flatMap((item: any) => normalizeContentBlock(item));
  return [safeJson(block)];
}

function formatTranscriptText(entries: TaskTranscriptEntry[]): string {
  return entries
    .map((entry) => {
      const header = `[${String(entry.index).padStart(3, "0")}] ${entry.role.toUpperCase()}${entry.timestamp ? ` @ ${entry.timestamp}` : ""}`;
      return `${header}\n${entry.content}`;
    })
    .join("\n\n");
}

function applyTranscriptLimit(transcript: TaskTranscriptResult, maxChars?: number): TaskTranscriptResult {
  if (!maxChars || transcript.text.length <= maxChars) return transcript;

  const truncatedText = `${transcript.text.slice(0, Math.max(0, maxChars - 26))}\n\n[Transcript truncated by TaskSync]`;
  return {
    ...transcript,
    text: truncatedText,
    truncated: true,
    returnedChars: truncatedText.length,
  };
}

function extractHighlights(entries: TaskTranscriptEntry[], patterns: RegExp[]): string[] {
  const highlights: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const lines = entry.content.split(/\r?\n/).map((line) => squashWhitespace(line)).filter(Boolean);
    for (const line of lines) {
      if (!patterns.some((pattern) => pattern.test(line))) continue;
      const clipped = clip(line, 240);
      if (seen.has(clipped)) continue;
      seen.add(clipped);
      highlights.push(clipped);
      if (highlights.length >= 12) return highlights;
    }
  }

  return highlights;
}

function buildContinuationPrompt(
  mode: RehydrateMode,
  summary: TaskSummaryResult,
  workspace: TaskWorkspaceContext,
  highlights: string[],
  transcript: TaskTranscriptResult
): string {
  const intro = `Continue the prior task "${summary.task.title}" using this TaskSync rehydration packet.`;
  const workspaceLine = workspace.workspacePath
    ? `Workspace path: ${workspace.workspacePath}.`
    : "Workspace path was not available in the stored task metadata.";

  if (mode === "workspace_context") {
    return `${intro} Focus on re-establishing the repository/workspace context before taking further action. ${workspaceLine}`;
  }

  if (mode === "full_transcript") {
    return `${intro} Use the included transcript as the primary source of truth, then reconcile it with the summary and workspace metadata. ${workspaceLine}`;
  }

  if (mode === "decisions_only") {
    return `${intro} Prioritize the extracted implementation decisions below, then ask clarifying questions if important gaps remain. ${workspaceLine}`;
  }

  if (mode === "requirements_and_todos") {
    return `${intro} Use the extracted requirements and unfinished work items to resume execution. ${workspaceLine}`;
  }

  const fallbackHighlights = highlights.length > 0 ? highlights.join(" | ") : summary.summarySnippet;
  return `${intro} Summary: ${summary.summarySnippet}. Key context: ${fallbackHighlights}. Transcript length: ${transcript.totalChars} chars. ${workspaceLine}`;
}

function isRehydrateMode(value: string): value is RehydrateMode {
  return [
    "summary",
    "full_transcript",
    "decisions_only",
    "requirements_and_todos",
    "workspace_context",
  ].includes(value);
}

function squashWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function coerceTimestamp(value: unknown): string | undefined {
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}