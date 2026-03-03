# TaskSync

Portable AI session sync for Cline, Roo, Kilo, and OpenClaw.

TaskSync keeps your AI coding sessions consistent across machines using Git as a private backend.

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

## Installation (Local Development)

Clone the repository:

```bash
git clone <your-repo-url>
cd tasksync
npm install
npm run build
```

You can then run the CLI directly:

```bash
node build/cli.js <command>
```

Or link it globally for development:

```bash
npm link
```

Then:

```bash
tasksync <command>
```

---

## Quick Start

### Initialize Sync

```bash
tasksync init --provider cline https://github.com/your/private-repo.git
```

Supported providers: `cline` · `roo` · `kilo` · `openclaw`

If multiple storage roots are detected (for example VS Code + VS Code Server), you will be prompted to select one.

### Sync State

```bash
tasksync sync --provider cline
```

Performs:

- `git pull --rebase`
- Stage changes
- Commit if needed
- Push
- Update manifest timestamp

### Status

```bash
tasksync status --provider cline
```

Displays:

- Provider
- Root path
- Workspace ID
- Machine ID
- Remote configuration
- Last sync time
- Uncommitted changes

### Dashboard

```bash
tasksync dashboard
```

Launches a local dashboard at:

```
http://127.0.0.1:3210
```

The dashboard allows you to:

- View sessions/tasks per provider
- Trigger manual sync
- Drag & drop tasks between providers (explicit migration only)

---

## Sync vs Migration

### Sync

Sync keeps the same provider consistent across machines.

| ✓ Valid sync pairs |
|--------------------|
| Cline ↔ Cline      |
| Roo ↔ Roo          |
| Kilo ↔ Kilo        |
| OpenClaw ↔ OpenClaw|

Sync never merges different providers automatically.

### Migration

Migration is manual and explicit. Using the dashboard, you can drag a task from one provider to another. This creates an imported task in the target provider.

- No automatic merging
- No folder mixing
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

TaskSync separates identity into:

**Machine Identity** — stored locally, never committed:
```
~/.tasksync/config.json
```

**Workspace Identity** — stored in the repo root, synced via Git:
```
.tasksync_manifest.json
```

Machine ID is never committed. Workspace ID is synced via Git.

---

## Safety

TaskSync excludes:

- Secret and token files
- Logs and cache directories
- Large binaries (>50 MB warning)

It does not send your data to any external service.

---

## Roadmap

- Improved native task migration
- Optional encrypted sync
- Cross-provider task search
- Binary builds
- Cursor support
