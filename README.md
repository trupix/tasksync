# TaskSync

Portable AI session sync for Cline, Roo Code, and OpenClaw.

TaskSync keeps your AI coding sessions consistent across machines using Git as a private backend.

AI coding sessions are stateful. Your infrastructure should be too.

Start a session on your work machine. Continue it on your laptop.  
No hosted servers. No background daemons. Just your repo.

---

## What TaskSync Does

TaskSync synchronizes AI assistant state across machines.

**Currently supported providers:**

- Cline
- Roo Code
- OpenClaw

**Temporarily unsupported:**

- Kilo Code — Kilo's storage model is currently too version-specific and unstable for TaskSync to support reliably. Kilo v5 depends on extension-managed/private state beyond simple file mirroring, and Kilo v6 moved to a different SQLite-backed architecture. Because TaskSync is open source, contributions are welcome if someone finds a clean, durable integration path.

Each provider is synced independently to prevent UI conflicts or state corruption.

TaskSync also includes a local dashboard for viewing sessions across providers and manually migrating tasks between them.

TaskSync can also run as a local MCP server — a **bi-directional context hub** — so MCP-capable assistants can both retrieve prior task context and push new context back into TaskSync. This means you can capture work done in Cursor, Claude Desktop, Windsurf, or any MCP-capable tool, store it in TaskSync, and continue it in any other tool.

---

## Core Principles

- Local-first
- Git-powered
- No cloud dependency
- No auto-merging across tools
- Explicit cross-tool migration only
- MCP as an additional context bridge interface, not a replacement for the CLI
- `capture_context` is the only MCP write operation — it writes exclusively to TaskSync-owned storage and never mutates provider-native stores

---

## Prerequisites

- **Node.js** 16+ (ES2022 support required)
- **Git** installed and configured
- **GitHub account** with ability to create private repositories

---

## Installation (Local Development)

Clone the repository:

```bash
git clone https://github.com/trupix/tasksync.git
cd tasksync
npm install
npm run build
```

Run the CLI directly:

```bash
node build/cli.js setup
node build/cli.js dashboard
node build/cli.js mcp
node build/cli.js --help
```

Or link it globally for development:

```bash
npm link
tasksync setup
tasksync dashboard
tasksync mcp
tasksync --help
```

---

## Quick Start

### Easiest: Use the Dashboard

The dashboard can automatically create your sync repository and handle everything:

```bash
# 1. Launch the dashboard
tasksync dashboard

# 2. In your browser:
#    - Click "Set up auth" and paste your GitHub Personal Access Token
#    - Enter a repository name (e.g., "tasksync-data")
#    - Click "Create repo & initialize sync"
#    - Done! Your AI sessions are now syncing
```

The dashboard automatically:
- Creates a private GitHub repository
- Detects all installed AI providers
- Sets up sync for all providers in one step

### Alternative: CLI Setup

If you prefer the command line:

```bash
# 1. Set up GitHub authentication
tasksync auth

# 2. Manually create a private repository on GitHub
#    Visit: https://github.com/new
#    Make sure it's set to Private

# 3. Initialize sync (replace with your repo URL)
tasksync init https://github.com/username/my-ai-sync.git

# 4. Sync your sessions
tasksync sync
```

**Supported providers:** `cline` · `roo` · `openclaw`

If multiple storage roots are detected (e.g., VS Code + VS Code Server), you will be prompted to select one.

### View Status

```bash
tasksync status
```

Displays:
- All configured providers
- Sync repository location
- Remote URL
- Last sync timestamp
- Uncommitted changes

### Access the Dashboard

```bash
tasksync dashboard
```

Launches at `http://127.0.0.1:3210` (localhost only, not network-accessible)

Dashboard features:
- View sessions/tasks per provider
- Trigger manual sync
- Drag & drop tasks between supported providers (explicit migration only)
- Edit task workspace paths
- Manage GitHub authentication

---

## CLI Commands Reference

### Main Commands

### `tasksync setup`
Guided first-time setup wizard. Detects providers, sets up authentication, and connects to a sync repository.

```bash
tasksync setup
```

### `tasksync init <repoUrl>`
Initialize sync with a GitHub repository.

```bash
# Initialize for all detected providers
tasksync init https://github.com/username/my-sync-repo.git

# Initialize for a specific provider only
tasksync init --provider cline https://github.com/username/cline-sync.git

# Include GitHub PAT directly (alternative to tasksync auth)
tasksync init --pat ghp_yourtoken https://github.com/username/repo.git
```

**Options:**
- `--provider <name>` — Limit initialization to specific provider (cline, roo, openclaw)
- `--pat <token>` — GitHub Personal Access Token (alternative to `tasksync auth`)

### `tasksync sync`
Pull remote changes and push local changes.

```bash
# Sync all detected providers
tasksync sync

# Sync a specific provider only
tasksync sync --provider cline
```

**Options:**
- `--provider <name>` — Sync only the specified provider

Performs:
- `git pull --rebase` (retrieve remote changes)
- Stage local changes
- Commit if needed
- `git push` (upload local changes)
- Update manifest timestamp

### `tasksync status`
Show sync configuration and status for all providers.

```bash
tasksync status
```

Displays:
- Sync repository path
- Machine ID
- Remote URL
- Workspace ID
- Last sync time per provider
- Uncommitted changes

### `tasksync dashboard`
Launch the local web dashboard.

```bash
# Launch on default port (3210)
tasksync dashboard

# Launch on custom port
tasksync dashboard --port 8080

# Launch without auto-opening browser
tasksync dashboard --no-open
```

**Options:**
- `--port <number>` — Port to run dashboard on (default: 3210)
- `--no-open` — Don't automatically open browser

### `tasksync mcp`
Run the local TaskSync MCP server over stdio.

```bash
tasksync mcp
```

This starts a local MCP endpoint for MCP-capable assistants. It supports:
- discovering prior TaskSync tasks across all providers
- retrieving summaries, transcripts, and workspace context
- building continuation packets for cross-assistant rehydration
- **capturing context from any MCP-capable tool** into TaskSync-owned storage

The MCP server is intentionally:
- local-first (no network listener, no daemon)
- provider-agnostic at the tool surface
- `capture_context` is the only write operation — never mutates provider-native stores
- not a native session injector for Cursor or any other host app

### `tasksync mcp install`

Automatically write the TaskSync MCP server configuration into a supported AI tool's config file.

```bash
# Install for all detected clients
tasksync mcp install

# Install for a specific client
tasksync mcp install --client cursor
tasksync mcp install --client claude-desktop
tasksync mcp install --client windsurf
```

Supported clients: `cursor`, `claude-desktop`, `windsurf`

Config file locations:

| Client | Windows | macOS | Linux |
|--------|---------|-------|-------|
| Cursor | `%USERPROFILE%\.cursor\mcp.json` | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` | `~/.config/claude-desktop/claude_desktop_config.json` |
| Windsurf | `%USERPROFILE%\.codeium\windsurf\mcp.json` | `~/.codeium/windsurf/mcp.json` | `~/.codeium/windsurf/mcp.json` |

The install command uses a safe merge — it adds or updates only the `tasksync` entry in `mcpServers` and preserves all other existing entries and config keys.

After installing, **restart the client** to activate the MCP server.

### `tasksync mcp print-config`

Print a ready-to-paste MCP config snippet.

```bash
# Generic snippet (works for any client)
tasksync mcp print-config

# Client-specific snippet with config file path
tasksync mcp print-config --client cursor
tasksync mcp print-config --client claude-desktop
tasksync mcp print-config --client windsurf
```

### `tasksync mcp doctor`

Validate the TaskSync MCP setup on this machine.

```bash
tasksync mcp doctor
```

Checks:
- Whether `tasksync` is on PATH
- Whether `build/cli.js` exists (for local/dev installs)
- Which MCP clients are installed and whether they have the `tasksync` entry configured
- Captured context store status and task count

Example output:

```
  ● TaskSync CLI
  ✓  tasksync found on PATH
     /usr/local/bin/tasksync

  ● MCP client setup
  ✓  Cursor            ✓ detected  |  config: exists  |  tasksync: ✓ configured
  ✓  Claude Desktop    ✓ detected  |  config: exists  |  tasksync: ✓ configured
  ✗  Windsurf          ✗ not detected  ...
       → Run: tasksync mcp install --client windsurf

  ● Captured context store
     Path: ~/.TaskSync/captured
     Status: exists — 3 tasks captured
     Latest: "Refactoring auth module for multi-tenant support" (2026-03-10)
```

### TaskSync MCP

TaskSync MCP is a local context hub. It lets MCP-capable assistants both retrieve prior task context and push new context into TaskSync without changing the core storage/sync model.

**Connection model:**

```
Provider-native tasks  ──► TaskSync ──► MCP read tools ──► any MCP-capable tool
MCP capture_context    ──► TaskSync ──► same read/query/rehydration paths
```

It is designed for:
- cross-assistant context transfer
- task discovery across all providers
- summary retrieval
- transcript inspection
- workspace context recovery
- structured rehydration packets
- **capturing context from any MCP-capable tool into TaskSync**

It is **not** designed for:
- mutating provider-native task stores (Cline, Roo, etc.)
- native session restoration inside another app
- host-specific hacks or private database writes
- replacing direct sync for supported providers

### Exposed MCP tools

##### Read tools

- `list_tasks` — list tasks across all providers including captured
- `search_tasks` — full-text search across titles, summaries, and transcripts
- `get_task_summary` — deterministic summary without model dependency
- `get_task_transcript` — normalized transcript with optional truncation
- `get_workspace_context` — workspace path, repo name, and remote URLs
- `rehydrate_task` — structured continuation packet for cross-assistant rehydration

##### Write tool: `capture_context`

The only write tool. Stores portable context from any MCP-capable assistant into TaskSync-owned storage (`~/.TaskSync/captured/`).

```json
{
  "title": "Refactoring auth module for multi-tenant support",
  "summary": "...",
  "workspacePath": "/Users/me/projects/myapp",
  "transcript": "User: ...\nAssistant: ...",
  "decisions": ["Use JWT with org scoping", "Add refresh token rotation"],
  "todos": ["Write migration for existing users", "Update OpenAPI spec"],
  "touchedFiles": ["src/auth/index.ts", "src/middleware/jwt.ts"],
  "sourceApp": "cursor",
  "tags": ["auth", "backend"]
}
```

Required: `title`, `summary`. Everything else is optional.

Captured tasks are immediately available via `list_tasks`, `search_tasks`, `get_task_summary`, `get_task_transcript`, `get_workspace_context`, and `rehydrate_task`.

**Sync note:** Captured tasks are currently stored locally only in `~/.TaskSync/captured/`. Sync participation (git push/pull of captured tasks) is planned as follow-up work.

### `rehydrate_task` modes

Supported modes:

- `summary`
- `full_transcript`
- `decisions_only`
- `requirements_and_todos`
- `workspace_context`

These modes produce best-effort structured continuation packets derived from stored task data. They are deterministic and do not depend on an external model.

### Running TaskSync MCP locally

Start the server with:

```bash
tasksync mcp
```

The server uses **stdio** transport, which is the preferred v1 transport for local CLI-based MCP integrations.

### Conceptual MCP client configuration

An MCP client typically launches TaskSync like this:

```json
{
  "mcpServers": {
    "tasksync": {
      "command": "tasksync",
      "args": ["mcp"]
    }
  }
}
```

For local development from this repository, you can also point the client at the built CLI:

```json
{
  "mcpServers": {
    "tasksync": {
      "command": "node",
      "args": ["/absolute/path/to/tasksync/build/cli.js", "mcp"]
    }
  }
}
```

### Current limitations

- `capture_context` writes to TaskSync-owned storage only — no provider-native mutation
- Captured tasks are local-only (sync across machines is follow-up work)
- No host-native session injection
- No Cursor-native provider work
- Transcript normalization is best-effort across provider formats
- Workspace metadata depends on what the provider stored on disk

### Authentication Commands

### `tasksync auth`
Set up GitHub authentication (interactive).

```bash
tasksync auth
```

Prompts for a GitHub Personal Access Token and verifies it with the GitHub API. Token is stored securely in `~/.TaskSync/auth.json` with 600 permissions.

**To create a token:**
1. Visit https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scope: **repo** (full control of private repositories)
4. If syncing to an organization repo, you may also need the **admin:org** scope

**Note:** Keep your token secure. TaskSync stores it locally with restricted permissions (chmod 600).

### `tasksync auth status`
Show current authentication status.

```bash
tasksync auth status
```

Displays:
- Authentication method (PAT, environment variable, or none)
- GitHub username
- Masked token (first 4 + last 4 characters)
- Verification timestamp

### `tasksync auth logout`
Remove stored GitHub token.

```bash
tasksync auth logout
```

Deletes `~/.TaskSync/auth.json`. Does not affect environment variables.

### `tasksync auth verify`
Re-verify that the stored token is still valid.

```bash
tasksync auth verify
```

Makes a test request to GitHub API to confirm token validity.

### Version

```bash
tasksync --version
tasksync -v
```

Display TaskSync version.

### Help

```bash
tasksync --help
tasksync <command> --help
```

Display help for any command.

---

## Sync vs Migration

### Sync

Sync keeps the same provider consistent across machines. **Providers are never automatically merged.** Running `tasksync sync --provider cline` syncs only Cline data — Roo and OpenClaw are unaffected.

| Valid sync pairs    |
|---------------------|
| Cline ↔ Cline       |
| Roo ↔ Roo           |
| OpenClaw ↔ OpenClaw |

Cross-provider sync is not supported.

> **Note on Kilo Code:** Kilo is temporarily unsupported. See `kilo-migration-issue.md` for the investigation summary and rationale.

### Migration

Migration is manual and explicit. From the dashboard, drag a task from one provider to another. This creates a copy in the target provider with its provenance recorded.

- No automatic merging
- No folder mixing
- Original task remains in the source provider
- Provenance is preserved

---

## Provider Data Locations

### Cline

**macOS:**
```
~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev
```

**Linux:**
```
~/.config/Code/User/globalStorage/saoudrizwan.claude-dev
```

**Windows:**
```
%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev
```

**Override:**
```bash
CLINE_DIR=/custom/path
```

### Roo Code

**macOS:**
```
~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline
```

**Linux:**
```
~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline
```

**Windows:**
```
%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline
```

**Override:**
```bash
ROO_DIR=/custom/path
```

### Kilo Code (temporarily unsupported)

Kilo is documented here for historical/reference purposes only. TaskSync does **not** currently claim reliable support for Kilo.

Why:
- Kilo v5 relies on additional extension-managed state beyond the task files on disk
- Kilo v6+ moved to a different SQLite-based architecture entirely
- TaskSync cannot currently guarantee reliable sync/migration behavior across Kilo versions

If someone in the community finds a clean integration path, contributions are welcome.

**macOS:**
```
~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code
```

**Linux:**
```
~/.config/Code/User/globalStorage/kilocode.kilo-code
```

**Windows:**
```
%APPDATA%\Code\User\globalStorage\kilocode.kilo-code
```

**Override:**
```bash
KILO_DIR=/custom/path
```

### OpenClaw

**Default:**
```
~/.openclaw
```

Includes: `workspace/`, `agents/*/sessions/`, `openclaw.json`

**Overrides:**
```bash
OPENCLAW_DIR=/custom/path
OPENCLAW_WORKSPACE=/custom/workspace
```

---

## Identity Model

TaskSync separates identity into two layers:

**Machine Identity** — stored locally, never committed:
```
~/.TaskSync/config.json
```

**Workspace Identity** — stored in the repo root, synced via Git:
```
.TaskSync_manifest.json
```

Machine ID is never committed. Workspace ID is synced via Git.

---

## Safety & Privacy

**Data Privacy:**
- All AI session data stays in your private Git repository
- No data is sent to any external service
- Dashboard runs locally only (127.0.0.1, not network-accessible)
- GitHub PAT is stored locally with restricted permissions (chmod 600)

**Automatic Exclusions:**

TaskSync automatically excludes sensitive files via `.gitignore`:
- Secret and token files (`secrets.json`, `*.token`, `*.auth`)
- Credentials (`*_secret*`, `*_token*`, `*.credentials`)
- Logs and cache directories (`logs/`, `cache/`, `temp/`)
- Large binaries (>50 MB warning)
- Development artifacts (`node_modules/`, `.DS_Store`)

All credentials are handled ephemerally during Git operations and never written to git config or remote URLs.

---

## Contributing (Commits & Pull Requests)

### Commit Message Format

Use:

```text
type(scope): short imperative summary
```

Recommended `type` values:

- `feat` — new behavior
- `fix` — bug fix
- `refactor` — internal change (no behavior change)
- `test` — tests only
- `docs` — documentation only
- `chore` — maintenance/tooling
- `ci` — CI/workflow updates

Examples:

- `feat(mcp): add capture_context validation for tags`
- `fix(sync): skip pre-pull snapshot when local provider is empty`
- `test(security): add path traversal regression coverage`

### Pull Request Expectations

Please include the following in your PR description:

1. **What changed** — short summary of behavior/code changes
2. **Why** — problem/background
3. **How tested** — commands run (`npm test`, manual dashboard checks, etc.)
4. **Risk / impact** — providers or sync/migration/security paths affected
5. **Screenshots/logs** — for dashboard/UI changes

Additional expectations:

- Keep PRs focused and reasonably small.
- If behavior changes in sync/migration/security logic, add or update tests when feasible.
- Call out breaking changes explicitly.

---

## Roadmap

- Sync participation for captured tasks (`~/.TaskSync/captured/` included in git push/pull)
- Improved native task migration
- Optional encrypted sync
- Binary builds
- Revisit Kilo support if a robust community-backed integration path emerges

---

TaskSync is open source under the MIT License.
