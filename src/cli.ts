#!/usr/bin/env node
import { Command } from "commander";
import { ClineProvider } from "./providers/cline";
import { RooProvider } from "./providers/roo";
import { KiloProvider } from "./providers/kilo";
import { OpenClawProvider } from "./providers/openclaw";
import { IProvider, ProviderRoot } from "./providers/interface";
import {
  runUnifiedInit,
  runUnifiedSync,
  UnifiedSyncTarget,
  // Legacy (per-provider) kept for explicit opt-in
  runInit,
  runSync,
  ProviderValidationError,
  SyncNotInitializedError,
  SyncNoRemoteError,
} from "./core/sync";
import { GitError, getRemoteUrl, hasUncommittedChanges, isGitRepo, hasRemote } from "./utils/git";
import { getMachineId, getSyncRepoPath } from "./utils/identity";
import { readUnifiedManifest, TaskSync_VERSION } from "./utils/manifest";
import {
  verifyToken,
  saveToken,
  loadToken,
  deleteToken,
  getAuthStatus,
  isAuthenticated,
  prompt,
  promptSelect,
} from "./utils/auth";
import { startDashboard } from "./dashboard/server.js";
import { getTasksForRoot } from "./core/tasks/indexer";

const program = new Command();

program
  .name("TaskSync")
  .description("Sync your AI assistant session data across machines using Git.")
  .version(TaskSync_VERSION, "-v, --version", "Print TaskSync version");

// --- Provider helpers ---------------------------------------------------------

const ALL_PROVIDERS: IProvider[] = [
  new ClineProvider(),
  new RooProvider(),
  new KiloProvider(),
  new OpenClawProvider(),
];

function getProviderByName(name: string): IProvider {
  const p = ALL_PROVIDERS.find(p => p.getProviderName() === name.toLowerCase());
  if (!p) {
    console.error(`\n\u2717  Unknown provider: ${name}. Supported: cline, roo, kilo, openclaw\n`);
    process.exit(1);
  }
  return p;
}

/**
 * Detect all installed providers (data dir exists and is readable).
 * Returns a flat list of {provider, root} targets.
 */
function detectAllTargets(): UnifiedSyncTarget[] {
  const targets: UnifiedSyncTarget[] = [];
  for (const p of ALL_PROVIDERS) {
    for (const root of p.getRoots()) {
      if (p.validateRoot(root.path)) {
        targets.push({ provider: p, root });
      }
    }
  }
  return targets;
}

/**
 * Build targets for a specific provider name (or all if name is undefined).
 */
function buildTargets(providerName?: string): UnifiedSyncTarget[] {
  if (providerName) {
    const p = getProviderByName(providerName);
    const roots = p.getRoots();
    if (roots.length === 0) {
      console.error(`\n\u2717  No roots found for provider ${p.getProviderName()}.\n`);
      process.exit(1);
    }
    // Use first detected root, or error
    const root = roots.find(r => p.validateRoot(r.path));
    if (!root) {
      console.error(`\n\u2717  Provider "${p.getProviderName()}" not detected on this machine.\n`);
      process.exit(1);
    }
    return [{ provider: p, root }];
  }
  const targets = detectAllTargets();
  if (targets.length === 0) {
    console.error(`\n\u2717  No AI assistant providers detected on this machine.\n   Supported: cline, roo, kilo, openclaw\n`);
    process.exit(1);
  }
  return targets;
}

// --- tasksync init ------------------------------------------------------------

program
  .command("init <repoUrl>")
  .description("Initialize sync for all detected providers using a single private repo.")
  .option("--pat <token>", "GitHub Personal Access Token")
  .option("--provider <name>", "Limit init to a specific provider (default: all detected)")
  .action(async (repoUrl: string, options: { pat?: string; provider?: string }) => {
    if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
      console.error(`\n\u2717  Invalid repository URL: ${repoUrl}\n`);
      process.exit(1);
    }

    const targets = buildTargets(options.provider);

    console.log(`\n  Initializing sync for: ${targets.map(t => t.provider.getProviderName()).join(", ")}`);
    console.log(`  Repository: ${repoUrl}\n`);

    try {
      await runUnifiedInit(targets, { repoUrl, pat: options.pat });
    } catch (e: any) {
      handleError(e);
    }
  });

// --- tasksync sync ------------------------------------------------------------

program
  .command("sync")
  .description("Pull remote changes and push local changes for all (or a specific) provider.")
  .option("--provider <name>", "Sync a specific provider only (default: all detected)")
  .action(async (options: { provider?: string }) => {
    const targets = buildTargets(options.provider);
    try {
      await runUnifiedSync(targets);
    } catch (e: any) {
      handleError(e);
    }
  });

// --- tasksync status ----------------------------------------------------------

program
  .command("status")
  .description("Show sync status across all providers.")
  .action(async () => {
    const syncRepoPath = getSyncRepoPath();
    const machineId = getMachineId();
    const manifest = readUnifiedManifest(syncRepoPath);
    const repoInitialized = await isGitRepo(syncRepoPath);
    const remoteUrl = repoInitialized ? await getRemoteUrl(syncRepoPath) : null;
    const remoteConfigured = repoInitialized ? await hasRemote(syncRepoPath) : false;
    const dirty = repoInitialized ? await hasUncommittedChanges(syncRepoPath) : false;

    const pad = (label: string) => label.padEnd(26);
    console.log();
    console.log(`  ${pad("Sync repo:")}${syncRepoPath}`);
    console.log(`  ${pad("Machine ID:")}${machineId}`);
    console.log(`  ${pad("Remote configured:")}${remoteConfigured ? `yes \u2014 ${remoteUrl ?? "unknown"}` : "no"}`);
    console.log(`  ${pad("Workspace ID:")}${manifest?.workspaceId ?? "(not initialised)"}`);
    console.log(`  ${pad("Uncommitted changes:")}${dirty ? "yes" : "no"}`);

    if (manifest?.providers && Object.keys(manifest.providers).length > 0) {
      console.log();
      console.log(`  Providers:`);
      for (const [name, entry] of Object.entries(manifest.providers)) {
        const lastSync = entry.lastSyncedAt ?? "never";
        console.log(`    ${name.padEnd(12)} last synced: ${lastSync}`);
        console.log(`    ${" ".repeat(12)} data path:   ${entry.dataPath}`);
      }
    }

    if (!repoInitialized) {
      console.log();
      console.log(`  \u26a0  Not initialized. Run: TaskSync init <repo-url>`);
    }

    console.log();
  });

// --- tasksync dashboard -------------------------------------------------------

program
  .command("dashboard")
  .description("Launch the local web dashboard for cross-provider task management.")
  .option("--port <number>", "Port to run the dashboard on", "3210")
  .option("--no-open", "Do not automatically open the browser")
  .action(async (options: { port: string; open: boolean }) => {
    try {
      await startDashboard(parseInt(options.port, 10), options.open);
    } catch (e: any) {
      handleError(e);
    }
  });

// --- tasksync auth ------------------------------------------------------------

const auth = program
  .command("auth")
  .description("Manage GitHub authentication for syncing.")
  .action(async () => {
    try {
      await doAuthLogin();
    } catch (e: any) {
      handleError(e);
    }
  });

async function doAuthLogin(): Promise<void> {
  const existing = getAuthStatus();

  if (existing.authenticated) {
    console.log();
    console.log(`  Already authenticated:`);
    console.log(`    Method:   ${existing.method}`);
    if (existing.username) console.log(`    User:     @${existing.username}`);
    if (existing.maskedToken) console.log(`    Token:    ${existing.maskedToken}`);
    console.log();

    const answer = await prompt("  Replace existing token? (y/N): ");
    if (answer.toLowerCase() !== "y") {
      console.log("  Cancelled.\n");
      return;
    }
    console.log();
  }

  console.log("  \uD83D\uDD11 GitHub Authentication");
  console.log();
  console.log("  TaskSync needs a GitHub Personal Access Token to push/pull your data.");
  console.log();
  console.log("  To create one:");
  console.log("    1. Visit: \x1b[36mhttps://github.com/settings/tokens\x1b[0m");
  console.log('    2. Click "Generate new token (classic)"');
  console.log('    3. Select scope: \x1b[1mrepo\x1b[0m (full control of private repos)');
  console.log();

  const pat = await prompt("  Paste your token: ", { mask: true });

  if (!pat || pat.trim().length === 0) {
    console.log("\n  \u2717 No token provided. Cancelled.\n");
    return;
  }

  console.log("  Verifying with GitHub API...");

  try {
    const user = await verifyToken(pat.trim());
    saveToken(pat.trim(), user.login);
    console.log(`  \u2713 Authenticated as \x1b[1m@${user.login}\x1b[0m`);
    if (user.name) console.log(`    Name: ${user.name}`);
    console.log("  Token saved to ~/.TaskSync/auth.json");
    console.log();
  } catch (e: any) {
    console.error(`\n  \u2717 ${e.message}\n`);
    process.exit(1);
  }
}

auth
  .command("status")
  .description("Show current authentication status.")
  .action(() => {
    const status = getAuthStatus();
    const pad = (label: string) => label.padEnd(18);
    console.log();
    if (status.authenticated) {
      console.log(`  ${pad("Authenticated:")}yes`);
      console.log(`  ${pad("Method:")}${status.method}`);
      if (status.username) console.log(`  ${pad("GitHub user:")}@${status.username}`);
      if (status.maskedToken) console.log(`  ${pad("Token:")}${status.maskedToken}`);
      if (status.verifiedAt) console.log(`  ${pad("Verified at:")}${status.verifiedAt}`);
    } else {
      console.log("  Not authenticated.");
      console.log();
      console.log("  Run \x1b[1mTaskSync auth\x1b[0m to set up GitHub authentication.");
    }
    console.log();
  });

auth
  .command("logout")
  .description("Remove stored GitHub token.")
  .action(() => {
    const deleted = deleteToken();
    if (deleted) {
      console.log("\n  \u2713 Token removed from ~/.TaskSync/auth.json\n");
    } else {
      console.log("\n  No stored token found.\n");
    }
  });

auth
  .command("verify")
  .description("Re-verify the stored token is still valid.")
  .action(async () => {
    const config = loadToken();
    if (!config) {
      console.log("\n  No stored token found. Run \x1b[1mTaskSync auth\x1b[0m to set one up.\n");
      return;
    }
    console.log("  Verifying token with GitHub API...");
    try {
      const user = await verifyToken(config.github.pat);
      console.log(`  \u2713 Token is valid \u2014 @${user.login}\n`);
    } catch (e: any) {
      console.error(`\n  \u2717 Token is invalid: ${e.message}`);
      console.error("  Run \x1b[1mTaskSync auth\x1b[0m to update your token.\n");
      process.exit(1);
    }
  });

// --- tasksync setup (guided onboarding) --------------------------------------

program
  .command("setup")
  .description("Guided first-time setup \u2014 detect providers, authenticate, and connect a sync repo.")
  .action(async () => {
    try {
      await doSetup();
    } catch (e: any) {
      handleError(e);
    }
  });

async function doSetup(): Promise<void> {
  console.log();
  console.log("  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
  console.log("  \u2502                                      \u2502");
  console.log(`  \u2502   \uD83D\uDD01  Welcome to TaskSync v${TaskSync_VERSION}      \u2502`);
  console.log("  \u2502                                      \u2502");
  console.log("  \u2502   Sync your AI session history        \u2502");
  console.log("  \u2502   across machines using Git.          \u2502");
  console.log("  \u2502                                      \u2502");
  console.log("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
  console.log();

  // Step 1: Detect providers
  console.log("  \x1b[1mStep 1 of 3 \u2014 Detect Providers\x1b[0m");
  console.log("  " + "-".repeat(38));

  const targets = detectAllTargets();

  if (targets.length === 0) {
    console.log("  \u2717 No AI assistant providers detected on this machine.");
    console.log("    Supported: Cline, Roo, Kilo Code, OpenClaw");
    console.log("    Install one and run it at least once, then try again.\n");
    return;
  }

  for (const { provider, root } of targets) {
    let taskCount = 0;
    try { taskCount = getTasksForRoot(provider, root).length; } catch { /* ignore */ }
    console.log(`  \u2713 Found: \x1b[1m${provider.getProviderName()}\x1b[0m (${root.label}) \u2014 ${taskCount} tasks`);
    console.log(`    Path: ${root.path}`);
  }
  console.log();

  // Step 2: Authentication
  console.log("  \x1b[1mStep 2 of 3 \u2014 GitHub Authentication\x1b[0m");
  console.log("  " + "-".repeat(38));

  const authStatus = getAuthStatus();
  if (authStatus.authenticated) {
    console.log(`  \u2713 Already authenticated (${authStatus.method})`);
    if (authStatus.username) console.log(`    GitHub user: @${authStatus.username}`);
    console.log();
  } else {
    console.log("  TaskSync syncs your session data to a private GitHub repo.");
    console.log();
    const authChoice = await promptSelect("How would you like to authenticate?", [
      "Paste a Personal Access Token (recommended)",
      "Skip \u2014 I'll configure this later",
    ]);
    if (authChoice === 0) {
      console.log();
      console.log("  To create a token:");
      console.log("    1. Visit: \x1b[36mhttps://github.com/settings/tokens\x1b[0m");
      console.log('    2. Click "Generate new token (classic)"');
      console.log('    3. Select scope: \x1b[1mrepo\x1b[0m');
      console.log();
      const pat = await prompt("  Paste your token: ", { mask: true });
      if (pat && pat.trim().length > 0) {
        console.log("  Verifying with GitHub API...");
        try {
          const user = await verifyToken(pat.trim());
          saveToken(pat.trim(), user.login);
          console.log(`  \u2713 Authenticated as \x1b[1m@${user.login}\x1b[0m`);
          console.log("  Token saved to ~/.TaskSync/auth.json");
        } catch (e: any) {
          console.error(`  \u2717 ${e.message}`);
          console.log("  Continuing without authentication. Set it up later with: TaskSync auth");
        }
      } else {
        console.log("  Skipped. Set up later with: TaskSync auth");
      }
    } else {
      console.log();
      console.log("  Skipped. Set up later with: \x1b[1mTaskSync auth\x1b[0m");
    }
    console.log();
  }

  // Step 3: Repository setup
  console.log("  \x1b[1mStep 3 of 3 \u2014 Repository Setup\x1b[0m");
  console.log("  " + "-".repeat(38));

  const syncRepoPath = getSyncRepoPath();
  const existingManifest = readUnifiedManifest(syncRepoPath);
  const existingRemote = (await isGitRepo(syncRepoPath)) ? await getRemoteUrl(syncRepoPath) : null;

  if (existingManifest && existingRemote) {
    console.log(`  \u2713 Already initialized!`);
    console.log(`    Remote:       ${existingRemote}`);
    console.log(`    Workspace ID: ${existingManifest.workspaceId}`);
    const providerNames = Object.keys(existingManifest.providers);
    console.log(`    Providers:    ${providerNames.join(", ")}`);
    console.log();
  } else {
    let defaultUrl = existingRemote ?? "";
    if (defaultUrl) console.log(`  Existing git remote detected: ${defaultUrl}`);
    console.log("  Enter the GitHub repository URL for your session data.");
    console.log("  (Create a \x1b[1mprivate\x1b[0m repo at https://github.com/new)");
    console.log();
    const urlPrompt = defaultUrl ? `  Repository URL [${defaultUrl}]: ` : "  Repository URL: ";
    const repoUrl = (await prompt(urlPrompt)) || defaultUrl;
    if (!repoUrl) {
      console.log("\n  \u2717 No repository URL provided. Setup incomplete.\n");
      console.log("  Finish later with: \x1b[1mTaskSync init <repo-url>\x1b[0m\n");
      return;
    }
    if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
      console.error(`\n  \u2717 Invalid repository URL: ${repoUrl}\n`);
      return;
    }
    console.log();
    await runUnifiedInit(targets, { repoUrl });
  }

  // Done
  const finalManifest = readUnifiedManifest(syncRepoPath);
  const finalRemote = existingRemote ?? finalManifest?.repoUrl ?? "";
  const repoDisplay = finalRemote.replace("https://github.com/", "").replace(".git", "");

  console.log("  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
  console.log("  \u2502                                      \u2502");
  console.log("  \u2502   \u2713 TaskSync is ready!               \u2502");
  console.log("  \u2502                                      \u2502");
  console.log(`  \u2502   Syncing to:   ${repoDisplay.substring(0, 19).padEnd(19)}\u2502`);
  if (finalManifest?.workspaceId) {
    const wsShort = finalManifest.workspaceId.substring(0, 19);
    console.log(`  \u2502   Workspace:    ${wsShort.padEnd(19)}\u2502`);
  }
  console.log("  \u2502                                      \u2502");
  console.log("  \u2502   Next steps:                        \u2502");
  console.log("  \u2502   \u2022 TaskSync sync     Sync now       \u2502");
  console.log("  \u2502   \u2022 TaskSync status   Check status   \u2502");
  console.log("  \u2502   \u2022 TaskSync --help   All commands   \u2502");
  console.log("  \u2502                                      \u2502");
  console.log("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
  console.log();
}

// --- Error handler ------------------------------------------------------------

function handleError(e: any): never {
  if (e instanceof GitError || e?.name === "GitError") {
    console.error(`\n\u2717  ${e.message}\n`);
  } else {
    console.error(`\n\u2717  Unexpected error: ${e?.message ?? String(e)}\n`);
  }
  process.exit(1);
}

// --- Run ---------------------------------------------------------------------

program.parse(process.argv);

if (process.argv.length <= 2) {
  program.help();
}
