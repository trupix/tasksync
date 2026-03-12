import fs from "fs";
import path from "path";
import os from "os";

// Matches TaskTranscriptEntry in context.ts — defined locally to avoid circular imports.
export interface CapturedTranscriptEntry {
  index: number;
  role: string;
  timestamp?: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

export function getCapturedTasksDir(): string {
  return path.join(os.homedir(), ".TaskSync", "captured");
}

function getCapturedTaskDir(taskId: string): string {
  return path.join(getCapturedTasksDir(), taskId);
}

function getCapturedTaskFile(taskId: string): string {
  return path.join(getCapturedTaskDir(taskId), "capture.json");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaptureInput {
  title: string;
  summary: string;
  workspacePath?: string;
  transcript?: string;
  decisions?: string[];
  todos?: string[];
  touchedFiles?: string[];
  sourceApp?: string;
  tags?: string[];
}

export interface CapturedRecord extends CaptureInput {
  id: string;
  capturedAt: string;
  updatedAt: string;
}

export interface CaptureResult {
  taskId: string;
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateCapturedTaskId(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `cap_${ts}_${rand}`;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function createCapturedTask(input: CaptureInput): CaptureResult {
  const taskId = generateCapturedTaskId();
  const now = new Date().toISOString();

  const record: CapturedRecord = {
    ...input,
    id: taskId,
    capturedAt: now,
    updatedAt: now,
    decisions: input.decisions ?? [],
    todos: input.todos ?? [],
    touchedFiles: input.touchedFiles ?? [],
    tags: input.tags ?? [],
  };

  const taskDir = getCapturedTaskDir(taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(getCapturedTaskFile(taskId), JSON.stringify(record, null, 2) + "\n", "utf8");

  return { taskId, capturedAt: now };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function listCapturedTasks(): CapturedRecord[] {
  const dir = getCapturedTasksDir();
  if (!fs.existsSync(dir)) return [];

  const records: CapturedRecord[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("cap_")) continue;
      const record = readCaptureFile(entry.name);
      if (record) records.push(record);
    }
  } catch {
    return [];
  }

  return records.sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()
  );
}

export function getCapturedTask(taskId: string): CapturedRecord | undefined {
  return readCaptureFile(taskId);
}

function readCaptureFile(taskId: string): CapturedRecord | undefined {
  const filePath = getCapturedTaskFile(taskId);
  if (!fs.existsSync(filePath)) return undefined;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as CapturedRecord;
    if (!parsed.id || !parsed.title) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

const ROLE_PATTERNS: Array<{ role: string; regex: RegExp }> = [
  { role: "user",      regex: /^\s*(\[?(?:user|human)\]?:?\s*)/i },
  { role: "assistant", regex: /^\s*(\[?(?:assistant|ai|model)\]?:?\s*)/i },
];

/**
 * Parses a free-form transcript string into normalized transcript entries.
 *
 * Supports common patterns:
 *   [User]: ...      User: ...      Human: ...
 *   [Assistant]: ... Assistant: ... AI: ...
 *
 * Falls back to a single "user" entry if no role markers are detected.
 * Also surfaces decisions and todos as additional entries if transcript is absent.
 */
export function readCapturedTranscript(taskId: string): CapturedTranscriptEntry[] {
  const record = getCapturedTask(taskId);
  if (!record) return [];

  const entries: CapturedTranscriptEntry[] = [];

  if (record.transcript && record.transcript.trim()) {
    const lines = record.transcript.split(/\r?\n/);
    let currentRole = "user";
    let buffer: string[] = [];
    let index = 0;

    const flush = () => {
      const content = buffer.join("\n").trim();
      if (content) {
        index++;
        entries.push({ index, role: currentRole, content });
      }
      buffer = [];
    };

    for (const line of lines) {
      let matched = false;
      for (const { role, regex } of ROLE_PATTERNS) {
        const m = line.match(regex);
        if (m) {
          flush();
          currentRole = role;
          const rest = line.slice(m[0].length).trim();
          if (rest) buffer.push(rest);
          matched = true;
          break;
        }
      }
      if (!matched) {
        buffer.push(line);
      }
    }
    flush();

    // If no role markers were found, the entire transcript is one user entry
    if (entries.length === 0 && record.transcript.trim()) {
      entries.push({ index: 1, role: "user", content: record.transcript.trim() });
    }
  }

  // Append summary as a synthetic first entry if no transcript
  if (entries.length === 0) {
    entries.push({ index: 1, role: "user", content: record.summary });
  }

  // Append decisions and todos as structured assistant entries
  const structuredLines: string[] = [];
  if (record.decisions && record.decisions.length > 0) {
    structuredLines.push("Key decisions:");
    record.decisions.forEach((d) => structuredLines.push(`  • ${d}`));
  }
  if (record.todos && record.todos.length > 0) {
    structuredLines.push("Open todos:");
    record.todos.forEach((t) => structuredLines.push(`  • ${t}`));
  }
  if (structuredLines.length > 0) {
    entries.push({
      index: entries.length + 1,
      role: "assistant",
      content: structuredLines.join("\n"),
    });
  }

  return entries;
}
