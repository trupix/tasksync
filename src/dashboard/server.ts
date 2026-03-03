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
import { saveToken, loadToken, deleteToken, verifyToken, getAuthStatus, checkGitHubRepoExists, createGitHubRepo } from "../utils/auth";

// --- Logo (read once at startup, embedded inline in HTML) --------------------
let LOGO_SVG = "";
try {
  LOGO_SVG = fs.readFileSync(path.join(__dirname, "../../src/tasksync.svg"), "utf8")
    .replace(/<\?xml[^?]*\?>\s*/i, "")
    .replace(/<style[\s\S]*?<\/style>/i, "")
    .replace(/class="cls-1"/g, 'fill="#00cb7b"')
    .replace(/class="cls-2"/g, 'fill="#231f20"')
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

  const authToken = getDashboardToken();

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
    try {
      const result = providers.map(p => ({
        name: p.getProviderName(),
        roots: p.getRoots().map(r => ({
          id: r.id,
          label: r.label,
          path: r.path,
          isInitialized: p.validateRoot(r.path),
          syncInitialized: r.path ? !!readManifest(r.path) : false,
        }))
      }));
      res.json({ providers: result });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
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

      safeRmDir(path.join(r.path, "tasks"), taskId as string);

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

      const rooIndexPath = path.join(r.path, "tasks", "_index.json");
      if (fs.existsSync(rooIndexPath)) {
        const idx = JSON.parse(safeReadFile(path.join(r.path, "tasks"), "_index.json"));
        const entry = (idx.entries || []).find((e: any) => e.id === taskId);
        if (entry) {
          entry.workspace = newWorkspace;
          idx.updatedAt = Date.now();
          safeWriteFile(path.join(r.path, "tasks"), "_index.json", JSON.stringify(idx));
        }
        const historyItemPath = safePath(path.join(r.path, "tasks"), `${taskId}/history_item.json`);
        if (fs.existsSync(historyItemPath)) {
          const hi = JSON.parse(safeReadFile(path.join(r.path, "tasks"), `${taskId}/history_item.json`));
          hi.workspace = newWorkspace;
          safeWriteFile(path.join(r.path, "tasks"), `${taskId}/history_item.json`, JSON.stringify(hi));
        }
      }

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

  // --- Auth endpoints -------------------------------------------------------

  app.get("/api/auth/status", (req, res) => {
    res.json(getAuthStatus());
  });

  app.post("/api/auth/save", requireAuth, async (req, res) => {
    try {
      const { pat } = req.body;
      if (typeof pat !== "string" || pat.trim().length === 0) return void safeErr(res, 400, "PAT is required");
      const user = await verifyToken(pat.trim());
      saveToken(pat.trim(), user.login);
      res.json({ success: true, username: user.login, name: user.name });
    } catch (e: any) {
      safeErr(res, 400, e.message);
    }
  });

  app.delete("/api/auth", requireAuth, (req, res) => {
    deleteToken();
    res.json({ success: true });
  });

  app.post("/api/auth/check-repo", requireAuth, async (req, res) => {
    try {
      const { repoName } = req.body;
      if (typeof repoName !== "string" || repoName.trim().length === 0) return void safeErr(res, 400, "repoName is required");
      const status = getAuthStatus();
      if (!status.authenticated || !status.username) return void safeErr(res, 401, "Not authenticated — save a PAT first");
      const config = loadToken();
      if (!config) return void safeErr(res, 401, "No stored token");
      const exists = await checkGitHubRepoExists(config.github.pat, status.username, repoName.trim());
      res.json({ exists, username: status.username, repoName: repoName.trim() });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.post("/api/auth/create-repo", requireAuth, async (req, res) => {
    try {
      const { repoName } = req.body;
      if (typeof repoName !== "string" || repoName.trim().length === 0) return void safeErr(res, 400, "repoName is required");
      const config = loadToken();
      if (!config) return void safeErr(res, 401, "No stored token — save a PAT first");
      const { cloneUrl, htmlUrl } = await createGitHubRepo(config.github.pat, repoName.trim());
      res.json({ success: true, cloneUrl, htmlUrl });
    } catch (e: any) {
      safeErr(res, 400, e.message);
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
          /* Auth banner */
          .auth-banner { display:flex; align-items:center; gap:8px; padding:9px 14px; border-radius:6px; font-size:12px; margin-bottom:16px; cursor:pointer; border:1px solid transparent; transition:opacity .15s; user-select:none; }
          .auth-banner:hover { opacity:.85; }
          .auth-ok { background:#dcfce7; color:#166534; border-color:#bbf7d0; }
          .auth-info { background:#dbeafe; color:#1e40af; border-color:#bfdbfe; }
          .auth-warn { background:#fef9c3; color:#854d0e; border-color:#fde68a; }
          /* Auth modal extras */
          .auth-modal .modal { max-width:460px; }
          .tab-row { display:flex; border:1px solid #e4e4e7; border-radius:6px; overflow:hidden; margin-bottom:16px; }
          .tab-btn { flex:1; padding:8px; font-size:12px; border:none; cursor:pointer; }
          .tab-active { background:#18181b; color:#fff; }
          .tab-inactive { background:#f4f4f5; color:#3f3f46; }
          .field-label { font-size:12px; color:#71717a; display:block; margin-bottom:6px; }
          .field-input { width:100%; padding:8px; border:1px solid #e4e4e7; border-radius:4px; font-size:13px; font-family:monospace; box-sizing:border-box; }
          .msg-ok { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:8px; font-size:12px; color:#166534; margin-top:8px; }
          .msg-err { background:#fef2f2; border:1px solid #fca5a5; border-radius:4px; padding:8px; font-size:12px; color:#dc2626; margin-top:8px; }
          .msg-spin { color:#71717a; font-size:12px; margin-top:8px; }
          .danger-btn { font-size:12px; color:#dc2626; background:none; border:1px solid #fca5a5; padding:5px 12px; border-radius:4px; cursor:pointer; }
          .danger-btn:hover { background:#fef2f2; }
          .divider { border-top:1px solid #e4e4e7; margin:16px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; flex-shrink:0;">${LOGO_SVG}</div>
            <h1 style="margin:0">TaskSync</h1>
          </div>
          <button class="btn" onclick="load()" style="padding:8px 16px; font-size:14px; display:inline-flex; align-items:center; gap:6px;">${ICON_REFRESH} Refresh Tasks</button>
        </div>

        <!-- Auth status banner -->
        <div id="authBanner" class="auth-banner auth-warn" onclick="openAuthModal()">
          <span id="authBannerIcon">⚠</span>
          <span id="authBannerText">No authentication configured — click to set up</span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <p style="margin:0; color:#71717a; font-size:13px;">Drag and drop tasks between providers to migrate them.</p>
          <div id="columnToggles" style="display:flex; gap:10px; align-items:center; font-size:12px; color:#71717a;"></div>
        </div>
        <div class="board" id="board">Loading...</div>

        <!-- Auth Modal -->
        <div class="modal-overlay auth-modal" id="authModal" onclick="if(event.target===this)closeAuthModal()">
          <div class="modal">
            <div class="modal-header">
              <h2 class="modal-title">GitHub Authentication</h2>
              <button class="close-btn" onclick="closeAuthModal()">&times;</button>
            </div>
            <div class="modal-body">
              <div id="authCurrentStatus"></div>

              <div class="modal-section">
                <label class="field-label" style="font-weight:600;font-size:13px;color:#18181b;">Personal Access Token</label>
                <div style="font-size:12px;color:#71717a;margin-bottom:8px;">
                  Create one at <a href="https://github.com/settings/tokens" target="_blank" style="color:#6366f1;">github.com/settings/tokens</a> — scope: <code>repo</code>
                </div>
                <div style="display:flex;gap:8px;">
                  <input id="patInput" type="password" placeholder="ghp_..." class="field-input" style="flex:1;" />
                  <button class="btn" id="patSaveBtn" onclick="savePat()">Verify &amp; Save</button>
                </div>
                <div id="patResult" style="display:none;"></div>
              </div>

              <div id="removeTokenRow" style="display:none;">
                <button class="danger-btn" onclick="removePat()">Remove stored token</button>
              </div>

              <!-- Connect repo section — shown once authenticated -->
              <div id="connectRepoSection" style="display:none;">
                <div class="divider"></div>
                <div style="font-weight:600;font-size:13px;color:#18181b;margin-bottom:12px;">Connect a Sync Repository</div>
                <div class="tab-row">
                  <button id="tabCreate" class="tab-btn tab-active" onclick="switchTab('create')">Create new repo</button>
                  <button id="tabExisting" class="tab-btn tab-inactive" onclick="switchTab('existing')">Use existing repo</button>
                </div>

                <!-- Create tab -->
                <div id="createRepoTab">
                  <div class="modal-section">
                    <label class="field-label">Repository name</label>
                    <input id="repoNameInput" type="text" value="tasksync-data" class="field-input" />
                    <div style="font-size:11px;color:#71717a;margin-top:4px;">Will be created as a private repo on your GitHub account.</div>
                  </div>
                  <div class="modal-section">
                    <label class="field-label">Provider to initialize</label>
                    <select id="createProviderSelect" class="field-input"></select>
                  </div>
                  <div id="createMsg" style="display:none;" class="msg-spin"></div>
                  <button class="btn" onclick="createAndInit()" style="width:100%;padding:10px;">Create repo &amp; initialize sync</button>
                </div>

                <!-- Existing tab -->
                <div id="existingRepoTab" style="display:none;">
                  <div class="modal-section">
                    <label class="field-label">Repository URL</label>
                    <input id="existingRepoUrl" type="text" placeholder="https://github.com/you/repo.git" class="field-input" />
                  </div>
                  <div class="modal-section">
                    <label class="field-label">Provider to initialize</label>
                    <select id="existingProviderSelect" class="field-input"></select>
                  </div>
                  <div id="existingMsg" style="display:none;" class="msg-spin"></div>
                  <button class="btn" onclick="initExisting()" style="width:100%;padding:10px;">Initialize sync</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Task Details Modal -->
        <div class="modal-overlay" id="taskModal" onclick="if(event.target===this)closeModal()">
          <div class="modal">
            <div class="modal-header">
              <h2 class="modal-title">Task Details</h2>
              <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body" id="modalContent"></div>
          </div>
        </div>

        <script>
          var __TaskSync_TOKEN = '${authToken}';
          function authHeaders(h) { var o = Object.assign({}, h || {}); o['x-tasksync-token'] = __TaskSync_TOKEN; return o; }

          let draggedTask = null;
          let allTasks = new Map();
          let currentModalTask = null;
          let authState = null;
          let hasSyncSetup = false;

          // ── Auth banner & modal ─────────────────────────────────────────────

          async function checkAuthStatus() {
            try {
              const res = await fetch('/api/auth/status');
              authState = await res.json();
              renderAuthBanner();
              if (authState && authState.authenticated) populateProviderSelects();
            } catch(e) { /* ignore */ }
          }

          function renderAuthBanner() {
            const banner = document.getElementById('authBanner');
            const icon = document.getElementById('authBannerIcon');
            const text = document.getElementById('authBannerText');
            if (!banner) return;
            if (authState && authState.authenticated && hasSyncSetup) {
              // State 3: authenticated + sync initialized → green
              banner.className = 'auth-banner auth-ok';
              icon.textContent = '✓';
              text.textContent = 'Authenticated as @' + (authState.username || 'user') + (authState.maskedToken ? ' · ' + authState.maskedToken : '') + ' — click to manage';
            } else if (authState && authState.authenticated && !hasSyncSetup) {
              // State 2: authenticated but no sync repo set up -> blue
              banner.className = 'auth-banner auth-info';
              icon.textContent = '\u2192';
              text.textContent = 'Authenticated as @' + (authState.username || 'user') + ' \u2014 no sync repo connected yet \u00b7 click to connect';
            } else {
              // State 1: no authentication → amber
              banner.className = 'auth-banner auth-warn';
              icon.textContent = '⚠';
              text.textContent = 'No authentication configured — click to set up';
            }
          }

          function openAuthModal() {
            document.getElementById('patInput').value = '';
            const patResult = document.getElementById('patResult');
            patResult.style.display = 'none';
            renderAuthModalState();
            document.getElementById('authModal').style.display = 'flex';
          }

          function closeAuthModal() {
            document.getElementById('authModal').style.display = 'none';
          }

          function renderAuthModalState() {
            const statusDiv = document.getElementById('authCurrentStatus');
            const connectSection = document.getElementById('connectRepoSection');
            const removeRow = document.getElementById('removeTokenRow');

            if (authState && authState.authenticated) {
              statusDiv.innerHTML = '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:13px;">'
                + '<strong style="color:#166534;">✓ Authenticated</strong><br>'
                + '<span style="color:#555;font-size:12px;">Method: ' + authState.method + '</span>'
                + (authState.username ? '<br><span style="color:#555;font-size:12px;">GitHub: @' + authState.username + '</span>' : '')
                + (authState.maskedToken ? '<br><span style="color:#555;font-size:12px;">Token: ' + authState.maskedToken + '</span>' : '')
                + '</div>';
              connectSection.style.display = 'block';
              removeRow.style.display = 'block';
              populateProviderSelects();
            } else {
              statusDiv.innerHTML = '';
              connectSection.style.display = 'none';
              removeRow.style.display = 'none';
            }
          }

          async function savePat() {
            const pat = document.getElementById('patInput').value.trim();
            if (!pat) { alert('Please enter a token'); return; }
            const btn = document.getElementById('patSaveBtn');
            btn.disabled = true; btn.textContent = 'Verifying...';
            const resultEl = document.getElementById('patResult');
            resultEl.style.display = 'none';
            try {
              const res = await fetch('/api/auth/save', {
                method: 'POST',
                headers: authHeaders({'Content-Type': 'application/json'}),
                body: JSON.stringify({ pat })
              });
              const data = await res.json();
              resultEl.style.display = 'block';
              if (data.success) {
                resultEl.className = 'msg-ok';
                resultEl.textContent = '✓ Verified as @' + data.username + (data.name ? ' (' + data.name + ')' : '');
                document.getElementById('patInput').value = '';
                await checkAuthStatus();
                renderAuthModalState();
              } else {
                resultEl.className = 'msg-err';
                resultEl.textContent = '✗ ' + (data.error || 'Verification failed');
              }
            } catch(e) {
              resultEl.style.display = 'block';
              resultEl.className = 'msg-err';
              resultEl.textContent = 'Error: ' + e.message;
            } finally {
              btn.disabled = false; btn.textContent = 'Verify & Save';
            }
          }

          async function removePat() {
            if (!confirm('Remove stored authentication token?')) return;
            await fetch('/api/auth', { method: 'DELETE', headers: authHeaders() });
            authState = { authenticated: false, method: 'none' };
            renderAuthBanner();
            renderAuthModalState();
            toast('Token removed');
          }

          function switchTab(tab) {
            const isCreate = tab === 'create';
            document.getElementById('createRepoTab').style.display = isCreate ? '' : 'none';
            document.getElementById('existingRepoTab').style.display = isCreate ? 'none' : '';
            document.getElementById('tabCreate').className = 'tab-btn ' + (isCreate ? 'tab-active' : 'tab-inactive');
            document.getElementById('tabExisting').className = 'tab-btn ' + (isCreate ? 'tab-inactive' : 'tab-active');
          }

          function populateProviderSelects() {
            fetch('/api/providers').then(r => r.json()).then(function(d) {
              const opts = d.providers.flatMap(function(p) {
                return p.roots.map(function(r) {
                  return '<option value="' + p.name + '|' + r.id + '">' + p.name + ' (' + r.label + ')</option>';
                });
              }).join('');
              const html = opts || '<option value="">No providers detected</option>';
              document.getElementById('createProviderSelect').innerHTML = html;
              document.getElementById('existingProviderSelect').innerHTML = html;
            }).catch(function(){});
          }

          async function createAndInit() {
            const repoName = document.getElementById('repoNameInput').value.trim();
            const providerVal = document.getElementById('createProviderSelect').value;
            if (!repoName) { alert('Please enter a repo name'); return; }
            if (!providerVal) { alert('Please select a provider'); return; }
            const [providerName, rootId] = providerVal.split('|');
            const msgEl = document.getElementById('createMsg');
            msgEl.style.display = 'block'; msgEl.className = 'msg-spin'; msgEl.textContent = 'Checking repository name...';

            // 1. Check if repo exists
            let checkData;
            try {
              const r = await fetch('/api/auth/check-repo', {
                method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
                body: JSON.stringify({ repoName })
              });
              checkData = await r.json();
              if (checkData.error) { msgEl.className = 'msg-err'; msgEl.textContent = checkData.error; return; }
            } catch(e) { msgEl.className = 'msg-err'; msgEl.textContent = 'Error: ' + e.message; return; }

            let cloneUrl;
            if (checkData.exists) {
              const use = confirm('A repo named "' + repoName + '" already exists on @' + checkData.username + '.\\n\\nUse it for sync? (OK = use it, Cancel = pick a different name)');
              if (!use) { msgEl.style.display = 'none'; document.getElementById('repoNameInput').focus(); return; }
              cloneUrl = 'https://github.com/' + checkData.username + '/' + repoName + '.git';
              msgEl.textContent = 'Using existing repository...';
            } else {
              // 2. Create repo
              msgEl.textContent = 'Creating private repository...';
              try {
                const r = await fetch('/api/auth/create-repo', {
                  method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
                  body: JSON.stringify({ repoName })
                });
                const d = await r.json();
                if (!d.success) { msgEl.className = 'msg-err'; msgEl.textContent = d.error || 'Failed to create repository'; return; }
                cloneUrl = d.cloneUrl;
                msgEl.textContent = 'Repository created! Initializing sync...';
              } catch(e) { msgEl.className = 'msg-err'; msgEl.textContent = 'Error: ' + e.message; return; }
            }

            // 3. Init
            try {
              const r = await fetch('/api/init', {
                method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
                body: JSON.stringify({ provider: providerName, rootId, repoUrl: cloneUrl })
              });
              const d = await r.json();
              if (d.success) {
                msgEl.className = 'msg-ok'; msgEl.textContent = '✓ Sync initialized! ' + cloneUrl;
                toast('✓ Sync initialized for ' + providerName);
                load();
              } else { msgEl.className = 'msg-err'; msgEl.textContent = d.error || 'Initialization failed'; }
            } catch(e) { msgEl.className = 'msg-err'; msgEl.textContent = 'Error: ' + e.message; }
          }

          async function initExisting() {
            const repoUrl = document.getElementById('existingRepoUrl').value.trim();
            const providerVal = document.getElementById('existingProviderSelect').value;
            if (!repoUrl) { alert('Please enter a repository URL'); return; }
            if (!providerVal) { alert('Please select a provider'); return; }
            if (!repoUrl.startsWith('http') && !repoUrl.startsWith('git@')) { alert('Please enter a valid URL (https:// or git@)'); return; }
            const [providerName, rootId] = providerVal.split('|');
            const msgEl = document.getElementById('existingMsg');
            msgEl.style.display = 'block'; msgEl.className = 'msg-spin'; msgEl.textContent = 'Initializing sync...';
            try {
              const r = await fetch('/api/init', {
                method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
                body: JSON.stringify({ provider: providerName, rootId, repoUrl })
              });
              const d = await r.json();
              if (d.success) { msgEl.className = 'msg-ok'; msgEl.textContent = '✓ Sync initialized!'; toast('✓ Sync initialized for ' + providerName); load(); }
              else { msgEl.className = 'msg-err'; msgEl.textContent = d.error || 'Initialization failed'; }
            } catch(e) { msgEl.className = 'msg-err'; msgEl.textContent = 'Error: ' + e.message; }
          }

          // ── Column visibility ───────────────────────────────────────────────

          function getColumnKey(providerName, rootId) { return providerName + ':' + rootId; }

          function getHiddenColumns() {
            try { return JSON.parse(localStorage.getItem('TaskSync_hidden_columns') || '[]'); }
            catch { return []; }
          }

          function setHiddenColumns(hidden) { localStorage.setItem('TaskSync_hidden_columns', JSON.stringify(hidden)); }

          function isColumnVisible(providerName, rootId) {
            return !getHiddenColumns().includes(getColumnKey(providerName, rootId));
          }

          function toggleColumn(providerName, rootId) {
            const key = getColumnKey(providerName, rootId);
            const hidden = getHiddenColumns();
            const idx = hidden.indexOf(key);
            if (idx >= 0) hidden.splice(idx, 1); else hidden.push(key);
            setHiddenColumns(hidden);
            const isNowVisible = !hidden.includes(key);
            const col = document.querySelector('.column[data-col-key="' + key + '"]');
            if (col) col.style.display = isNowVisible ? '' : 'none';
            const toggleLabel = document.querySelector('label[data-toggle-key="' + key + '"]');
            if (toggleLabel) toggleLabel.style.background = isNowVisible ? '#e0f2fe' : '#f4f4f5';
          }

          // ── Task modal ──────────────────────────────────────────────────────

          function showModal(taskId) {
            const t = allTasks.get(taskId);
            if (!t) return;
            currentModalTask = t;
            const content = document.getElementById('modalContent');
            let provenanceHtml = '';
            if (t.imported && t.provenance) {
              provenanceHtml = \`<div class="modal-section"><strong>Provenance:</strong><div style="margin-top:4px;padding:8px;background:#fefce8;border:1px solid #fef08a;border-radius:4px;">Imported from <b>\${t.provenance.importedFrom?.provider || 'Unknown'}</b> (\${t.provenance.importedFrom?.rootLabel || 'Unknown'})<br>Original Task ID: \${t.provenance.importedFrom?.taskId || 'Unknown'}<br>Imported At: \${new Date(t.provenance.importedAt).toLocaleString()}</div></div>\`;
            }
            const currentWorkspace = t.workspace || 'Unknown';
            content.innerHTML = \`
              <div class="modal-section"><strong>Task ID:</strong> \${t.taskId}</div>
              <div class="modal-section"><strong>Last Updated:</strong> \${new Date(t.updatedAt).toLocaleString()}</div>
              <div class="modal-section"><strong>Provider:</strong> <span style="text-transform:capitalize;">\${t.origin.provider}</span> (\${t.origin.rootLabel})</div>
              <div class="modal-section">
                <strong>Workspace:</strong>
                <div style="display:flex;gap:8px;margin-top:6px;align-items:center;">
                  <input id="workspaceInput" type="text" value="\${currentWorkspace}" style="flex:1;padding:6px 10px;border:1px solid #e4e4e7;border-radius:4px;font-size:13px;font-family:monospace;" placeholder="/path/to/your/project" />
                  <button class="btn" onclick="saveWorkspace()" style="white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">${ICON_SAVE} Save</button>
                </div>
                <div style="font-size:11px;color:#71717a;margin-top:4px;">Change this to make the task appear under a different workspace in Roo's "Current" filter.</div>
              </div>
              \${provenanceHtml}
              <div class="modal-section"><strong>Initial Prompt / Title:</strong><div class="pre-wrap">\${t.title}</div></div>
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
              headers: authHeaders({'Content-Type':'application/json'}),
              body: JSON.stringify({ provider: t.origin.provider, rootId: t.origin.rootId, taskId: t.taskId, newWorkspace })
            });
            const data = await res.json();
            if (data.success) { toast('✓ Workspace updated! Reload VS Code to see the change.'); closeModal(); load(); }
            else { toast('Error: ' + data.error, 'error'); }
          }

          function closeModal() { document.getElementById('taskModal').style.display = 'none'; }

          // ── Board ───────────────────────────────────────────────────────────

          const SPINNER_HTML = '<div style="display:flex;align-items:center;justify-content:center;padding:32px;color:#a1a1aa;font-size:12px;gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;flex-shrink:0"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading tasks...</div>';

          async function load() {
            const board = document.getElementById('board');
            board.innerHTML = '<div style="padding:32px;color:#a1a1aa;font-size:13px;">Loading...</div>';
            allTasks.clear();
            const res = await fetch('/api/providers');
            const { providers } = await res.json();
            // Update banner: check if any provider root has sync initialized
            hasSyncSetup = providers.some(function(p) { return p.roots.some(function(r) { return r.syncInitialized; }); });
            renderAuthBanner();
            board.innerHTML = '';
            const togglesEl = document.getElementById('columnToggles');
            togglesEl.innerHTML = '<span style="font-weight:600;">Columns:</span> ';
            for (const p of providers) {
              for (const r of p.roots) {
                const key = getColumnKey(p.name, r.id);
                const visible = isColumnVisible(p.name, r.id);
                const label = document.createElement('label');
                label.setAttribute('data-toggle-key', key);
                label.style.cssText = 'display:inline-flex;align-items:center;gap:3px;cursor:pointer;padding:2px 6px;border-radius:4px;background:' + (visible ? '#e0f2fe' : '#f4f4f5') + ';';
                label.innerHTML = '<input type="checkbox" ' + (visible ? 'checked' : '') + ' style="cursor:pointer;"> ' + p.name + ' (' + r.label + ')';
                label.querySelector('input').addEventListener('change', function() { toggleColumn(p.name, r.id); });
                togglesEl.appendChild(label);
              }
            }
            const taskLists = new Map();
            for (const p of providers) {
              for (const r of p.roots) {
                const key = getColumnKey(p.name, r.id);
                const col = document.createElement('div');
                col.className = 'column';
                col.setAttribute('data-col-key', key);
                if (!isColumnVisible(p.name, r.id)) col.style.display = 'none';
                col.innerHTML = \`
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="margin:0;text-transform:capitalize;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      \${p.name}
                      <span title="\${r.label}" style="color:#a1a1aa;cursor:help;line-height:1;user-select:none;display:inline-flex;" aria-label="\${r.label}">${ICON_INFO}</span>
                      <span style="font-size:10px;font-weight:600;color:#a16207;background:#fef9c3;border:1px solid #fde68a;padding:1px 6px;border-radius:4px;display:\${r.isInitialized ? 'none' : 'inline'}">not detected</span>
                    </h3>
                    <button class="btn" onclick="sync('\${p.name}','\${r.id}')" style="display:\${r.isInitialized ? 'inline-block' : 'none'}">Sync</button>
                  </div>
                  <div class="task-list" data-provider="\${p.name}" data-root="\${r.id}" style="min-height:100px;"></div>
                \`;
                board.appendChild(col);
                const taskList = col.querySelector('.task-list');
                if (!r.isInitialized) {
                  taskList.innerHTML = \`
                    <div style="text-align:center;padding:24px 16px;background:#fafaf9;border:1px dashed #d4d4d8;border-radius:6px;color:#71717a;">
                      <div style="font-weight:600;font-size:13px;color:#3f3f46;margin-bottom:6px;">Provider not detected</div>
                      <div style="font-size:12px;line-height:1.5;margin-bottom:14px;">Install and launch <strong>\${p.name}</strong> in VS Code<br>at least once to enable detection.</div>
                      <button class="btn" style="font-size:11px;padding:4px 10px;background:#e4e4e7;color:#3f3f46;" onclick="load()">Retry detection</button>
                    </div>
                  \`;
                } else {
                  taskList.innerHTML = SPINNER_HTML;
                  taskLists.set(key, { taskList, p, r });
                  taskList.addEventListener('dragover', e => e.preventDefault());
                  taskList.addEventListener('drop', async e => {
                    e.preventDefault();
                    if (!draggedTask) return;
                    const toProvider = taskList.dataset.provider;
                    const toRootId = taskList.dataset.root;
                    if (draggedTask.provider === toProvider && draggedTask.rootId === toRootId) return;
                    if (confirm(\`Migrate task "\${draggedTask.title.substring(0,30)}..." to \${toProvider}?\`)) {
                      const migrateRes = await fetch('/api/migrate', {
                        method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
                        body: JSON.stringify({ fromProvider: draggedTask.provider, fromRootId: draggedTask.rootId, taskId: draggedTask.taskId, title: draggedTask.title, toProvider, toRootId })
                      });
                      const migrateData = await migrateRes.json();
                      if (migrateData.success) toast('✓ Migrated to ' + toProvider);
                      else toast('Migration failed: ' + (migrateData.error || 'Unknown error'), 'error');
                      load();
                    }
                  });
                }
              }
            }
            const fetchPromises = Array.from(taskLists.entries()).map(async ([key, { taskList, p, r }]) => {
              try {
                const tasksRes = await fetch(\`/api/tasks?provider=\${p.name}&rootId=\${r.id}\`);
                const tasks = await tasksRes.json();
                taskList.innerHTML = '';
                if (!tasks || tasks.length === 0) {
                  taskList.innerHTML = \`<div style="text-align:center;padding:28px 16px;color:#a1a1aa;"><div style="font-size:13px;font-weight:500;color:#71717a;margin-bottom:4px;">No tasks yet</div><div style="font-size:12px;line-height:1.5;">Start a conversation in <strong>\${p.name}</strong><br>to see tasks here.</div></div>\`;
                  return;
                }
                for (const t of tasks) {
                  allTasks.set(t.taskId, t);
                  const el = document.createElement('div');
                  el.className = 'task'; el.draggable = true;
                  const displayTitle = t.title.length > 100 ? t.title.substring(0,100) + '...' : t.title;
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
                      <span class="task-icon" onclick="deleteTask('\${p.name}','\${r.id}','\${t.taskId}',event)" title="Delete Task">${ICON_TRASH}</span>
                    </div>
                  \`;
                  el.addEventListener('dragstart', () => { draggedTask = { ...t, provider: p.name, rootId: r.id }; });
                  taskList.appendChild(el);
                }
              } catch(err) {
                taskList.innerHTML = '<div style="padding:16px;color:#dc2626;font-size:12px;">Failed to load tasks</div>';
              }
            });
            await Promise.all(fetchPromises);
          }

          async function deleteTask(provider, rootId, taskId, e) {
            e.stopPropagation();
            const t = allTasks.get(taskId);
            const title = t ? t.title.substring(0,30) : taskId;
            if (!confirm(\`Delete task "\${title}..."?\n\nThis PERMANENTLY removes it from the provider. This cannot be undone.\`)) return;
            const res = await fetch(\`/api/tasks?provider=\${provider}&rootId=\${rootId}&taskId=\${taskId}\`, { method: 'DELETE', headers: authHeaders() });
            const data = await res.json();
            if (data.success) toast('Task deleted');
            else toast('Delete failed: ' + (data.error || 'Unknown error'), 'error');
            load();
          }

          async function sync(provider, rootId) {
            toast('Syncing ' + provider + '...');
            const res = await fetch('/api/sync', {
              method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
              body: JSON.stringify({ provider, rootId })
            });
            const data = await res.json();
            if (data.success) {
              toast('✓ Sync complete!');
            } else {
              const errMsg = data.error || 'Unknown error';
              const isAuthErr = /authentication|credential|401|403|token/i.test(errMsg);
              if (isAuthErr) {
                toast('Sync failed — authentication required. Click the banner above to set up your token.', 'error');
              } else {
                toast('Sync failed: ' + errMsg, 'error');
              }
            }
          }

          function toast(msg, type) {
            const t = document.createElement('div');
            t.className = 'toast toast-' + (type === 'error' ? 'error' : 'success');
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(function() {
              t.style.transition = 'opacity 0.3s'; t.style.opacity = '0';
              setTimeout(function() { t.remove(); }, 350);
            }, 4000);
          }

          checkAuthStatus();
          load();
        </script>
      </body>
      </html>
    `);
  });

  app.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n🚀 TaskSync Dashboard running at ${url}\n`);
    if (openBrowser) {
      import("child_process").then(({ exec }) => {
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${cmd} ${url}`);
      });
    }
  });
}
