import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { ClineProvider } from "../providers/cline";
import { RooProvider } from "../providers/roo";
import { KiloProvider } from "../providers/kilo";
import { OpenClawProvider } from "../providers/openclaw";
import { IProvider, ProviderRoot } from "../providers/interface";
import { runInit, runSync } from "../core/sync";
import { getTasksForRoot } from "../core/tasks/indexer";
import { exportTaskBundle, importTaskBundle } from "../core/tasks/migration";
import {
  redactTokens,
  isValidProvider,
  isValidId,
  isValidRootId,
  getDashboardToken,
  verifyDashboardToken,
  safePath,
  safeRmDir,
  safeReadFile,
  safeWriteFile,
} from "../utils/security";
import { readManifest, TaskSync_VERSION } from "../utils/manifest";

// --- Logo (read once at startup, embedded inline in HTML) --------------------
let LOGO_SVG = "";
try {
  LOGO_SVG = fs.readFileSync(path.join(__dirname, "../../src/tasksync.svg"), "utf8")
    // Strip XML declaration (not valid in HTML)
    .replace(/<\?xml[^?]*\?>\s*/i, "")
    // Remove internal <style> block — replace with explicit fill attributes below
    .replace(/<style[\s\S]*?<\/style>/i, "")
    // Inline the fill colors directly on elements
    .replace(/class="cls-1"/g, 'fill="#00cb7b"')
    .replace(/class="cls-2"/g, 'fill="#231f20"')
    // Inject explicit size on the <svg> element
    .replace(/<svg\b/, '<svg width="40" height="40" style="display:block;flex-shrink:0;"')
    .trim();
} catch {
  // File not found — header renders without logo
}

// --- Icon SVGs (embedded inline — source files can be deleted) ---------------
const ICON_REFRESH = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
const ICON_EYE    = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_TRASH  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const ICON_LINK   = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`;
const ICON_FOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
const ICON_SAVE   = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>`;
const ICON_INFO   = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;

// --- Instrumentation helper --------------------------------------------------

function timedLog(label: string, startMs: number, extra?: Record<string, unknown>): void {
  const durationMs = Date.now() - startMs;
  const entry: Record<string, unknown> = { op: label, durationMs, ts: new Date().toISOString() };
  if (extra) Object.assign(entry, extra);
  console.log(JSON.stringify(entry));
}

/** Safe error responder: redacts any embedded tokens before sending. */
function safeErr(res: express.Response, status: number, message: string) {
  res.status(status).json({ error: redactTokens(message) });
}

export async function startDashboard(port: number, openBrowser: boolean) {
  const app = express();
  app.use(cors({ origin: `http://127.0.0.1:${port}` }));
  app.use(express.json({ limit: "2mb" }));

  // -- Dashboard auth token (generated once per process) -------------------
  const authToken = getDashboardToken();

  // -- Auth middleware for mutating routes ----------------------------------
  // POST, PATCH, DELETE require x-TaskSync-token header.
  // GET (read-only) routes are open.
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const headerVal = req.headers["x-tasksync-token"] as string | undefined;
    if (!verifyDashboardToken(headerVal)) {
      res.status(401).json({ error: "Unauthorized: missing or invalid x-tasksync-token header" });
      return;
    }
    next();
  }

  const providers: IProvider[] = [
    new ClineProvider(),
    new RooProvider(),
    new KiloProvider(),
    new OpenClawProvider(),
  ];

  function getProvider(name: string): IProvider {
    const p = providers.find(p => p.getProviderName() === name);
    if (!p) throw new Error(`Provider ${name} not found`);
    return p;
  }

  function getRoot(provider: IProvider, rootId: string): ProviderRoot {
    const root = provider.getRoots().find(r => r.id === rootId);
    if (!root) throw new Error(`Root ${rootId} not found for provider ${provider.getProviderName()}`);
    return root;
  }

  // --- Health endpoint -----------------------------------------------------

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      version: TaskSync_VERSION,
      providers: providers.map(p => ({
        name: p.getProviderName(),
        roots: p.getRoots().map(r => ({
          id: r.id,
          label: r.label,
          initialized: p.validateRoot(r.path),
        })),
      })),
    });
  });

  // --- API Routes ----------------------------------------------------------

  app.get("/api/providers", (req, res) => {
    const result = providers.map(p => ({
      name: p.getProviderName(),
      roots: p.getRoots().map(r => ({
        id: r.id,
        label: r.label,
        path: r.path,
        isInitialized: p.validateRoot(r.path),
      }))
    }));
    res.json({ providers: result });
  });

  app.post("/api/init", requireAuth, async (req, res) => {
    try {
      const { provider, rootId, repoUrl, pat } = req.body;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      if (typeof repoUrl !== "string" || !repoUrl.startsWith("http")) return void safeErr(res, 400, "Invalid repoUrl");
      const p = getProvider(provider);
      const r = getRoot(p, rootId);
      await runInit(p, r.id, r.path, r.label, { repoUrl, pat });
      res.json({ success: true });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.post("/api/sync", requireAuth, async (req, res) => {
    try {
      const { provider, rootId } = req.body;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      const p = getProvider(provider);
      const r = getRoot(p, rootId);
      await runSync(p, r.path);
      res.json({ success: true });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.get("/api/tasks", (req, res) => {
    try {
      const { provider, rootId } = req.query;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid or missing provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid or missing rootId");
      const p = getProvider(provider as string);
      const r = getRoot(p, rootId as string);
      const tasks = getTasksForRoot(p, r);
      res.json(tasks);
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.delete("/api/tasks", requireAuth, async (req, res) => {
    try {
      const { provider, rootId, taskId } = req.query;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      if (!isValidId(taskId)) return void safeErr(res, 400, "Invalid taskId");
      const p = getProvider(provider as string);
      const r = getRoot(p, rootId as string);

      // 1. Remove task folder
      safeRmDir(path.join(r.path, "tasks"), taskId as string);

      // 2. Remove from index (Roo or Cline)
      const rooIndexPath = path.join(r.path, "tasks", "_index.json");
      const clineStatePath = path.join(r.path, "globalState.json");

      if (fs.existsSync(rooIndexPath)) {
        const idx = JSON.parse(safeReadFile(path.join(r.path, "tasks"), "_index.json"));
        idx.entries = (idx.entries || []).filter((e: any) => e.id !== taskId);
        idx.updatedAt = Date.now();
        safeWriteFile(path.join(r.path, "tasks"), "_index.json", JSON.stringify(idx));
      } else if (fs.existsSync(clineStatePath)) {
        const state = JSON.parse(safeReadFile(r.path, "globalState.json"));
        state.taskHistory = (state.taskHistory || []).filter((e: any) => e.id !== taskId);
        safeWriteFile(r.path, "globalState.json", JSON.stringify(state, null, 2));
      }

      res.json({ success: true });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.patch("/api/tasks/workspace", requireAuth, async (req, res) => {
    try {
      const { provider, rootId, taskId, newWorkspace } = req.body;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      if (!isValidId(taskId)) return void safeErr(res, 400, "Invalid taskId");
      if (typeof newWorkspace !== "string" || newWorkspace.trim() === "") return void safeErr(res, 400, "Invalid newWorkspace");
      const p = getProvider(provider as string);
      const r = getRoot(p, rootId as string);

      // Update _index.json (Roo)
      const rooIndexPath = path.join(r.path, "tasks", "_index.json");
      if (fs.existsSync(rooIndexPath)) {
        const idx = JSON.parse(safeReadFile(path.join(r.path, "tasks"), "_index.json"));
        const entry = (idx.entries || []).find((e: any) => e.id === taskId);
        if (entry) {
          entry.workspace = newWorkspace;
          idx.updatedAt = Date.now();
          safeWriteFile(path.join(r.path, "tasks"), "_index.json", JSON.stringify(idx));
        }
        // Also update history_item.json in the task folder
        const historyItemPath = safePath(path.join(r.path, "tasks"), `${taskId}/history_item.json`);
        if (fs.existsSync(historyItemPath)) {
          const hi = JSON.parse(safeReadFile(path.join(r.path, "tasks"), `${taskId}/history_item.json`));
          hi.workspace = newWorkspace;
          safeWriteFile(path.join(r.path, "tasks"), `${taskId}/history_item.json`, JSON.stringify(hi));
        }
      }

      // Update globalState.json (Cline/Kilo)
      const clineStatePath = path.join(r.path, "globalState.json");
      if (fs.existsSync(clineStatePath)) {
        const state = JSON.parse(safeReadFile(r.path, "globalState.json"));
        const entry = (state.taskHistory || []).find((e: any) => e.id === taskId);
        if (entry) {
          entry.workspace = newWorkspace;
          safeWriteFile(r.path, "globalState.json", JSON.stringify(state, null, 2));
        }
      }

      res.json({ success: true });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.post("/api/migrate", requireAuth, async (req, res) => {
    try {
      const { fromProvider, fromRootId, taskId, toProvider, toRootId } = req.body;
      if (!isValidProvider(fromProvider)) return void safeErr(res, 400, "Invalid fromProvider");
      if (!isValidProvider(toProvider)) return void safeErr(res, 400, "Invalid toProvider");
      if (!isValidRootId(fromRootId)) return void safeErr(res, 400, "Invalid fromRootId");
      if (!isValidRootId(toRootId)) return void safeErr(res, 400, "Invalid toRootId");
      if (!isValidId(taskId)) return void safeErr(res, 400, "Invalid taskId");

      const pFrom = getProvider(fromProvider);
      const rFrom = getRoot(pFrom, fromRootId);

      const pTo = getProvider(toProvider);
      const rTo = getRoot(pTo, toRootId);

      const bundleDir = await exportTaskBundle(pFrom, rFrom, taskId, req.body.title || "Migrated Task");
      const newTaskId = await importTaskBundle(pTo, rTo, bundleDir);
      res.json({ success: true, newTaskId });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  // --- Task Board (/) ------------------------------------------------------

  app.get("/", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>TaskSync</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
          .board { display: flex; gap: 20px; overflow-x: auto; padding-bottom: 20px; }
          .column { background: white; border-radius: 8px; padding: 16px; min-width: 300px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .task { background: #fff; border: 1px solid #e4e4e7; padding: 12px; margin-bottom: 8px; border-radius: 6px; cursor: grab; position: relative; }
          .task:active { cursor: grabbing; }
          .task-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; padding-right: 24px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
          .task-meta { font-size: 12px; color: #71717a; display: flex; justify-content: space-between; align-items: center; }
          .task-workspace { font-size: 11px; color: #6366f1; background: #eef2ff; padding: 1px 6px; border-radius: 3px; font-weight: 500; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .badge { background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; vertical-align: middle; margin-left: 4px; }
          .btn { background: #18181b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
          .btn:hover { background: #27272a; }
          .task-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
          .task-icon { cursor: pointer; opacity: 0.4; font-size: 14px; padding: 2px; border-radius: 3px; }
          .task-icon:hover { opacity: 1; background: #f4f4f5; }

          /* Modal Styles */
          .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
          .modal { background: white; padding: 24px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .modal-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
          .modal-title { margin: 0; font-size: 18px; font-weight: 600; }
          .close-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: #71717a; padding: 0; }
          .close-btn:hover { color: #18181b; }
          .modal-body { font-size: 14px; color: #3f3f46; line-height: 1.5; }
          .modal-body strong { color: #18181b; }
          .modal-section { margin-bottom: 12px; }
          .pre-wrap { white-space: pre-wrap; background: #f4f4f5; padding: 12px; border-radius: 6px; border: 1px solid #e4e4e7; font-family: monospace; font-size: 12px; }
          .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 18px; border-radius: 6px; font-size: 13px; color: white; max-width: 420px; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.2); animation: fadeIn 0.2s ease; pointer-events: none; }
          .toast-success { background: #18181b; }
          .toast-error { background: #dc2626; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; flex-shrink:0;">${LOGO_SVG}</div>
            <h1 style="margin:0">TaskSync</h1>
          </div>
          <button class="btn" onclick="load()" style="padding: 8px 16px; font-size: 14px; display:inline-flex; align-items:center; gap:6px;">${ICON_REFRESH} Refresh Tasks</button>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <p style="margin:0; color:#71717a; font-size:13px;">Drag and drop tasks between providers to migrate them.</p>
          <div id="columnToggles" style="display:flex; gap:10px; align-items:center; font-size:12px; color:#71717a;"></div>
        </div>
        <div class="board" id="board">Loading...</div>

        <!-- Modal -->
        <div class="modal-overlay" id="taskModal" onclick="if(event.target === this) closeModal()">
          <div class="modal">
            <div class="modal-header">
              <h2 class="modal-title">Task Details</h2>
              <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body" id="modalContent"></div>
          </div>
        </div>

        <script>
          // Auth token injected server-side — transparent to user
          var __TaskSync_TOKEN = '${authToken}';
          function authHeaders(h) { var o = Object.assign({}, h || {}); o['x-tasksync-token'] = __TaskSync_TOKEN; return o; }

          let draggedTask = null;
          let allTasks = new Map();
          let currentModalTask = null;

          // -- Column visibility (persisted in localStorage) --------------
          function getColumnKey(providerName, rootId) {
            return providerName + ':' + rootId;
          }

          function getHiddenColumns() {
            try {
              return JSON.parse(localStorage.getItem('TaskSync_hidden_columns') || '[]');
            } catch { return []; }
          }

          function setHiddenColumns(hidden) {
            localStorage.setItem('TaskSync_hidden_columns', JSON.stringify(hidden));
          }

          function isColumnVisible(providerName, rootId) {
            return !getHiddenColumns().includes(getColumnKey(providerName, rootId));
          }

          function toggleColumn(providerName, rootId) {
            const key = getColumnKey(providerName, rootId);
            const hidden = getHiddenColumns();
            const idx = hidden.indexOf(key);
            if (idx >= 0) hidden.splice(idx, 1);
            else hidden.push(key);
            setHiddenColumns(hidden);

            const isNowVisible = !hidden.includes(key);

            // Instantly show/hide the pre-rendered column — no re-fetch
            const col = document.querySelector('.column[data-col-key="' + key + '"]');
            if (col) col.style.display = isNowVisible ? '' : 'none';

            // Update toggle label colour
            const toggleLabel = document.querySelector('label[data-toggle-key="' + key + '"]');
            if (toggleLabel) toggleLabel.style.background = isNowVisible ? '#e0f2fe' : '#f4f4f5';
          }

          function showModal(taskId) {
            const t = allTasks.get(taskId);
            if (!t) return;
            currentModalTask = t;

            const content = document.getElementById('modalContent');

            let provenanceHtml = '';
            if (t.imported && t.provenance) {
              provenanceHtml = \`
                <div class="modal-section">
                  <strong>Provenance:</strong>
                  <div style="margin-top: 4px; padding: 8px; background: #fefce8; border: 1px solid #fef08a; border-radius: 4px;">
                    Imported from <b>\${t.provenance.importedFrom?.provider || 'Unknown'}</b>
                    (\${t.provenance.importedFrom?.rootLabel || 'Unknown'})<br>
                    Original Task ID: \${t.provenance.importedFrom?.taskId || 'Unknown'}<br>
                    Imported At: \${new Date(t.provenance.importedAt).toLocaleString()}
                  </div>
                </div>
              \`;
            }

            const currentWorkspace = t.workspace || 'Unknown';

            content.innerHTML = \`
              <div class="modal-section">
                <strong>Task ID:</strong> \${t.taskId}
              </div>
              <div class="modal-section">
                <strong>Last Updated:</strong> \${new Date(t.updatedAt).toLocaleString()}
              </div>
              <div class="modal-section">
                <strong>Provider:</strong> <span style="text-transform: capitalize;">\${t.origin.provider}</span> (\${t.origin.rootLabel})
              </div>
              <div class="modal-section">
                <strong>Workspace:</strong>
                <div style="display:flex; gap:8px; margin-top:6px; align-items:center;">
                  <input id="workspaceInput" type="text" value="\${currentWorkspace}"
                    style="flex:1; padding:6px 10px; border:1px solid #e4e4e7; border-radius:4px; font-size:13px; font-family:monospace;"
                    placeholder="/path/to/your/project" />
                  <button class="btn" onclick="saveWorkspace()" style="white-space:nowrap; display:inline-flex; align-items:center; gap:4px;">${ICON_SAVE} Save</button>
                </div>
                <div style="font-size:11px; color:#71717a; margin-top:4px;">
                  Change this to make the task appear under a different workspace in Roo's "Current" filter.
                </div>
              </div>
              \${provenanceHtml}
              <div class="modal-section">
                <strong>Initial Prompt / Title:</strong>
                <div class="pre-wrap">\${t.title}</div>
              </div>
            \`;

            document.getElementById('taskModal').style.display = 'flex';
          }

          async function saveWorkspace() {
            const t = currentModalTask;
            if (!t) return;
            const newWorkspace = document.getElementById('workspaceInput').value.trim();
            if (!newWorkspace) { alert('Workspace path cannot be empty'); return; }

            const res = await fetch('/api/tasks/workspace', {
              method: 'PATCH',
              headers: authHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                provider: t.origin.provider,
                rootId: t.origin.rootId,
                taskId: t.taskId,
                newWorkspace
              })
            });
            const data = await res.json();
            if (data.success) {
              toast('✓ Workspace updated! Reload VS Code to see the change in the extension.');
              closeModal();
              load();
            } else {
              toast('Error: ' + data.error, 'error');
            }
          }

          function closeModal() {
            document.getElementById('taskModal').style.display = 'none';
          }

          // CSS spinner (inline, no dependencies)
          const SPINNER_HTML = '<div style="display:flex;align-items:center;justify-content:center;padding:32px;color:#a1a1aa;font-size:12px;gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;flex-shrink:0"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading tasks...</div>';

          async function load() {
            const board = document.getElementById('board');
            board.innerHTML = '<div style="padding:32px;color:#a1a1aa;font-size:13px;">Loading...</div>';
            allTasks.clear();

            const res = await fetch('/api/providers');
            const { providers } = await res.json();

            board.innerHTML = '';

            // Build column toggle checkboxes
            const togglesEl = document.getElementById('columnToggles');
            togglesEl.innerHTML = '<span style="font-weight:600;">Columns:</span> ';
            for (const p of providers) {
              for (const r of p.roots) {
                const key = getColumnKey(p.name, r.id);
                const visible = isColumnVisible(p.name, r.id);
                const label = document.createElement('label');
                label.setAttribute('data-toggle-key', key);
                label.style.cssText = 'display:inline-flex; align-items:center; gap:3px; cursor:pointer; padding:2px 6px; border-radius:4px; background:' + (visible ? '#e0f2fe' : '#f4f4f5') + ';';
                label.innerHTML = '<input type="checkbox" ' + (visible ? 'checked' : '') + ' style="cursor:pointer;"> ' + p.name + ' (' + r.label + ')';
                label.querySelector('input').addEventListener('change', function() { toggleColumn(p.name, r.id); });
                togglesEl.appendChild(label);
              }
            }

            // ── Pass 1: render all column shells immediately (with spinners) ──
            const taskLists = new Map(); // key → taskList element
            for (const p of providers) {
              for (const r of p.roots) {
                const key = getColumnKey(p.name, r.id);
                const col = document.createElement('div');
                col.className = 'column';
                col.setAttribute('data-col-key', key);
                if (!isColumnVisible(p.name, r.id)) col.style.display = 'none';
                col.innerHTML = \`
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin:0; text-transform: capitalize; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                      \${p.name}
                      <span title="\${r.label}" style="color:#a1a1aa; cursor:help; line-height:1; user-select:none; display:inline-flex;" aria-label="\${r.label}">${ICON_INFO}</span>
                      <span style="font-size:10px; font-weight:600; color:#a16207; background:#fef9c3; border:1px solid #fde68a; padding:1px 6px; border-radius:4px; vertical-align:middle; display:\${r.isInitialized ? 'none' : 'inline'}">not detected</span>
                    </h3>
                    <button class="btn" onclick="sync('\${p.name}', '\${r.id}')" style="display:\${r.isInitialized ? 'inline-block' : 'none'}">Sync</button>
                  </div>
                  <div class="task-list" data-provider="\${p.name}" data-root="\${r.id}" style="min-height: 100px;"></div>
                \`;
                board.appendChild(col);

                const taskList = col.querySelector('.task-list');

                if (!r.isInitialized) {
                  taskList.innerHTML = \`
                    <div style="text-align:center; padding:24px 16px; background:#fafaf9; border:1px dashed #d4d4d8; border-radius:6px; color:#71717a;">
                      <div style="font-weight:600; font-size:13px; color:#3f3f46; margin-bottom:6px;">Provider not detected</div>
                      <div style="font-size:12px; line-height:1.5; margin-bottom:14px;">
                        Install and launch <strong>\${p.name}</strong> in VS Code<br>at least once to enable detection.
                      </div>
                      <button class="btn" style="font-size:11px; padding:4px 10px; background:#e4e4e7; color:#3f3f46;" onclick="load()">
                        Retry detection
                      </button>
                    </div>
                  \`;
                } else {
                  // Show spinner while tasks load
                  taskList.innerHTML = SPINNER_HTML;
                  taskLists.set(key, { taskList, p, r });

                  // Setup drag and drop
                  taskList.addEventListener('dragover', e => e.preventDefault());
                  taskList.addEventListener('drop', async e => {
                    e.preventDefault();
                    if (!draggedTask) return;
                    const toProvider = taskList.dataset.provider;
                    const toRootId = taskList.dataset.root;
                    if (draggedTask.provider === toProvider && draggedTask.rootId === toRootId) return;
                    if (confirm(\`Migrate task "\${draggedTask.title.substring(0, 30)}..." to \${toProvider}?\`)) {
                      const migrateRes = await fetch('/api/migrate', {
                        method: 'POST',
                        headers: authHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({
                          fromProvider: draggedTask.provider,
                          fromRootId: draggedTask.rootId,
                          taskId: draggedTask.taskId,
                          title: draggedTask.title,
                          toProvider,
                          toRootId
                        })
                      });
                      const migrateData = await migrateRes.json();
                      if (migrateData.success) {
                        toast('✓ Migrated to ' + toProvider);
                      } else {
                        toast('Migration failed: ' + (migrateData.error || 'Unknown error'), 'error');
                      }
                      load();
                    }
                  });
                }
              }
            }

            // ── Pass 2: fetch all tasks in parallel, populate as they arrive ──
            const fetchPromises = Array.from(taskLists.entries()).map(async ([key, { taskList, p, r }]) => {
              try {
                const tasksRes = await fetch(\`/api/tasks?provider=\${p.name}&rootId=\${r.id}\`);
                const tasks = await tasksRes.json();
                taskList.innerHTML = '';

                if (!tasks || tasks.length === 0) {
                  taskList.innerHTML = \`
                    <div style="text-align:center; padding:28px 16px; color:#a1a1aa;">
                      <div style="font-size:13px; font-weight:500; color:#71717a; margin-bottom:4px;">No tasks yet</div>
                      <div style="font-size:12px; line-height:1.5;">Start a conversation in <strong>\${p.name}</strong><br>to see tasks here.</div>
                    </div>
                  \`;
                  return;
                }

                for (const t of tasks) {
                  allTasks.set(t.taskId, t);
                  const el = document.createElement('div');
                  el.className = 'task';
                  el.draggable = true;

                  const displayTitle = t.title.length > 100 ? t.title.substring(0, 100) + '...' : t.title;
                  const repoShort = t.repoName ? t.repoName.split('/').pop() : null;
                  const displayProject = repoShort || t.projectHint || (t.workspace ? t.workspace.split('/').pop() : null);
                  const tooltipPath = t.workspace || '';
                  const repoIcon = t.repoName ? '${ICON_LINK}' : '${ICON_FOLDER}';
                  const workspaceBadge = displayProject ? '<span class="task-workspace" title="' + tooltipPath + '">' + repoIcon + ' ' + displayProject + '</span>' : '';

                  el.innerHTML = \`
                    <div class="task-title">\${displayTitle} \${t.imported ? '<span class="badge">IMPORTED</span>' : ''}</div>
                    <div class="task-meta"><span>\${new Date(t.updatedAt).toLocaleString()}</span>\${workspaceBadge}</div>
                    <div class="task-actions">
                      <span class="task-icon" onclick="showModal('\${t.taskId}')" title="View Details">${ICON_EYE}</span>
                      <span class="task-icon" onclick="deleteTask('\${p.name}', '\${r.id}', '\${t.taskId}', event)" title="Delete Task">${ICON_TRASH}</span>
                    </div>
                  \`;
                  el.addEventListener('dragstart', () => {
                    draggedTask = { ...t, provider: p.name, rootId: r.id };
                  });
                  taskList.appendChild(el);
                }
              } catch (err) {
                taskList.innerHTML = '<div style="padding:16px;color:#dc2626;font-size:12px;">Failed to load tasks</div>';
              }
            });

            await Promise.all(fetchPromises);
          }

          async function deleteTask(provider, rootId, taskId, e) {
            e.stopPropagation();
            const t = allTasks.get(taskId);
            const title = t ? t.title.substring(0, 30) : taskId;
            if (!confirm(\`Delete task "\${title}..."?\n\nThis PERMANENTLY removes it from the provider. This cannot be undone.\`)) return;

            const res = await fetch(\`/api/tasks?provider=\${provider}&rootId=\${rootId}&taskId=\${taskId}\`, { method: 'DELETE', headers: authHeaders() });
            const data = await res.json();
            if (data.success) {
              toast('Task deleted');
            } else {
              toast('Delete failed: ' + (data.error || 'Unknown error'), 'error');
            }
            load();
          }

          async function sync(provider, rootId) {
            toast('Syncing ' + provider + '...');
            const res = await fetch('/api/sync', {
              method: 'POST',
              headers: authHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ provider, rootId })
            });
            const data = await res.json();
            if (data.success) {
              toast('✓ Sync complete!');
            } else {
              toast('Sync failed: ' + (data.error || 'Unknown error'), 'error');
            }
          }

          function toast(msg, type) {
            const t = document.createElement('div');
            t.className = 'toast toast-' + (type === 'error' ? 'error' : 'success');
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(function() {
              t.style.transition = 'opacity 0.3s';
              t.style.opacity = '0';
              setTimeout(function() { t.remove(); }, 350);
            }, 4000);
          }

          load();
        </script>
      </body>
      </html>
    `);
  });

  app.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n?? TaskSync Dashboard running at ${url}\n`);

    if (openBrowser) {
      import("child_process").then(({ exec }) => {
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${cmd} ${url}`);
      });
    }
  });
}
