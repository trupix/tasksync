# TaskSync

Portable AI session sync for Cline, Roo, Kilo, and OpenClaw.

TaskSync keeps your AI coding sessions consistent across machines using Git as a private backend.

AI coding sessions are stateful. Your infrastructure should be too.

Start a session on your work machine. Continue it on your laptop.  
No hosted servers. No background daemons. Just your repo.

---

## What TaskSync Does

TaskSync synchronizes AI assistant state across machines.

**Supported providers:**

- Cline
- Roo Code
- Kilo Code
- OpenClaw

Each provider is synced independently to prevent UI conflicts or state corruption.

TaskSync also includes a local dashboard for viewing sessions across providers and manually migrating tasks between them.

---

## Core Principles

- Local-first
- Git-powered
- No cloud dependency
- No auto-merging across tools
- Explicit cross-tool migration only

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
node build/cli.js --help
```

Or link it globally for development:

```bash
npm link
tasksync setup
tasksync dashboard
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

**Supported providers:** `cline` · `roo` · `kilo` · `openclaw`

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
- Drag & drop tasks between providers (explicit migration only)
- Edit task workspace paths
- Manage GitHub authentication

---

## CLI Commands Reference

### Main Commands

#### `tasksync setup`
Guided first-time setup wizard. Detects providers, sets up authentication, and connects to a sync repository.

```bash
tasksync setup
```

#### `tasksync init <repoUrl>`
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
- `--provider <name>` — Limit initialization to specific provider (cline, roo, kilo, openclaw)
- `--pat <token>` — GitHub Personal Access Token (alternative to `tasksync auth`)

#### `tasksync sync`
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

#### `tasksync status`
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

#### `tasksync dashboard`
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

### Authentication Commands

#### `tasksync auth`
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

#### `tasksync auth status`
Show current authentication status.

```bash
tasksync auth status
```

Displays:
- Authentication method (PAT, environment variable, or none)
- GitHub username
- Masked token (first 4 + last 4 characters)
- Verification timestamp

#### `tasksync auth logout`
Remove stored GitHub token.

```bash
tasksync auth logout
```

Deletes `~/.TaskSync/auth.json`. Does not affect environment variables.

#### `tasksync auth verify`
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

Sync keeps the same provider consistent across machines. **Providers are never automatically merged.** Running `tasksync sync --provider cline` syncs only Cline data — Roo, Kilo, and OpenClaw are unaffected.

| Valid sync pairs    |
|---------------------|
| Cline ↔ Cline       |
| Roo ↔ Roo           |
| Kilo ↔ Kilo         |
| OpenClaw ↔ OpenClaw |

Cross-provider sync is not supported.

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

### Kilo Code

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

## Roadmap

- Improved native task migration
- Optional encrypted sync
- Cross-provider task search
- Binary builds
- Cursor support

---

TaskSync is open source under the MIT License.
