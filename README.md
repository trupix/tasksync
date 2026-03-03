# TaskSync

The canonical task state layer for AI assistants.

TaskSync turns your AI assistant task history into a portable, versioned, reproducible database — owned entirely by you.

Built local-first. Powered by Git. Designed for multi-agent futures.

**Today:**

* Sync Cline across machines
* Migrate tasks between assistants (Cline, Roo, Kilo, OpenClaw)
* Replay and inspect canonical task history

**Tomorrow:**

* Unified cloud-addressable tasks
* Context-safe collaboration
* Model-aware alignment layers
* Fork / merge semantics for AI execution

TaskSync is the missing infrastructure between "chat history" and real AI-native work.

**Privacy first. Your data never touches TaskSync servers.**

---

## Why TaskSync Exists

AI assistants store critical task history locally in opaque formats.

That makes it:

* Hard to sync across machines
* Impossible to collaborate safely
* Fragile when switching assistants
* Risky when upgrading models
* Non-reproducible when debugging

TaskSync introduces a canonical task layer:

```
provider task ? canonical ingest ? canonical state ? deterministic replay
```

Instead of treating assistant output as ephemeral chat, TaskSync treats it as structured state.

That unlocks:

* Reproducible task migrations
* Cross-assistant portability
* Versioned AI execution history
* Deterministic replay
* Explicit machine and workspace identity

TaskSync is not a sync script.

It is a task state engine.

---

## Core Principles

**Local-first**
Everything works without a hosted backend.

**User-owned**
You control the Git remote, access tokens, and encryption.

**Canonical-first**
All migrations pass through a structured canonical representation.

**Deterministic**
Tasks can be replayed and materialized consistently.

**Composable**
Designed to support multi-agent orchestration and future cloud task envelopes.

---

## What It Does Today

### 1. Sync Cline Across Machines

Cline stores task data in:

```
~/.cline/data/
```

TaskSync converts that directory into a managed Git repository and syncs it to a private remote you own.

On each machine:

```bash
TaskSync init
```

* Initializes Git
* Writes a managed `.gitignore`
* Creates workspace identity
* Performs initial push

```bash
TaskSync sync
```

* Pull (rebase)
* Commit local changes
* Push

You now have portable task history.

---

### 2. Multi-Provider Migration (Canonical Architecture)

TaskSync supports:

* Cline
* Roo
* Kilo
* OpenClaw

All migrations use a canonical-first pipeline:

```
provider task
? canonical ingest
? canonical state
? canonical replay/materialize
? target provider
```

This ensures:

* High-fidelity migration
* Structural normalization
* Future-proof portability

Legacy bundle-based migration is deprecated.

---

### 3. Local Dashboard

```bash
TaskSync dashboard
```

Features:

* View tasks across providers
* Inspect canonical state
* Drag-and-drop migrations
* Replay canonical runs
* Compare task lineage

This is not a static viewer — it reflects the underlying canonical graph.

---

## Install

```bash
git clone https://github.com/trupix/TaskSync.git
cd TaskSync
npm install
npm run build
npm link
```

The `TaskSync` command is now available system-wide.

---

## Quick Start

**1. Create a private GitHub repository**
Do not initialize it with files.

**2. Generate a GitHub Personal Access Token**
Scope required: `repo`

**3. Initialize on first machine:**

```bash
# Option A: SSH (recommended — no token needed)
TaskSync init git@github.com:YOUR_USERNAME/my-cline-db.git

# Option B: HTTPS with ephemeral PAT (never stored in git config)
TaskSync init https://github.com/YOUR_USERNAME/my-cline-db.git --pat ghp_YOURTOKEN

# Option C: HTTPS with env var
export TaskSync_GIT_TOKEN=ghp_YOURTOKEN
TaskSync init https://github.com/YOUR_USERNAME/my-cline-db.git
```

**4. On additional machines:**

```bash
TaskSync init git@github.com:YOUR_USERNAME/my-cline-db.git
```

**5. Sync anytime:**

```bash
TaskSync sync
```

> **Note:** PATs are never stored in git remote URLs or config files. They are passed ephemerally via `GIT_ASKPASS` for a single command, then discarded. SSH is the recommended auth method.

---

## What Gets Synced

**Synced:**

* `tasks/`
* workspace state
* `globalState.json`
* checkpoints
* `.TaskSync_manifest.json`

**Excluded:**

* `secrets.json`
* `cache/`, `temp/`, `logs/`
* puppeteer / browser binaries
* `*.log`, `*.token`, `*.auth`
* `node_modules/`, `.DS_Store`

The exclusion list is automatically maintained under:

```
~/.cline/data/.gitignore
```

---

## Identity Model

**Machine ID**
Stored locally in `~/.TaskSync/config.json`
Never synced.

**Workspace ID**
Stored in `~/.cline/data/.TaskSync_manifest.json`
Synced across machines.

Machine identity ? Workspace identity.

This separation enables deterministic merges and future collaborative models.

---

## Canonical Architecture (Conceptual)

```
Machine
?
Provider Adapter
?
Canonical Task Graph
?
Materializer
?
Target Provider
```

All state changes flow through the canonical graph.

This is the foundation for:

* Task envelopes
* Redacted context packs
* Fork / merge semantics
* Multi-agent orchestration
* Cloud task addressing

---

## Security Model

* No hosted backend, no telemetry, no data proxying
* Git commands use `execFile` (no shell) — immune to injection
* Credentials never stored in git config or remote URLs (ephemeral `GIT_ASKPASS`)
* Dashboard mutation APIs require a per-session auth token (auto-injected, invisible to user)
* All filesystem operations enforce centralized path traversal guards
* Error messages are redacted before API exposure (no credential leakage)

You own the repository, the remote, the authentication, and the encryption strategy.

TaskSync operates entirely within your trust boundary.

See [SECURITY.md](SECURITY.md) for the full security policy.

## Schema Governance

TaskSync currently operates with two version domains:

1. Canonical run-store schema (`CANONICAL_SCHEMA_VERSION`)
2. Provider manifest schema (`.TaskSync_manifest.json` `schemaVersion` via provider `getSchemaVersion()`)

The canonical schema is versioned and governed by an explicit compatibility contract.

See [docs/SCHEMA_COMPATIBILITY.md](docs/SCHEMA_COMPATIBILITY.md) for:
* What changes require a version increment
* Backward compatibility guarantees
* Migration requirements and upgrade path
* End-to-end compatibility matrix across CLI/dashboard/API flows
* Canonical DB rebuild/recovery contract (`TaskSync canonical reconcile`)

---

## Troubleshooting

**Merge conflict during sync:**

Resolve conflict markers in `~/.cline/data`, then run:

```bash
git add .
git rebase --continue
TaskSync sync
```

**Authentication failed:**

Ensure PAT has `repo` scope and re-run `TaskSync init`.

**Cline directory missing:**

Ensure Cline has been run at least once, or override the path:

```bash
CLINE_DIR=/custom/path TaskSync status
```

---

## Roadmap

| Version | Status |
|---------|--------|
| v0.2.0 — Multi-provider support (Cline, Roo, Kilo, OpenClaw) | ? Complete |
| v0.3.0 — Encrypted hosted sync backend (optional) | ?? Planned |
| v0.4.0 — Unified Task object, Fork/merge semantics, Task envelopes, Cloud-addressable tasks | ?? Planned |

---

## Vision

TaskSync is Phase 1 of a larger system:

```
TaskSync ? Canonical Task Layer ? Agents Cloud
```

Where:

* Tasks are first-class objects
* Context is structured and portable
* AI execution is versioned
* Collaboration is explicit
* Model alignment becomes programmable

We believe agentic systems need real state infrastructure.

**TaskSync is that layer.**
