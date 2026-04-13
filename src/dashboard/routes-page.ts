import express from "express";
import {
  ICON_REFRESH,
  ICON_EYE,
  ICON_TRASH,
  ICON_LINK,
  ICON_FOLDER,
  ICON_SAVE,
  ICON_INFO,
  ICON_COPY,
} from "./assets";

export interface PageRouteOptions {
  authToken: string;
  LOGO_SVG: string;
  DOCS_HTML: string;
}

export function registerDashboardPageRoute(
  app: express.Express,
  opts: PageRouteOptions
): void {
  const { authToken, LOGO_SVG, DOCS_HTML } = opts;

  app.get("/", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>TaskSync</title>
        <style>
          html, body { height: 100%; }
          body { font-family: system-ui, sans-serif; background: #f4f4f5; margin: 0; padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
          .board { display: flex; gap: 20px; overflow-x: auto; overflow-y: hidden; padding-bottom: 8px; flex: 1; min-height: 0; }
          .column { background: white; border-radius: 8px; padding: 16px; min-width: 300px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; min-height: 0; }
          .task-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: 4px; }
          .col-pagination { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid #f4f4f5; min-height:28px; font-size:11px; color:#71717a; }
          .col-pagination-controls { display:flex; align-items:center; gap:4px; }
          .col-page-btn { border:1px solid #e4e4e7; background:#fff; color:#3f3f46; border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer; }
          .col-page-btn:hover:not(:disabled) { background:#f4f4f5; }
          .col-page-btn:disabled { opacity:0.45; cursor:not-allowed; }
          .col-page-chip { color:#52525b; font-weight:600; min-width:42px; text-align:center; }
          .task { background: #fff; border: 1px solid #e4e4e7; padding: 12px; margin-bottom: 8px; border-radius: 6px; cursor: grab; position: relative; }
          .task:active { cursor: grabbing; }
          .task-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; padding-right: 66px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
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
          .toast-info { background: #334155; }
          .cursor-busy, .cursor-busy * { cursor: progress !important; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          /* Auth button (inline in header) */
          .auth-btn { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:4px; border:1px solid transparent; cursor:pointer; font-size:12px; font-weight:500; transition:filter .1s; background:none; }
          .auth-btn:hover { filter:brightness(0.93); }
          .auth-btn-ok { background:#dcfce7; color:#166534; border-color:#bbf7d0; }
          .auth-btn-info { background:#dbeafe; color:#1e40af; border-color:#bfdbfe; }
          .auth-btn-warn { background:#fef9c3; color:#854d0e; border-color:#fde68a; }
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
          /* Column header controls — MCP pill, connect button, ⋯ menu */
          .mcp-pill { display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;padding:2px 8px;border-radius:10px;white-space:nowrap; }
          .col-menu-wrap { position:relative;display:inline-block; }
          .col-menu-btn { background:none;border:1px solid #e4e4e7;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:16px;color:#71717a;line-height:1.3;transition:background .1s; }
          .col-menu-btn:hover { background:#f4f4f5;color:#18181b; }
          .col-menu { position:absolute;right:0;top:calc(100% + 4px);background:white;border:1px solid #e4e4e7;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.12);z-index:50;min-width:160px;overflow:hidden;display:none; }
          .col-menu-item { display:block;width:100%;text-align:left;padding:8px 12px;font-size:13px;cursor:pointer;background:none;border:none;color:#18181b;white-space:nowrap; }
          .col-menu-item:hover { background:#f4f4f5; }
          .btn-mcp-connect { background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap; }
          .btn-mcp-connect:hover { background:#dbeafe; }
          /* Column search */
          .col-search-wrap { position:relative; margin-bottom:12px; }
          .col-search-input { width:100%; padding:6px 10px 6px 30px; border:1px solid #e4e4e7; border-radius:6px; font-size:12px; background:#fafafa; box-sizing:border-box; outline:none; transition:border-color .15s; color:#18181b; }
          .col-search-input:focus { border-color:#6366f1; background:#fff; }
          .col-search-input::placeholder { color:#c4c4c4; }
          .col-search-icon { position:absolute; left:8px; top:50%; transform:translateY(-50%); pointer-events:none; color:#c4c4c4; display:flex; align-items:center; }
          /* Workspace groups */
          .task-group-header { display:flex; align-items:center; gap:6px; padding:5px 2px; cursor:pointer; user-select:none; border-bottom:1px solid #f0f0f0; margin-top:10px; margin-bottom:6px; }
          .task-group-header:first-child { margin-top:0; }
          .task-group-chevron { font-size:9px; color:#a1a1aa; transition:transform 0.15s; flex-shrink:0; display:inline-block; }
          .task-group-chevron.open { transform:rotate(90deg); }
          .task-group-name { font-size:11px; font-weight:700; color:#52525b; text-transform:uppercase; letter-spacing:0.04em; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .task-group-count { font-size:10px; color:#a1a1aa; background:#f4f4f5; padding:1px 6px; border-radius:10px; flex-shrink:0; }
          .task-group-body.collapsed { display:none; }
          mark.search-hi { background:#fef9c3; color:inherit; border-radius:2px; padding:0 1px; font-style:normal; }
          .col-menu-item.active { color:#6366f1; font-weight:600; }
          .col-menu-sep { height:1px; background:#f0f0f0; margin:4px 0; }
          /* Providers multi-select dropdown */
          .providers-toggle-wrap { position:relative;display:inline-block; }
          .providers-btn { background:white;border:1px solid #e4e4e7;border-radius:5px;padding:5px 11px;cursor:pointer;font-size:12px;font-weight:600;color:#18181b;display:inline-flex;align-items:center;gap:6px;transition:background .1s;white-space:nowrap; }
          .providers-btn:hover { background:#f4f4f5; }
          .providers-count { font-weight:400;color:#71717a; }
          .providers-dropdown { position:absolute;right:0;top:calc(100% + 4px);background:white;border:1px solid #e4e4e7;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.12);z-index:100;min-width:210px;overflow:hidden;padding:4px 0; }
          .providers-dropdown label { display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:13px;cursor:pointer;color:#18181b;user-select:none; }
          .providers-dropdown label:hover { background:#f4f4f5; }
          .providers-dropdown input[type="checkbox"] { cursor:pointer;width:14px;height:14px;flex-shrink:0; }
          /* Help modal — single-column, full-width scrollable content */
          .help-modal-wrap { display:flex;flex-direction:column;background:white;border-radius:8px;width:94%;max-width:900px;height:88vh;max-height:900px;box-shadow:0 8px 32px rgba(0,0,0,0.18); }
          .help-modal-hdr { display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid #e4e4e7;flex-shrink:0; }
          .help-modal-hdr h2 { margin:0;font-size:18px;font-weight:700; }
          .help-body { display:flex;flex:1;overflow:hidden; }
          .help-content { flex:1;overflow-y:auto;padding:28px 40px;font-size:14px;line-height:1.7;color:#3f3f46; }
          .help-content h1 { font-size:24px;font-weight:800;border-bottom:2px solid #e4e4e7;padding-bottom:10px;margin:0 0 16px;color:#18181b; }
          .help-content h2 { font-size:18px;font-weight:700;margin:32px 0 10px;padding-bottom:4px;border-bottom:1px solid #f0f0f0;color:#18181b; }
          .help-content h3 { font-size:15px;font-weight:600;margin:18px 0 6px;color:#18181b; }
          .help-content h4 { font-size:13px;font-weight:600;margin:12px 0 4px;color:#52525b; }
          .help-content p { margin:6px 0 10px; }
          .help-content code { background:#f4f4f5;padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace;color:#be185d; }
          .help-content pre { background:#1a1b26;color:#a9b1d6;padding:14px 16px;border-radius:6px;overflow-x:auto;margin:10px 0; }
          .help-content pre code { background:none;padding:0;color:inherit;font-size:12px; }
          .help-content ul,.help-content ol { margin:6px 0 10px;padding-left:22px; }
          .help-content li { margin:3px 0; }
          .help-content table { border-collapse:collapse;width:100%;margin:10px 0;font-size:13px; }
          .help-content th,.help-content td { border:1px solid #e4e4e7;padding:6px 10px;text-align:left; }
          .help-content th { background:#f4f4f5;font-weight:600; }
          .help-content a { color:#6366f1; }.help-content a:hover { text-decoration:underline; }
          .help-content hr { border:none;border-top:1px solid #e4e4e7;margin:20px 0; }
          .help-content blockquote { border-left:3px solid #bfdbfe;margin:8px 0;padding:4px 14px;color:#71717a;background:#f8faff;border-radius:0 4px 4px 0; }
          .help-btn { background:none;border:1px solid #e4e4e7;color:#52525b;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500; }
          .help-btn:hover { background:#f4f4f5;color:#18181b; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; flex-shrink:0;">${LOGO_SVG}</div>
            <h1 style="margin:0">TaskSync</h1>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button id="authBanner" class="auth-btn auth-btn-warn" onclick="openAuthModal()">
              <span id="authBannerIcon">⚠</span>
              <span id="authBannerText">Set up auth</span>
            </button>
            <button class="btn" onclick="load()" style="padding:8px 16px; font-size:14px; display:inline-flex; align-items:center; gap:6px;">${ICON_REFRESH} Refresh Tasks</button>
            <button class="help-btn" onclick="openHelpModal()">? Help</button>
          </div>
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
                    <div style="font-size:11px;color:#71717a;margin-top:4px;">Created as a private repo — all detected providers will sync into subfolders.</div>
                  </div>
                  <div id="createMsg" style="display:none;" class="msg-spin"></div>
                  <button class="btn" onclick="createAndInit()" style="width:100%;padding:10px;">Create repo &amp; initialize sync</button>
                </div>

                <!-- Existing tab -->
                <div id="existingRepoTab" style="display:none;">
                  <div class="modal-section">
                    <label class="field-label">Repository URL</label>
                    <input id="existingRepoUrl" type="text" placeholder="https://github.com/you/repo.git" class="field-input" />
                    <div style="font-size:11px;color:#71717a;margin-top:4px;">All detected providers will sync into subfolders of this repo.</div>
                  </div>
                  <div id="existingMsg" style="display:none;" class="msg-spin"></div>
                  <button class="btn" onclick="initExisting()" style="width:100%;padding:10px;">Initialize sync</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Help Modal -->
        <div class="modal-overlay" id="helpModal" onclick="if(event.target===this)closeHelpModal()" style="z-index:2000;">
          <div class="help-modal-wrap">
            <div class="help-modal-hdr">
              <h2>TaskSync Documentation</h2>
              <button class="close-btn" onclick="closeHelpModal()">&times;</button>
            </div>
            <div class="help-body">
              <div class="help-content" id="helpContent">${DOCS_HTML}</div>
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
          var colTasks = new Map();
          var colMeta = new Map();
          var colPaging = new Map();
          var searchTimers = new Map();
          var copyInFlight = new Set();
          var copyContextCache = new Map();
          var busyCursorCount = 0;
          var resizeRenderTimer = null;

          // ── Per-column state helpers (search + grouping, persisted) ─────────

          function getColState(key) {
            try { return JSON.parse(localStorage.getItem('TaskSync_col:' + key) || '{}'); }
            catch(e) { return {}; }
          }

          function setColState(key, patch) {
            var s = getColState(key);
            Object.assign(s, patch);
            localStorage.setItem('TaskSync_col:' + key, JSON.stringify(s));
          }

          function getPagingState(key) {
            if (!colPaging.has(key)) {
              colPaging.set(key, { page: 0, pageSize: 12, total: 0, totalPages: 1 });
            }
            return colPaging.get(key);
          }

          function resetColumnPage(key) {
            var paging = getPagingState(key);
            paging.page = 0;
            colPaging.set(key, paging);
          }

          function computeDynamicPageSize(taskList, grouped) {
            var fallback = grouped ? 12 : 14;
            if (!taskList) return fallback;
            var h = taskList.clientHeight || 0;
            if (!Number.isFinite(h) || h <= 0) return fallback;
            var perCard = grouped ? 94 : 82;
            var fit = Math.floor((h - 8) / perCard);
            return Math.max(8, Math.min(80, fit));
          }

          function getPagedTasks(key, all, taskList, grouped) {
            var paging = getPagingState(key);
            paging.pageSize = computeDynamicPageSize(taskList, grouped);
            paging.total = all.length;
            paging.totalPages = Math.max(1, Math.ceil(paging.total / paging.pageSize));
            if (paging.page >= paging.totalPages) paging.page = paging.totalPages - 1;
            if (paging.page < 0) paging.page = 0;
            var start = paging.page * paging.pageSize;
            var end = Math.min(paging.total, start + paging.pageSize);
            colPaging.set(key, paging);
            return { items: all.slice(start, end), start: start, end: end, total: paging.total };
          }

          function shiftColumnPage(key, delta) {
            var paging = getPagingState(key);
            paging.page += delta;
            colPaging.set(key, paging);
            var m = colMeta.get(key);
            if (m) renderColumn(key, colTasks.get(key) || [], m.pName, m.rId);
          }

          function renderColumnPagination(key, pName, rId, pageInfo, term) {
            var pager = document.querySelector('.col-pagination[data-provider="' + pName + '"][data-root="' + rId + '"]');
            if (!pager) return;
            pager.innerHTML = '';
            if (!pageInfo || pageInfo.total <= 0) {
              pager.style.display = 'none';
              return;
            }

            var paging = getPagingState(key);
            pager.style.display = 'flex';

            var summary = document.createElement('span');
            var from = pageInfo.start + 1;
            var to = pageInfo.end;
            summary.textContent = 'Showing ' + from + '-' + to + ' of ' + pageInfo.total + (term ? ' matching tasks' : ' tasks');
            pager.appendChild(summary);

            var controls = document.createElement('div');
            controls.className = 'col-pagination-controls';

            var prevBtn = document.createElement('button');
            prevBtn.className = 'col-page-btn';
            prevBtn.textContent = 'Prev';
            prevBtn.disabled = paging.page <= 0;
            prevBtn.onclick = function() { shiftColumnPage(key, -1); };
            controls.appendChild(prevBtn);

            var chip = document.createElement('span');
            chip.className = 'col-page-chip';
            chip.textContent = (paging.page + 1) + '/' + paging.totalPages;
            controls.appendChild(chip);

            var nextBtn = document.createElement('button');
            nextBtn.className = 'col-page-btn';
            nextBtn.textContent = 'Next';
            nextBtn.disabled = paging.page >= (paging.totalPages - 1);
            nextBtn.onclick = function() { shiftColumnPage(key, 1); };
            controls.appendChild(nextBtn);

            pager.appendChild(controls);
          }

          function escHtml(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
          }

          function highlight(text, term) {
            if (!term) return escHtml(text);
            var esc = escHtml(text);
            var lower = esc.toLowerCase();
            var q = term.toLowerCase();
            var result = '';
            var last = 0;
            var idx;
            while ((idx = lower.indexOf(q, last)) >= 0) {
              result += esc.substring(last, idx) + '<mark class="search-hi">' + esc.substring(idx, idx + q.length) + '</mark>';
              last = idx + q.length;
            }
            return result ? result + esc.substring(last) : esc;
          }

          // ── Icon strings (baked in server-side at render) ───────────────────
          var _ICO_LINK   = '${ICON_LINK}';
          var _ICO_FOLDER = '${ICON_FOLDER}';
          var _ICO_EYE    = '${ICON_EYE}';
          var _ICO_TRASH  = '${ICON_TRASH}';
          var _ICO_COPY   = '${ICON_COPY}';

          // ── Task card builder ────────────────────────────────────────────────
          function buildTaskCard(t, pName, rId, searchTerm) {
            var el = document.createElement('div');
            el.className = 'task'; el.draggable = true;
            var raw = t.title.length > 100 ? t.title.substring(0,100) + '...' : t.title;
            var displayTitle = searchTerm ? highlight(raw, searchTerm) : escHtml(raw);
            var repoShort = t.repoName ? t.repoName.split('/').pop() : null;
            var displayProject = repoShort || t.projectHint || (t.workspace ? t.workspace.split('/').pop() : null);
            var tooltipPath = t.workspace || '';
            var workspaceBadge = displayProject
              ? '<span class="task-workspace" title="' + escHtml(tooltipPath) + '">'
                + (t.repoName ? _ICO_LINK : _ICO_FOLDER) + ' ' + escHtml(displayProject) + '</span>'
              : '';
            el.innerHTML = '<div class="task-title">' + displayTitle
              + (t.imported ? ' <span class="badge">IMPORTED</span>' : '') + '</div>'
              + '<div class="task-meta"><span>' + new Date(t.updatedAt).toLocaleString() + '</span>' + workspaceBadge + '</div>'
              + '<div class="task-actions">'
              + '<span class="task-icon" onclick="copyTaskContext(\\'' + escHtml(pName) + '\\',\\'' + escHtml(rId) + '\\',\\'' + escHtml(t.taskId) + '\\',event)" title="Copy context for AI">' + _ICO_COPY + '</span>'
              + '<span class="task-icon" onclick="showModal(\\'' + escHtml(t.taskId) + '\\')" title="View Details">' + _ICO_EYE + '</span>'
              + '<span class="task-icon" onclick="deleteTask(\\'' + escHtml(pName) + '\\',\\'' + escHtml(rId) + '\\',\\'' + escHtml(t.taskId) + '\\',event)" title="Delete Task">' + _ICO_TRASH + '</span>'
              + '</div>';
            el.addEventListener('dragstart', function() { draggedTask = Object.assign({}, t, { provider: pName, rootId: rId }); });
            return el;
          }

          // ── Column renderer — applies search + optional workspace grouping ───
          function renderColumn(key, tasks, pName, rId) {
            var taskList = document.querySelector('.task-list[data-provider="' + pName + '"][data-root="' + rId + '"]');
            if (!taskList) return;
            taskList.innerHTML = '';
            var cs = getColState(key);
            var term = (cs.search || '').trim().toLowerCase();
            var filtered = term
              ? tasks.filter(function(t) {
                  return t.title.toLowerCase().includes(term)
                    || (t.workspace && t.workspace.toLowerCase().includes(term))
                    || (t.projectHint && t.projectHint.toLowerCase().includes(term))
                    || (t.repoName && t.repoName.toLowerCase().includes(term));
                })
              : tasks;

            var pageInfo = getPagedTasks(key, filtered, taskList, !!cs.grouped);
            var visibleTasks = pageInfo.items;

            if (filtered.length === 0) {
              taskList.innerHTML = term
                ? '<div style="text-align:center;padding:20px 16px;color:#a1a1aa;font-size:12px;">No tasks match &ldquo;' + escHtml(term) + '&rdquo;</div>'
                : '<div style="text-align:center;padding:28px 16px;color:#a1a1aa;"><div style="font-size:13px;font-weight:500;color:#71717a;margin-bottom:4px;">No tasks yet</div>'
                  + '<div style="font-size:12px;line-height:1.5;">Start a conversation in <strong>' + escHtml(pName) + '</strong><br>to see tasks here.</div></div>';
              renderColumnPagination(key, pName, rId, null, term);
              return;
            }

            if (cs.grouped) {
              var groups = new Map();
              for (var i = 0; i < visibleTasks.length; i++) {
                var t2 = visibleTasks[i];
                var rs = t2.repoName ? t2.repoName.split('/').pop() : null;
                var gk = rs || t2.projectHint || (t2.workspace ? t2.workspace.split('/').pop() : null) || '__ungrouped__';
                if (!groups.has(gk)) groups.set(gk, []);
                groups.get(gk).push(t2);
              }
              var sortedKeys = Array.from(groups.keys()).sort(function(a,b) {
                if (a === '__ungrouped__') return 1;
                if (b === '__ungrouped__') return -1;
                return a.localeCompare(b);
              });
              var collapsed = cs.collapsed || [];
              for (var gi = 0; gi < sortedKeys.length; gi++) {
                (function(gk2) {
                  var gTasks = groups.get(gk2);
                  var displayName = gk2 === '__ungrouped__' ? 'Ungrouped' : gk2;
                  var isCollapsed = collapsed.includes(gk2);
                  var hdr = document.createElement('div');
                  hdr.className = 'task-group-header';
                  hdr.onclick = function() { toggleGroup(key, gk2); };
                  hdr.innerHTML = '<span class="task-group-chevron ' + (isCollapsed ? '' : 'open') + '">&#9654;</span>'
                    + '<span class="task-group-name">' + escHtml(displayName) + '</span>'
                    + '<span class="task-group-count">' + gTasks.length + '</span>';
                  taskList.appendChild(hdr);
                  var body = document.createElement('div');
                  body.className = 'task-group-body' + (isCollapsed ? ' collapsed' : '');
                  body.setAttribute('data-group', gk2);
                  for (var ti = 0; ti < gTasks.length; ti++) {
                    body.appendChild(buildTaskCard(gTasks[ti], pName, rId, term));
                  }
                  taskList.appendChild(body);
                })(sortedKeys[gi]);
              }
            } else {
              for (var fi = 0; fi < visibleTasks.length; fi++) {
                taskList.appendChild(buildTaskCard(visibleTasks[fi], pName, rId, term));
              }
            }

            renderColumnPagination(key, pName, rId, pageInfo, term);
          }

          // ── Search bar builder ───────────────────────────────────────────────
          function buildSearchBar(key) {
            var cs = getColState(key);
            var svg = '<svg class="col-search-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
            return '<div class="col-search-wrap">' + svg
              + '<input class="col-search-input" type="text" placeholder="Search tasks..." value="' + escHtml(cs.search || '')
              + '" oninput="onColSearch(\\'' + key + '\\',this.value)" /></div>';
          }

          function onColSearch(key, value) {
            setColState(key, { search: value });
            resetColumnPage(key);
            if (searchTimers.has(key)) clearTimeout(searchTimers.get(key));
            searchTimers.set(key, setTimeout(function() {
              var m = colMeta.get(key);
              if (m) renderColumn(key, colTasks.get(key) || [], m.pName, m.rId);
            }, 150));
          }

          function toggleGrouping(key) {
            var s = getColState(key);
            var nowGrouped = !s.grouped;
            setColState(key, { grouped: nowGrouped });
            resetColumnPage(key);
            var btn = document.getElementById('menu-group-' + key);
            if (btn) btn.className = 'col-menu-item' + (nowGrouped ? ' active' : '');
            var m = colMeta.get(key);
            if (m) renderColumn(key, colTasks.get(key) || [], m.pName, m.rId);
          }

          function rerenderAllColumns() {
            colMeta.forEach(function(meta, key) {
              renderColumn(key, colTasks.get(key) || [], meta.pName, meta.rId);
            });
          }

          function toggleGroup(key, groupName) {
            var s = getColState(key);
            var collapsed = (s.collapsed || []).slice();
            var idx = collapsed.indexOf(groupName);
            if (idx >= 0) collapsed.splice(idx, 1); else collapsed.push(groupName);
            setColState(key, { collapsed: collapsed });
            var m = colMeta.get(key);
            if (m) renderColumn(key, colTasks.get(key) || [], m.pName, m.rId);
          }

          // ── Auth banner & modal ─────────────────────────────────────────────

          async function checkAuthStatus() {
            try {
              const res = await fetch('/api/auth/status');
              authState = await res.json();
              renderAuthBanner();
            } catch(e) { /* ignore */ }
          }

          function renderAuthBanner() {
            const banner = document.getElementById('authBanner');
            const icon = document.getElementById('authBannerIcon');
            const text = document.getElementById('authBannerText');
            if (!banner) return;
            if (authState && authState.authenticated && hasSyncSetup) {
              // State 3: authenticated + sync ready → compact green button
              banner.className = 'auth-btn auth-btn-ok';
              icon.textContent = '\u2713';
              text.textContent = 'Authenticated';
            } else if (authState && authState.authenticated && !hasSyncSetup) {
              // State 2: authenticated but no repo → compact blue button
              banner.className = 'auth-btn auth-btn-info';
              icon.textContent = '\u2192';
              text.textContent = 'Connect repo';
            } else {
              // State 1: no authentication → compact amber button
              banner.className = 'auth-btn auth-btn-warn';
              icon.textContent = '\u26a0';
              text.textContent = 'Set up auth';
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

          async function createAndInit() {
            const repoName = document.getElementById('repoNameInput').value.trim();
            if (!repoName) { alert('Please enter a repo name'); return; }
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

            // 3. Init all detected providers
            try {
              const r = await fetch('/api/init', {
                method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
                body: JSON.stringify({ repoUrl: cloneUrl })
              });
              const d = await r.json();
              if (d.success) {
                toast('\u2713 Sync initialized');
                closeAuthModal();
                load();
              } else { msgEl.className = 'msg-err'; msgEl.textContent = d.error || 'Initialization failed'; }
            } catch(e) { msgEl.className = 'msg-err'; msgEl.textContent = 'Error: ' + e.message; }
          }

          async function initExisting() {
            const repoUrl = document.getElementById('existingRepoUrl').value.trim();
            if (!repoUrl) { alert('Please enter a repository URL'); return; }
            if (!repoUrl.startsWith('http') && !repoUrl.startsWith('git@')) { alert('Please enter a valid URL (https:// or git@)'); return; }
            const msgEl = document.getElementById('existingMsg');
            msgEl.style.display = 'block'; msgEl.className = 'msg-spin'; msgEl.textContent = 'Initializing sync...';
            try {
              const r = await fetch('/api/init', {
                method: 'POST', headers: authHeaders({'Content-Type':'application/json'}),
                body: JSON.stringify({ repoUrl })
              });
              const d = await r.json();
              if (d.success) { toast('\u2713 Sync initialized'); closeAuthModal(); load(); }
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
            const inp = document.querySelector('#providersDropdown input[data-col-key="' + key + '"]');
            if (inp) inp.checked = isNowVisible;
            updateProvidersCount();
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
            allTasks.clear(); colTasks.clear(); colMeta.clear(); colPaging.clear();
            const res = await fetch('/api/providers');
            const { providers } = await res.json();
            // Update banner: check if any provider root has sync initialized
            hasSyncSetup = providers.some(function(p) { return p.roots.some(function(r) { return r.syncInitialized; }); });
            renderAuthBanner();
            board.innerHTML = '';
            const togglesEl = document.getElementById('columnToggles');
            var totalCols = 0, visibleCols = 0, dropdownHtml = '';
            for (const p of providers) {
              for (const r of p.roots) {
                const key = getColumnKey(p.name, r.id);
                const visible = isColumnVisible(p.name, r.id);
                totalCols++;
                if (visible) visibleCols++;
                dropdownHtml += '<label><input type="checkbox" ' + (visible ? 'checked' : '') + ' data-col-key="' + key + '"> '
                  + escHtml(p.name) + ' (' + escHtml(r.label) + ')</label>';
              }
            }
            togglesEl.innerHTML = '<div class="providers-toggle-wrap">'
              + '<button class="providers-btn" id="providersBtn" onclick="toggleProvidersDropdown()">'
              + 'Providers <span class="providers-count" id="providersCount">(' + visibleCols + '/' + totalCols + ')</span> &#9660;</button>'
              + '<div class="providers-dropdown" id="providersDropdown" style="display:none;">' + dropdownHtml + '</div>'
              + '</div>';
            togglesEl.querySelectorAll('.providers-dropdown input').forEach(function(inp) {
              var key = inp.getAttribute('data-col-key') || '';
              var colonIdx = key.indexOf(':');
              var pName = key.substring(0, colonIdx);
              var rId = key.substring(colonIdx + 1);
              inp.addEventListener('change', function() {
                toggleColumn(pName, rId);
                updateProvidersCount();
              });
            });
            const taskLists = new Map();
            for (const p of providers) {
              for (const r of p.roots) {
                const key = getColumnKey(p.name, r.id);
                const col = document.createElement('div');
                col.className = 'column';
                col.setAttribute('data-col-key', key);
                if (!isColumnVisible(p.name, r.id)) col.style.display = 'none';
                col.innerHTML = \`
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <h3 style="margin:0;text-transform:capitalize;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      \${p.name}
                      <span title="\${r.label}" style="color:#a1a1aa;cursor:help;line-height:1;user-select:none;display:inline-flex;" aria-label="\${r.label}">${ICON_INFO}</span>
                      <span style="font-size:10px;font-weight:600;color:#a16207;background:#fef9c3;border:1px solid #fde68a;padding:1px 6px;border-radius:4px;display:\${r.isInitialized ? 'none' : 'inline'}">not detected</span>
                    </h3>
                    \${buildColHeaderControls(p.name, r.id, key, r, p.name === 'captured')}
                  </div>
                  \${r.isInitialized ? buildSearchBar(key) : ''}
                  <div class="task-list" data-provider="\${p.name}" data-root="\${r.id}" style="min-height:0;"></div>
                  <div class="col-pagination" data-provider="\${p.name}" data-root="\${r.id}" style="display:none;"></div>
                \`;
                colMeta.set(key, { pName: p.name, rId: r.id });
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
                if (Array.isArray(tasks)) { for (const t of tasks) allTasks.set(t.taskId, t); }
                const fetchedTasks = Array.isArray(tasks) ? tasks : [];
                colTasks.set(key, fetchedTasks);
                renderColumn(key, fetchedTasks, p.name, r.id);
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
            if (data.success) {
              toast('Task deleted');
              allTasks.delete(taskId);
              const key = getColumnKey(provider, rootId);
              var updated = (colTasks.get(key) || []).filter(function(t) { return t.taskId !== taskId; });
              colTasks.set(key, updated);
              renderColumn(key, updated, provider, rootId);
            } else {
              toast('Delete failed: ' + (data.error || 'Unknown error'), 'error');
            }
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

          function toast(msg, type, opts) {
            const t = document.createElement('div');
            const kind = (type === 'error' || type === 'info') ? type : 'success';
            t.className = 'toast toast-' + kind;
            t.textContent = msg;
            document.body.appendChild(t);

            let closed = false;
            function closeToast() {
              if (closed) return;
              closed = true;
              t.style.transition = 'opacity 0.3s';
              t.style.opacity = '0';
              setTimeout(function() { t.remove(); }, 350);
            }

            const sticky = !!(opts && opts.sticky);
            if (!sticky) {
              const duration = (opts && typeof opts.duration === 'number') ? opts.duration : 4000;
              setTimeout(closeToast, duration);
            }

            return { close: closeToast };
          }

          function getCopyCacheKey(provider, rootId, taskId, mode, includeTooling) {
            return provider + '|' + rootId + '|' + taskId + '|' + mode + '|' + String(includeTooling);
          }

          function setBusyCursor(enabled) {
            if (enabled) {
              busyCursorCount += 1;
              document.body.classList.add('cursor-busy');
              return;
            }
            busyCursorCount = Math.max(0, busyCursorCount - 1);
            if (busyCursorCount === 0) {
              document.body.classList.remove('cursor-busy');
            }
          }

          function isClipboardFocusError(err) {
            const msg = ((err && (err.message || err.name)) || '').toString().toLowerCase();
            return msg.includes('notfocused')
              || msg.includes('not focused')
              || msg.includes('document is not focused')
              || msg.includes('notallowederror');
          }

          async function writeClipboardSafely(text) {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
              throw new Error('Clipboard not available in this browser/context');
            }

            if (!document.hasFocus()) {
              return { copied: false, needsFocus: true };
            }

            try {
              await navigator.clipboard.writeText(text);
              return { copied: true, needsFocus: false };
            } catch (err) {
              if (isClipboardFocusError(err)) {
                return { copied: false, needsFocus: true };
              }
              throw err;
            }
          }

          // ── Column header controls — MCP pill, ⚡ Connect button, ⋯ menu ──

          function buildColHeaderControls(pName, rId, key, r, isCaptured) {
            var showSync = r.isInitialized && r.syncInitialized && !isCaptured;
            var hasMcp = !!r.mcpClientId;
            var configured = !!r.mcpConfigured;
            var showConnectBtn = hasMcp && !configured && r.isInitialized && !isCaptured;
            var showPill = hasMcp && configured && !isCaptured;
            var h = '<div style="display:flex;align-items:center;gap:6px;">';
            if (showConnectBtn) {
              h += '<button class="btn-mcp-connect" onclick="connectMcp(\\'' + pName + '\\',\\'' + rId + '\\')">&#9889; Connect MCP</button>';
            }
            if (showPill) {
              h += '<span class="mcp-pill">&#9679; MCP</span>';
            }
            h += '<div class="col-menu-wrap">';
            h += '<button class="col-menu-btn" onclick="toggleColMenu(\\'' + key + '\\')">&#8943;</button>';
            h += '<div class="col-menu" id="col-menu-' + key + '">';
            if (showSync) {
              h += '<button class="col-menu-item" onclick="sync(\\'' + pName + '\\',\\'' + rId + '\\');toggleColMenu(\\'' + key + '\\')">&#8635; Sync</button>';
            }
            if (!isCaptured && hasMcp) {
              var mcpLabel = configured ? '&#9679; MCP configured' : '&#9889; Connect MCP';
              h += '<button class="col-menu-item" onclick="connectMcp(\\'' + pName + '\\',\\'' + rId + '\\');toggleColMenu(\\'' + key + '\\')">' + mcpLabel + '</button>';
            }
            if (r.isInitialized && !isCaptured) {
              var isGrouped = getColState(key).grouped;
              h += '<div class="col-menu-sep"></div>';
              h += '<button id="menu-group-' + key + '" class="col-menu-item' + (isGrouped ? ' active' : '') + '" onclick="toggleGrouping(\\'' + key + '\\');toggleColMenu(\\'' + key + '\\')">Group by workspace</button>';
            }
            h += '</div></div></div>';
            return h;
          }

          async function connectMcp(provider, rootId) {
            toast('Connecting MCP for ' + provider + '...');
            try {
              const res = await fetch('/api/mcp/install', {
                method: 'POST', headers: authHeaders({'Content-Type': 'application/json'}),
                body: JSON.stringify({ provider, rootId })
              });
              const d = await res.json();
              if (d.success) {
                const msgs = { installed: 'MCP connected! Reload VS Code to activate.', updated: 'MCP entry updated. Reload VS Code to activate.', 'already-current': 'MCP already configured.' };
                toast('\u2713 ' + (msgs[d.status] || 'MCP configured.'));
                load();
              } else { toast('MCP connect failed: ' + (d.error || 'Unknown error'), 'error'); }
            } catch(e) { toast('MCP connect failed: ' + e.message, 'error'); }
          }

          function toggleColMenu(key) {
            const menu = document.getElementById('col-menu-' + key);
            if (!menu) return;
            const isOpen = menu.style.display === 'block';
            document.querySelectorAll('.col-menu').forEach(m => { m.style.display = 'none'; });
            if (!isOpen) menu.style.display = 'block';
          }

          document.addEventListener('click', function(e) {
            if (!e.target.closest('.col-menu-wrap')) {
              document.querySelectorAll('.col-menu').forEach(m => { m.style.display = 'none'; });
            }
            if (!e.target.closest('.providers-toggle-wrap')) {
              var d = document.getElementById('providersDropdown');
              if (d) d.style.display = 'none';
            }
          });

          // ── Providers dropdown ─────────────────────────────────────────────

          function toggleProvidersDropdown() {
            var d = document.getElementById('providersDropdown');
            if (d) d.style.display = (d.style.display === 'none' ? 'block' : 'none');
          }

          function updateProvidersCount() {
            var inputs = document.querySelectorAll('#providersDropdown input');
            var total = inputs.length;
            var checked = Array.from(inputs).filter(function(i) { return i.checked; }).length;
            var span = document.getElementById('providersCount');
            if (span) span.textContent = '(' + checked + '/' + total + ')';
          }

          // ── Copy task context to clipboard ─────────────────────────────────

          async function copyTaskContext(provider, rootId, taskId, e) {
            e.stopPropagation();
            const wantsFullWithTools = !!(e && e.shiftKey);
            const wantsFullNoTools = !!(e && e.altKey);
            const mode = (wantsFullWithTools || wantsFullNoTools) ? 'full' : 'smart';
            const includeTooling = wantsFullWithTools ? true : wantsFullNoTools ? false : false;
            const modeLabel = mode === 'smart'
              ? 'Smart Context'
              : (includeTooling ? 'Full Context' : 'Full Context (no tool logs)');

            const key = getCopyCacheKey(provider, rootId, taskId, mode, includeTooling);
            if (copyInFlight.has(key)) {
              toast('Already generating context for this task...', 'info', { duration: 2200 });
              return;
            }

            let loadingToast = null;
            try {
              copyInFlight.add(key);
              setBusyCursor(true);
              loadingToast = toast('Generating ' + modeLabel + '... this can take a few seconds', 'info', { sticky: true });

              let text = copyContextCache.get(key);
              if (!text) {
                let url = '/api/tasks/rehydrate?provider=' + encodeURIComponent(provider)
                  + '&rootId=' + encodeURIComponent(rootId)
                  + '&taskId=' + encodeURIComponent(taskId)
                  + '&mode=' + encodeURIComponent(mode);
                if (mode === 'full') {
                  url += '&includeTooling=' + encodeURIComponent(String(includeTooling));
                }
                const res = await fetch(url);
                const data = await res.json();
                if (!data.text) {
                  throw new Error(data.error || 'unknown');
                }
                text = data.text;
                copyContextCache.set(key, text);
              }

              const copyResult = await writeClipboardSafely(text);
              if (copyResult.copied) {
                toast('\u2713 ' + modeLabel + ' copied \u2014 paste into any AI tool');
              } else {
                toast(modeLabel + ' is ready. Return to this tab and click Copy again to place it on your clipboard.', 'info', { duration: 7000 });
              }
            } catch(err) {
              toast('Copy failed: ' + err.message, 'error');
            } finally {
              copyInFlight.delete(key);
              setBusyCursor(false);
              if (loadingToast && typeof loadingToast.close === 'function') loadingToast.close();
            }
          }

          // ── Help modal ─────────────────────────────────────────────────────

          function openHelpModal() {
            buildHelpToc();
            document.getElementById('helpModal').style.display = 'flex';
          }

          function closeHelpModal() {
            var m = document.getElementById('helpModal');
            if (m) m.style.display = 'none';
          }

          function buildHelpToc() { /* no sidebar — content scrolls freely */ }

          function scrollHelpTo(id) {
            var el = document.getElementById(id);
            var content = document.getElementById('helpContent');
            if (el && content) content.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
          }

          window.addEventListener('resize', function() {
            if (resizeRenderTimer) clearTimeout(resizeRenderTimer);
            resizeRenderTimer = setTimeout(function() {
              rerenderAllColumns();
            }, 120);
          });

          checkAuthStatus();
          load();
        </script>
      </body>
      </html>
    `);
  });
}
