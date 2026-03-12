import crypto from "crypto";

export interface CanonicalTaskLocator {
  provider: string;
  rootId: string;
  taskId: string;
}

export interface CanonicalTaskMeta {
  provider: string;
  rootId: string;
  taskId: string;
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

export interface CanonicalWorkspaceContext {
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

export interface CanonicalTranscriptEntry {
  index: number;
  role: string;
  timestamp?: string;
  content: string;
  isToolRelated: boolean;
}

export interface CanonicalDerivedContext {
  decisions: string[];
  requirements: string[];
  todos: string[];
  keyExcerpts: string[];
}

export interface CanonicalTaskContext {
  locator: CanonicalTaskLocator;
  task: CanonicalTaskMeta;
  summary: string;
  workspace: CanonicalWorkspaceContext;
  transcript: CanonicalTranscriptEntry[];
  derived: CanonicalDerivedContext;
  sourceFingerprint: string;
  generatedAt: string;
}

interface CreateCanonicalInput {
  locator: CanonicalTaskLocator;
  task: CanonicalTaskMeta;
  summary: string;
  workspace: CanonicalWorkspaceContext;
  transcriptEntries: Array<{
    index: number;
    role: string;
    timestamp?: string;
    content: string;
  }>;
  keyExcerpts?: string[];
  generatedAt?: string;
}

export interface CanonicalTranscriptRenderOptions {
  includeTooling?: boolean;
  maxChars?: number;
}

export interface CanonicalTranscriptRenderResult {
  text: string;
  truncated: boolean;
  returnedChars: number;
  totalChars: number;
  includedEntries: number;
  omittedToolEntries: number;
}

export interface FullContextRenderOptions {
  includeTooling?: boolean;
  maxChars?: number;
}

const DECISION_PATTERNS = [
  /\b(decid(?:e|ed|ing)|choice|chosen|we(?:'| wi)ll|switched|implemented|refactor(?:ed|ing)?|migrat(?:e|ed|ion)|added|removed|fixed)\b/i,
];

const REQUIREMENT_PATTERNS = [
  /\b(requirements?|definition of done|deliverables?|must|should|need to|important|support|focus on)\b/i,
];

const TODO_PATTERNS = [
  /\b(todo|to-do|next steps?|follow-up|remaining|pending|left to do|open items?)\b/i,
];

export function createCanonicalTaskContext(input: CreateCanonicalInput): CanonicalTaskContext {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const transcript = input.transcriptEntries.map((entry) => ({
    index: entry.index,
    role: entry.role,
    timestamp: entry.timestamp,
    content: squashWhitespace(entry.content),
    isToolRelated: isToolRelated(entry.content),
  }));

  const derived: CanonicalDerivedContext = {
    decisions: extractByPatterns(transcript, DECISION_PATTERNS),
    requirements: extractByPatterns(transcript, REQUIREMENT_PATTERNS),
    todos: extractByPatterns(transcript, TODO_PATTERNS),
    keyExcerpts:
      input.keyExcerpts && input.keyExcerpts.length > 0
        ? dedupeClip(input.keyExcerpts, 220, 8)
        : dedupeClip(
            transcript
              .slice(0, 4)
              .map((entry) => entry.content)
              .filter(Boolean),
            220,
            8
          ),
  };

  const sourceFingerprint = computeFingerprint({
    locator: input.locator,
    updatedAt: input.task.updatedAt,
    summary: input.summary,
    workspacePath: input.workspace.workspacePath,
    transcript,
  });

  return {
    locator: input.locator,
    task: input.task,
    summary: input.summary,
    workspace: input.workspace,
    transcript,
    derived,
    sourceFingerprint,
    generatedAt,
  };
}

export function renderCanonicalTranscript(
  canonical: CanonicalTaskContext,
  options: CanonicalTranscriptRenderOptions = {}
): CanonicalTranscriptRenderResult {
  const includeTooling = options.includeTooling !== false;
  const included = includeTooling
    ? canonical.transcript
    : canonical.transcript.filter((entry) => !entry.isToolRelated);
  const omittedToolEntries = canonical.transcript.length - included.length;
  const text = included
    .map((entry) => {
      const header = `[${String(entry.index).padStart(3, "0")}] ${entry.role.toUpperCase()}${entry.timestamp ? ` @ ${entry.timestamp}` : ""}`;
      return `${header}\n${entry.content}`;
    })
    .join("\n\n");

  if (!options.maxChars || text.length <= options.maxChars) {
    return {
      text,
      truncated: false,
      returnedChars: text.length,
      totalChars: text.length,
      includedEntries: included.length,
      omittedToolEntries,
    };
  }

  const truncatedText = `${text.slice(0, Math.max(0, options.maxChars - 26))}\n\n[Transcript truncated by TaskSync]`;
  return {
    text: truncatedText,
    truncated: true,
    returnedChars: truncatedText.length,
    totalChars: text.length,
    includedEntries: included.length,
    omittedToolEntries,
  };
}

export function renderSmartContext(canonical: CanonicalTaskContext): string {
  const lines: string[] = [];
  lines.push(`Task: ${canonical.task.title}`);
  if (canonical.workspace.workspacePath) lines.push(`Workspace: ${canonical.workspace.workspacePath}`);
  if (canonical.workspace.repoName) lines.push(`Repository: ${canonical.workspace.repoName}`);

  lines.push("");
  lines.push("Summary:");
  lines.push(canonical.summary);

  if (canonical.derived.decisions.length > 0) {
    lines.push("");
    lines.push("Key decisions:");
    canonical.derived.decisions.slice(0, 8).forEach((item) => lines.push(`  • ${item}`));
  }

  const openWork = dedupeClip(
    [...canonical.derived.requirements, ...canonical.derived.todos],
    240,
    10
  );
  if (openWork.length > 0) {
    lines.push("");
    lines.push("Requirements / next steps:");
    openWork.forEach((item) => lines.push(`  • ${item}`));
  }

  if (canonical.derived.keyExcerpts.length > 0) {
    lines.push("");
    lines.push("Supporting excerpts:");
    canonical.derived.keyExcerpts.slice(0, 4).forEach((item) => lines.push(`  • ${item}`));
  }

  lines.push("");
  lines.push("---");
  lines.push(
    `Continue the task using this context. Verify assumptions against workspace state and complete any unfinished requirements.`
  );

  return lines.join("\n");
}

export function renderFullContext(
  canonical: CanonicalTaskContext,
  options: FullContextRenderOptions = {}
): string {
  const includeTooling = options.includeTooling !== false;
  const transcript = renderCanonicalTranscript(canonical, {
    includeTooling,
    maxChars: options.maxChars,
  });

  const lines: string[] = [];
  lines.push(`Task: ${canonical.task.title}`);
  if (canonical.workspace.workspacePath) lines.push(`Workspace: ${canonical.workspace.workspacePath}`);
  if (canonical.workspace.repoName) lines.push(`Repository: ${canonical.workspace.repoName}`);
  lines.push("");
  lines.push(canonical.summary);

  if (!includeTooling && transcript.omittedToolEntries > 0) {
    lines.push("");
    lines.push(`[Tooling filtered: omitted ${transcript.omittedToolEntries} tool-related transcript entries]`);
  }

  lines.push("");
  lines.push("---");
  lines.push("Transcript:");
  lines.push(transcript.text || "[No transcript content available]");

  if (transcript.truncated) {
    lines.push("");
    lines.push(
      `[Note: Transcript was truncated at ${transcript.returnedChars} of ${transcript.totalChars} total characters]`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push(
    `Use this transcript as the primary source of truth, reconcile with summary/workspace metadata, then continue implementation.`
  );

  return lines.join("\n");
}

function extractByPatterns(entries: CanonicalTranscriptEntry[], patterns: RegExp[]): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const lines = entry.content
      .split(/\r?\n/)
      .map((line) => squashWhitespace(line))
      .filter(Boolean);

    for (const line of lines) {
      if (!patterns.some((pattern) => pattern.test(line))) continue;
      const clipped = clip(line, 240);
      if (seen.has(clipped)) continue;
      seen.add(clipped);
      matches.push(clipped);
      if (matches.length >= 12) return matches;
    }
  }

  return matches;
}

function isToolRelated(content: string): boolean {
  const trimmed = content.trim();
  return (
    /^\[(tool use|tool result|thinking|resource)\]/i.test(trimmed) ||
    /\b(tool[_\s-]?use|tool[_\s-]?result|mcp tool|executed command)\b/i.test(trimmed)
  );
}

function dedupeClip(values: string[], maxChars: number, maxItems: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const squashed = squashWhitespace(value);
    if (!squashed) continue;
    const clipped = clip(squashed, maxChars);
    if (seen.has(clipped)) continue;
    seen.add(clipped);
    out.push(clipped);
    if (out.length >= maxItems) break;
  }
  return out;
}

function computeFingerprint(payload: unknown): string {
  const json = JSON.stringify(payload);
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 24);
}

function squashWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}