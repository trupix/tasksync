import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { IProvider, ProviderRoot } from "../../providers/interface";

export interface ExportBundle {
  bundleVersion: number;
  exportedAt: string;
  from: {
    provider: string;
    rootId: string;
    rootLabel: string;
    taskId: string;
  };
  title: string;
  notes: string;
  filesIncluded: string[];
  /** Workspace path from the source task, so the target provider shows it under the right workspace. */
  workspace?: string;
}

export async function exportTaskBundle(
  provider: IProvider,
  root: ProviderRoot,
  taskId: string,
  title: string
): Promise<string> {
  const sourceTaskDir = path.join(root.path, "tasks", taskId);
  if (!fs.existsSync(sourceTaskDir)) {
    throw new Error(`Task directory not found: ${sourceTaskDir}`);
  }

  const timestamp = Date.now().toString();
  const bundleDir = path.join(os.homedir(), ".TaskSync", "bundles", provider.getProviderName(), taskId, timestamp);
  
  fs.mkdirSync(bundleDir, { recursive: true });

  const filesIncluded: string[] = [];
  
  // Copy all files from task dir
  const entries = fs.readdirSync(sourceTaskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      fs.copyFileSync(
        path.join(sourceTaskDir, entry.name),
        path.join(bundleDir, entry.name)
      );
      filesIncluded.push(entry.name);
    }
  }

  // Try to detect the source task's workspace so it survives the migration.
  // Roo stores it in history_item.json; Cline stores it in globalState.json.
  let detectedWorkspace: string | undefined;
  const historyItemPath = path.join(sourceTaskDir, "history_item.json");
  if (fs.existsSync(historyItemPath)) {
    try {
      detectedWorkspace = JSON.parse(fs.readFileSync(historyItemPath, "utf8"))?.workspace;
    } catch { /* ignore */ }
  }
  if (!detectedWorkspace) {
    // Cline / Kilo: workspace lives in the root-level globalState.json
    const globalStatePath = path.join(root.path, "globalState.json");
    if (fs.existsSync(globalStatePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(globalStatePath, "utf8"));
        const entry = (state.taskHistory || []).find((e: any) => e.id === taskId);
        detectedWorkspace = entry?.workspace;
      } catch { /* ignore */ }
    }
  }

  const bundleMeta: ExportBundle = {
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    from: {
      provider: provider.getProviderName(),
      rootId: root.id,
      rootLabel: root.label,
      taskId
    },
    title,
    notes: "Best-effort export; may not include checkpoints",
    filesIncluded,
    ...(detectedWorkspace ? { workspace: detectedWorkspace } : {}),
  };

  fs.writeFileSync(
    path.join(bundleDir, "bundle.json"),
    JSON.stringify(bundleMeta, null, 2),
    "utf8"
  );

  return bundleDir;
}

/**
 * Strips non-standard fields from api_conversation_history that some providers
 * add but the Anthropic API rejects. Specifically, Cline adds "summary: []" to
 * thinking content blocks, which causes "Extra inputs are not permitted" errors
 * when the history is replayed in another provider.
 */
function sanitizeConversationHistory(history: any[]): any[] {
  if (!Array.isArray(history)) return history;
  return history.map((message) => {
    if (!message || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((block: any) => {
        if (!block || block.type !== "thinking") return block;
        // Remove any fields not accepted by the Anthropic API thinking block spec
        const { type, thinking, signature } = block;
        return { type, thinking, signature };
      }),
    };
  });
}

export async function importTaskBundle(
  targetProvider: IProvider,
  targetRoot: ProviderRoot,
  bundleDir: string
): Promise<string> {
  const bundleMetaPath = path.join(bundleDir, "bundle.json");
  if (!fs.existsSync(bundleMetaPath)) {
    throw new Error(`Invalid bundle: missing bundle.json at ${bundleDir}`);
  }

  const bundleMeta = JSON.parse(fs.readFileSync(bundleMetaPath, "utf8")) as ExportBundle;
  
  // Generate a proper UUID-format task ID (matches what Roo/Cline expect)
  const newTaskId = uuidv4();
  const targetTaskDir = path.join(targetRoot.path, "tasks", newTaskId);
  
  fs.mkdirSync(targetTaskDir, { recursive: true });

  // Files that are provider-specific and should NOT be copied cross-provider
  const providerSpecificFiles: Record<string, string[]> = {
    cline: ["task_metadata.json", "focus_chain_taskid_"],   // Cline-only files
  };
  const fromProvider = bundleMeta.from.provider;
  const toProvider = targetProvider.getProviderName();
  const skipPrefixes = fromProvider !== toProvider
    ? (providerSpecificFiles[fromProvider] || [])
    : [];

  // Copy compatible files from bundle (skip provider-specific ones when cross-migrating)
  for (const file of bundleMeta.filesIncluded) {
    const shouldSkip = skipPrefixes.some(prefix => file.startsWith(prefix));
    if (shouldSkip) continue;
    const src = path.join(bundleDir, file);
    if (!fs.existsSync(src)) continue;

    // Sanitize api_conversation_history.json on cross-provider migration:
    // Cline stores thinking blocks with a non-standard "summary" field that
    // the Anthropic API rejects as "Extra inputs are not permitted".
    if (fromProvider !== toProvider && file === "api_conversation_history.json") {
      try {
        const raw = JSON.parse(fs.readFileSync(src, "utf8"));
        const sanitized = sanitizeConversationHistory(raw);
        fs.writeFileSync(
          path.join(targetTaskDir, file),
          JSON.stringify(sanitized),
          "utf8"
        );
      } catch {
        // If parsing fails for any reason, copy as-is
        fs.copyFileSync(src, path.join(targetTaskDir, file));
      }
    } else {
      fs.copyFileSync(src, path.join(targetTaskDir, file));
    }
  }

  // Write provenance
  fs.writeFileSync(
    path.join(targetTaskDir, ".TaskSync_provenance.json"),
    JSON.stringify({
      importedFrom: bundleMeta.from,
      importedAt: new Date().toISOString(),
      bundlePath: bundleDir,
      title: bundleMeta.title
    }, null, 2),
    "utf8"
  );

  // Inject into the provider's history index so the extension UI actually sees it
  // Roo uses tasks/_index.json + per-task history_item.json
  // Cline uses globalState.json
  const rooIndexPath = path.join(targetRoot.path, "tasks", "_index.json");
  const clineStatePath = path.join(targetRoot.path, "globalState.json");

  const ts = Date.now();
  const taskLabel = `[Imported from ${bundleMeta.from.provider}] ${bundleMeta.title}`;

  const historyItem = {
    id: newTaskId,
    ts,
    task: taskLabel,
    tokensIn: 0,
    tokensOut: 0,
    totalCost: 0
  };

  if (targetProvider.getProviderName() === "roo" || fs.existsSync(rooIndexPath)) {
    // Roo architecture uses _index.json with an "entries" array
    let indexData = { version: 1, updatedAt: ts, entries: [] as any[] };
    if (fs.existsSync(rooIndexPath)) {
      try {
        indexData = JSON.parse(fs.readFileSync(rooIndexPath, "utf8"));
        if (!indexData.entries) indexData.entries = [];
      } catch (e) {
        console.error("Failed to read Roo _index.json:", e);
      }
    }
    
    // Roo requires specific fields to render in the UI
    const rooHistoryItem = {
      id: newTaskId,
      number: indexData.entries.length > 0 ? Math.max(...indexData.entries.map((e: any) => e.number || 0)) + 1 : 1,
      ts,
      task: taskLabel,
      tokensIn: 0,
      tokensOut: 0,
      cacheWrites: 0,
      cacheReads: 0,
      totalCost: 0,
      size: 0,
      // Keep workspace as "Imported Task" so the task always appears in Roo's "All"
      // view regardless of which VS Code workspace is currently open. Users can update
      // the workspace via the dashboard's "Set Workspace" button to move it to the
      // correct project filter.
      workspace: "Imported Task",
      mode: "code",
      apiConfigName: "default"
    };

    indexData.entries.unshift(rooHistoryItem);
    indexData.updatedAt = ts;
    
    try {
      fs.writeFileSync(rooIndexPath, JSON.stringify(indexData), "utf8");
    } catch (e) {
      console.error("Failed to write Roo _index.json:", e);
    }

    // CRITICAL: Roo also requires a history_item.json inside each task folder
    fs.writeFileSync(
      path.join(targetTaskDir, "history_item.json"),
      JSON.stringify(rooHistoryItem),
      "utf8"
    );
  } else {
    // Cline / Kilo architecture
    let stateData = { taskHistory: [] as any[] };
    if (fs.existsSync(clineStatePath)) {
      try {
        stateData = JSON.parse(fs.readFileSync(clineStatePath, "utf8"));
        if (!stateData.taskHistory) stateData.taskHistory = [];
      } catch (e) {
        console.error("Failed to read globalState.json:", e);
      }
    }
    stateData.taskHistory.unshift(historyItem);
    try {
      fs.writeFileSync(clineStatePath, JSON.stringify(stateData, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to write globalState.json:", e);
    }
  }

  return newTaskId;
}
