import fs from "fs";
import path from "path";
import { IProvider, ProviderRoot } from "../../providers/interface";

// --- Workspace extraction from API conversation history ----------------------

const CWD_REGEX = /Current Working Directory \(([^)]+)\)/;
const WORKSPACE_CONFIG_MARKER = "# Workspace Configuration";

/** Extracted workspace details from the API conversation history. */
interface WorkspaceDetails {
  /** Full CWD path (e.g. "/Users/jose/Documents/GitHub/cline-web") */
  cwd?: string;
  /** Project hint from Workspace Configuration (e.g. "my-project") */
  hint?: string;
  /** Git remote URLs from Workspace Configuration */
  remoteUrls?: string[];
  /** Repo name extracted from remote URL (e.g. "trupix/cline-design") */
  repoName?: string;
}

/**
 * Extract workspace details from a Cline task's api_conversation_history.json.
 *
 * Cline embeds two useful blocks in the first user message:
 * - `Current Working Directory (/path/to/project)` — the CWD
 * - `# Workspace Configuration { ... }` — hint, git remotes, commit hash
 *
 * Returns a WorkspaceDetails object with whatever was found.
 */
function extractWorkspaceDetails(taskPath: string): WorkspaceDetails {
  const apiHistoryPath = path.join(taskPath, "api_conversation_history.json");
  const details: WorkspaceDetails = {};
  if (!fs.existsSync(apiHistoryPath)) return details;

  try {
    const raw = fs.readFileSync(apiHistoryPath, "utf8");
    const messages = JSON.parse(raw);
    if (!Array.isArray(messages)) return details;

    // Check the first few messages
    for (const msg of messages.slice(0, 5)) {
      const content = msg?.content;
      const texts: string[] = [];

      if (typeof content === "string") {
        texts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const text = typeof block === "string" ? block : block?.text;
          if (typeof text === "string") texts.push(text);
        }
      }

      for (const text of texts) {
        // Extract CWD
        if (!details.cwd) {
          const cwdMatch = text.match(CWD_REGEX);
          if (cwdMatch) details.cwd = cwdMatch[1];
        }

        // Extract Workspace Configuration JSON (uses brace-counting for nested objects)
        if (!details.hint && text.includes(WORKSPACE_CONFIG_MARKER)) {
          const markerIdx = text.indexOf(WORKSPACE_CONFIG_MARKER);
          const jsonStart = text.indexOf("{", markerIdx);
          if (jsonStart !== -1) {
            // Find matching closing brace via depth counting
            let depth = 0;
            let jsonEnd = -1;
            for (let i = jsonStart; i < Math.min(jsonStart + 3000, text.length); i++) {
              if (text[i] === "{") depth++;
              else if (text[i] === "}") depth--;
              if (depth === 0) { jsonEnd = i; break; }
            }
            if (jsonEnd > jsonStart) {
              try {
                const config = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
                const workspaces = config?.workspaces;
                if (workspaces && typeof workspaces === "object") {
                  for (const [, wsData] of Object.entries(workspaces) as [string, any][]) {
                    if (wsData?.hint) details.hint = wsData.hint;
                    if (Array.isArray(wsData?.associatedRemoteUrls) && wsData.associatedRemoteUrls.length > 0) {
                      details.remoteUrls = wsData.associatedRemoteUrls;
                      const remoteStr = wsData.associatedRemoteUrls[0];
                      const repoMatch = remoteStr.match(/github\.com[:/]([^/]+\/[^/.\s]+)/);
                      if (repoMatch) details.repoName = repoMatch[1];
                    }
                    break;
                  }
                }
              } catch {
                // JSON parse failed — skip
              }
            }
          }
        }
      }

      // Stop once we have both
      if (details.cwd && details.hint) break;
    }
  } catch {
    // Ignore parse errors — file may be corrupted or very large
  }

  return details;
}

/**
 * Legacy wrapper: just returns CWD from api_conversation_history.
 */
function extractWorkspaceFromApiHistory(taskPath: string): string | undefined {
  return extractWorkspaceDetails(taskPath).cwd;
}

/**
 * Extract just the project name from a full workspace path.
 * e.g. "/Users/jose/Documents/GitHub/cline-web" ? "cline-web"
 */
export function projectNameFromWorkspace(workspace: string | undefined): string | undefined {
  if (!workspace) return undefined;
  return path.basename(workspace);
}

// --- OpenClaw JSONL session reader -------------------------------------------

function getOpenClawTasks(provider: IProvider, root: ProviderRoot): TaskSummary[] {
  const tasks: TaskSummary[] = [];
  const agentsDir = path.join(root.path, "agents");
  if (!fs.existsSync(agentsDir)) return tasks;

  let agentIds: string[] = [];
  try {
    agentIds = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch { return tasks; }

  for (const agentId of agentIds) {
    const sessionsDir = path.join(agentsDir, agentId, "sessions");
    if (!fs.existsSync(sessionsDir)) continue;

    let files: string[] = [];
    try {
      files = fs.readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".jsonl"));
    } catch { continue; }

    for (const file of files) {
      const sessionId = file.slice(0, -6); // strip .jsonl
      const taskId = `${agentId}/${sessionId}`;
      const filePath = path.join(sessionsDir, file);
      let title = `Session ${sessionId.substring(0, 12)}`;
      let updatedAt = new Date().toISOString();

      try {
        const stat = fs.statSync(filePath);
        updatedAt = stat.mtime.toISOString();

        // Read first line to get first user message as title
        const raw = fs.readFileSync(filePath, "utf8");
        const lines = raw.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.role === "user") {
              const content = msg.content;
              if (typeof content === "string" && content.trim()) {
                title = content.substring(0, 500);
              } else if (Array.isArray(content)) {
                const textBlock = content.find(
                  (b: any) => b.type === "text" && b.text
                );
                if (textBlock) title = (textBlock as any).text.substring(0, 500);
              }
              break;
            }
          } catch { /* skip */ }
        }
      } catch { /* ignore */ }

      tasks.push({
        taskId,
        title,
        updatedAt,
        status: "completed",
        origin: {
          provider: provider.getProviderName(),
          rootId: root.id,
          rootLabel: root.label,
        },
      });
    }
  }

  return tasks.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export interface TaskSummary {
  taskId: string;
  title: string;
  updatedAt: string;
  status: string;
  workspace?: string;
  /** Git repo name from Workspace Configuration (e.g. "trupix/cline-design") */
  repoName?: string;
  /** Project hint from Workspace Configuration (e.g. "my-project") */
  projectHint?: string;
  origin: {
    provider: string;
    rootId: string;
    rootLabel: string;
  };
  imported?: boolean;
  provenance?: any;
}

export function getTasksForRoot(provider: IProvider, root: ProviderRoot): TaskSummary[] {
  // OpenClaw uses JSONL sessions, not Cline-style tasks/ directories
  if (provider.getProviderName() === "openclaw") {
    return getOpenClawTasks(provider, root);
  }

  const tasksDir = path.join(root.path, "tasks");
  if (!fs.existsSync(tasksDir)) return [];

  const tasks: TaskSummary[] = [];
  const entries = fs.readdirSync(tasksDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const taskId = entry.name;
    const taskPath = path.join(tasksDir, taskId);
    
    let title = `Task ${taskId.substring(0, 8)}`;
    let updatedAt = new Date().toISOString();
    let imported = false;
    let provenance = undefined;
    let workspace: string | undefined = undefined;

    // Try to read workspace from history_item.json (Roo) or _index.json
    const historyItemPath = path.join(taskPath, "history_item.json");
    if (fs.existsSync(historyItemPath)) {
      try {
        const hi = JSON.parse(fs.readFileSync(historyItemPath, "utf8"));
        workspace = hi.workspace;
      } catch { /* ignore */ }
    }

    // Extract rich workspace details from api_conversation_history.json (Cline)
    // Includes CWD, project hint, and git repo name
    let repoName: string | undefined = undefined;
    let projectHint: string | undefined = undefined;
    const wsDetails = extractWorkspaceDetails(taskPath);

    if (!workspace && wsDetails.cwd) {
      workspace = wsDetails.cwd;
    }
    if (wsDetails.hint) projectHint = wsDetails.hint;
    if (wsDetails.repoName) repoName = wsDetails.repoName;

    // Try to read ui_messages.json or conversation.json to infer title
    const uiMessagesPath = path.join(taskPath, "ui_messages.json");
    if (fs.existsSync(uiMessagesPath)) {
      try {
        const stat = fs.statSync(uiMessagesPath);
        updatedAt = stat.mtime.toISOString();
        
        const raw = fs.readFileSync(uiMessagesPath, "utf8");
        const messages = JSON.parse(raw);
        if (Array.isArray(messages) && messages.length > 0) {
          const firstMsg = messages.find(m => m.type === "say" && m.say === "task" && m.text);
          if (firstMsg) {
            title = firstMsg.text;
          } else {
            // Fallback if no explicit 'task' message is found
            const anyTextMsg = messages.find(m => m.text);
            if (anyTextMsg) {
              try {
                // Sometimes the text is a JSON string containing the request
                const parsedText = JSON.parse(anyTextMsg.text);
                if (parsedText.request) {
                  // Try to extract just the <task> part if it exists
                  const taskMatch = parsedText.request.match(/<task>\n([\s\S]*?)\n<\/task>/);
                  title = taskMatch ? taskMatch[1].trim() : parsedText.request.substring(0, 500);
                } else {
                  title = anyTextMsg.text.substring(0, 500);
                }
              } catch {
                title = anyTextMsg.text.substring(0, 500);
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Check for provenance
    const provenancePath = path.join(taskPath, ".TaskSync_provenance.json");
    if (fs.existsSync(provenancePath)) {
      try {
        provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
        imported = true;
        if (provenance.title) title = `[Imported] ${provenance.title}`;
      } catch {
        // ignore
      }
    }

    tasks.push({
      taskId,
      title,
      updatedAt,
      status: "completed", // simplified for MVP
      workspace,
      repoName,
      projectHint,
      origin: {
        provider: provider.getProviderName(),
        rootId: root.id,
        rootLabel: root.label
      },
      imported,
      provenance
    });
  }

  // Sort newest first
  return tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
