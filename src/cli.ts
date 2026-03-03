#!/usr/bin/env node
import { Command } from "commander";
import { ClineProvider } from "./providers/cline";
import { RooProvider } from "./providers/roo";
import { KiloProvider } from "./providers/kilo";
import { OpenClawProvider } from "./providers/openclaw";
import { IProvider, ProviderRoot } from "./providers/interface";
import { runInit, runSync } from "./core/sync";
import { GitError, getRemoteUrl, hasUncommittedChanges, isGitRepo, hasRemote } from "./utils/git";
import { getMachineId } from "./utils/identity";
import { readManifest, TaskSync_VERSION } from "./utils/manifest";
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
  .description("Sync your AI agent task data across machines using Git.")
  .version(TaskSync_VERSION, "-v, --version", "Print TaskSync version");

function getProvider(name: string): IProvider {
  switch (name.toLowerCase()) {
    case "cline": return new ClineProvider();
    case "roo": return new RooProvider();
    case "kilo": return new KiloProvider();
    case "openclaw": return new OpenClawProvider();
    default:
      console.error(`\n?  Unknown provider: ${name}. Supported: cline, roo, kilo, openclaw\n`);
      process.exit(1);
  }
}

function resolveRoot(provider: IProvider, requestedRootId?: string): ProviderRoot {
  const roots = provider.getRoots();
  if (roots.length === 0) {
    console.error(`\n?  No roots found for provider ${provider.getProviderName()}.\n`);
    process.exit(1);
  }

  if (requestedRootId) {
    const root = roots.find(r => r.id === requestedRootId);
    if (!root) {
      console.error(`\n?  Root ID '${requestedRootId}' not found. Available: ${roots.map(r => r.id).join(", ")}\n`);
      process.exit(1);
    }
    return root;
  }

  if (roots.length > 1) {
    console.error(`\n?  Multiple roots found for ${provider.getProviderName()}. Please specify --root <id>.\n   Available: ${roots.map(r => r.id).join(", ")}\n`);
    process.exit(1);
  }

  return roots[0];
}

// --- TaskSync init ------------------------------------------------------------

program
  .command("init <repoUrl>")
  .description("Initialise TaskSync sync for this machine and push to a remote repository.")
  .option("--pat <token>", "GitHub Personal Access Token (for private repositories)")
  .option("--provider <name>", "Provider to sync (cline, roo, kilo)", "cline")
  .option("--root <id>", "Specific root ID if multiple exist")
  .action(async (repoUrl: string, options: { pat?: string, provider: string, root?: string }) => {
    const provider = getProvider(options.provider);
    const root = resolveRoot(provider, options.root);

    if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
      console.error(`\n?  Invalid repository URL: ${repoUrl}\n`);
      process.exit(1);
    }

    try {
      await runInit(provider, root.id, root.path, root.label, { repoUrl, pat: options.pat });
    } catch (e: any) {
      handleError(e);
    }
  });

// --- TaskSync sync ------------------------------------------------------------

program
  .command("sync")
  .description("Pull remote changes and push local changes.")
  .option("--provider <name>", "Provider to sync (cline, roo, kilo)", "cline")
  .option("--root <id>", "Specific root ID if multiple exist")
  .action(async (options: { provider: string, root?: string }) => {
    const provider = getProvider(options.provider);
    const root = resolveRoot(provider, options.root);

    try {
      await runSync(provider, root.path);
    } catch (e: any) {
      handleError(e);
    }
  });

// --- TaskSync status ----------------------------------------------------------

program
  .command("status")
  .description("Show sync status, provider info, and identity details.")
  .option("--provider <name>", "Provider to check (cline, roo, kilo)", "cline")
  .option("--root <id>", "Specific root ID if multiple exist")
  .action(async (options: { provider: string, root?: string }) => {
    const provider = getProvider(options.provider);
    const root = resolveRoot(provider, options.root);
    const dataPath = root.path;

    const manifest = readManifest(dataPath);
    const machineId = getMachineId();
    const remoteUrl = await getRemoteUrl(dataPath);
    const repoInitialised = await isGitRepo(dataPath);
    const dirty = repoInitialised ? await hasUncommittedChanges(dataPath) : false;
    const remoteConfigured = repoInitialised ? await hasRemote(dataPath) : false;

    const pad = (label: string) => label.padEnd(26);

    console.log();
    console.log(`  ${pad("Provider:")}${provider.getProviderName()}`);
    console.log(`  ${pad("Data path:")}${dataPath}`);
    console.log(`  ${pad("Workspace ID:")}${manifest?.workspaceId ?? "(not initialised)"}`);
    console.log(`  ${pad("Machine ID:")}${machineId}`);
    console.log(`  ${pad("Remote configured:")}${remoteConfigured ? `yes — ${remoteUrl ?? "unknown"}` : "no"}`);
    console.log(`  ${pad("Last synced:")}${manifest?.lastSyncedAt ?? "never"}`);
    console.log(`  ${pad("Uncommitted changes:")}${dirty ? "yes" : "no"}`);

    if (!repoInitialised) {
      console.log();
      console.log(`  ?  Repository not initialised. Run: TaskSync init <repo-url> [--pat <token>]`);
    }

    console.log();
  });

// --- TaskSync dashboard -------------------------------------------------------

program
  .command("dashboard")
  .description("Launch the local web dashboard for cross-provider migration.")
  .option("--port <number>", "Port to run the dashboard on", "3210")
  .option("--no-open", "Do not automatically open the browser")
  .action(async (options: { port: string, open: boolean }) => {
    try {
      await startDashboard(parseInt(options.port, 10), options.open);
    } catch (e: any) {
      handleError(e);
    }
  });

// --- TaskSync auth ------------------------------------------------------------

const auth = program
  .command("auth")
  .description("Manage GitHub authentication for syncing.")
  .action(async () => {
    // Default action: interactive token setup
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

  console.log("  ?? GitHub Authentication");
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
    console.log("\n  ? No token provided. Cancelled.\n");
    return;
  }

  console.log("  ? Verifying with GitHub API...");

  try {
    const user = await verifyToken(pat.trim());
    saveToken(pat.trim(), user.login);

    console.log(`  ? Authenticated as \x1b[1m@${user.login}\x1b[0m`);
    if (user.name) console.log(`    Name: ${user.name}`);
    console.log("  ? Token saved to ~/.TaskSync/auth.json");
    console.log();
  } catch (e: any) {
    console.error(`\n  ? ${e.message}\n`);
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
      console.log("\n  ? Token removed from ~/.TaskSync/auth.json\n");
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

    console.log("  ? Verifying token with GitHub API...");
    try {
      const user = await verifyToken(config.github.pat);
      console.log(`  ? Token is valid — @${user.login}\n`);
    } catch (e: any) {
      console.error(`\n  ? Token is invalid: ${e.message}`);
      console.error("  Run \x1b[1mTaskSync auth\x1b[0m to update your token.\n");
      process.exit(1);
    }
  });

// --- TaskSync setup (guided onboarding) --------------------------------------

program
  .command("setup")
  .description("Guided first-time setup — detect provider, authenticate, and connect a sync repo.")
  .action(async () => {
    try {
      await doSetup();
    } catch (e: any) {
      handleError(e);
    }
  });

async function doSetup(): Promise<void> {
  console.log();
  console.log("  ?--------------------------------------?");
  console.log("  ¦                                      ¦");
  console.log(`  ¦   ???  Welcome to TaskSync v${TaskSync_VERSION}      ¦`);
  console.log("  ¦                                      ¦");
  console.log("  ¦   Sync your AI agent task history    ¦");
  console.log("  ¦   across machines using Git.         ¦");
  console.log("  ¦                                      ¦");
  console.log("  ?--------------------------------------?");
  console.log();

  // -- Step 1: Detect providers ----------------------------------------------

  console.log("  \x1b[1mStep 1 of 3 — Detect Provider\x1b[0m");
  console.log("  " + "-".repeat(38));

  const allProviders: IProvider[] = [
    new ClineProvider(),
    new RooProvider(),
    new KiloProvider(),
    new OpenClawProvider(),
  ];

  const detected: Array<{ provider: IProvider; root: ProviderRoot; taskCount: number }> = [];

  for (const p of allProviders) {
    const roots = p.getRoots();
    for (const root of roots) {
      if (p.validateRoot(root.path)) {
        let taskCount = 0;
        try {
          taskCount = getTasksForRoot(p, root).length;
        } catch { /* ignore */ }
        detected.push({ provider: p, root, taskCount });
      }
    }
  }

  if (detected.length === 0) {
    console.log("  ? No AI agent providers detected on this machine.");
    console.log("    Supported: Cline, Roo, Kilo Code, OpenClaw");
    console.log("    Install one and run it at least once, then try again.\n");
    return;
  }

  const primary = detected[0];
  console.log(`  ? Found: \x1b[1m${primary.provider.getProviderName()}\x1b[0m (${primary.root.label})`);
  console.log(`    Path:  ${primary.root.path}`);
  console.log(`    Tasks: ${primary.taskCount} tasks detected`);

  if (detected.length > 1) {
    console.log();
    console.log("  Also found:");
    for (let i = 1; i < detected.length; i++) {
      const d = detected[i];
      console.log(`    • ${d.provider.getProviderName()} (${d.root.label}) — ${d.taskCount} tasks`);
    }
  }

  console.log();

  // -- Step 2: Authentication ------------------------------------------------

  console.log("  \x1b[1mStep 2 of 3 — GitHub Authentication\x1b[0m");
  console.log("  " + "-".repeat(38));

  const authStatus = getAuthStatus();

  if (authStatus.authenticated) {
    console.log(`  ? Already authenticated (${authStatus.method})`);
    if (authStatus.username) console.log(`    GitHub user: @${authStatus.username}`);
    console.log();
  } else {
    console.log("  TaskSync syncs your task data to a private GitHub repo.");
    console.log();

    const authChoice = await promptSelect("How would you like to authenticate?", [
      "Paste a Personal Access Token (recommended)",
      "Skip — I'll configure this later",
    ]);

    if (authChoice === 0) {
      console.log();
      console.log("  To create a token:");
      console.log("    1. Visit: \x1b[36mhttps://github.com/settings/tokens\x1b[0m");
      console.log('    2. Click "Generate new token (classic)"');
      console.log('    3. Select scope: \x1b[1mrepo\x1b[0m (full control of private repos)');
      console.log();

      const pat = await prompt("  Paste your token: ", { mask: true });

      if (pat && pat.trim().length > 0) {
        console.log("  ? Verifying with GitHub API...");
        try {
          const user = await verifyToken(pat.trim());
          saveToken(pat.trim(), user.login);
          console.log(`  ? Authenticated as \x1b[1m@${user.login}\x1b[0m`);
          console.log("  ? Token saved to ~/.TaskSync/auth.json");
        } catch (e: any) {
          console.error(`  ? ${e.message}`);
          console.log("  Continuing without authentication. You can set it up later with: TaskSync auth");
        }
      } else {
        console.log("  Skipped. You can set it up later with: TaskSync auth");
      }
    } else {
      console.log();
      console.log("  Skipped. Set up later with: \x1b[1mTaskSync auth\x1b[0m");
    }
    console.log();
  }

  // -- Step 3: Repository setup ----------------------------------------------

  console.log("  \x1b[1mStep 3 of 3 — Repository Setup\x1b[0m");
  console.log("  " + "-".repeat(38));

  // Check if already initialized
  const existingManifest = readManifest(primary.root.path);
  const existingRepo = await isGitRepo(primary.root.path);
  const existingRemote = existingRepo ? await getRemoteUrl(primary.root.path) : null;

  if (existingManifest && existingRemote) {
    console.log(`  ? Already initialized!`);
    console.log(`    Remote: ${existingRemote}`);
    console.log(`    Workspace ID: ${existingManifest.workspaceId}`);
    console.log(`    Last synced: ${existingManifest.lastSyncedAt ?? "never"}`);
    console.log();
  } else {
    let defaultUrl = "";
    if (existingRemote) {
      defaultUrl = existingRemote;
      console.log(`  Existing git remote detected: ${existingRemote}`);
    }

    console.log("  Enter the GitHub repository URL where your task data will be synced.");
    console.log("  (Create a \x1b[1mprivate\x1b[0m repo at https://github.com/new)");
    console.log();

    const urlPrompt = defaultUrl
      ? `  Repository URL [${defaultUrl}]: `
      : "  Repository URL: ";
    const repoUrl = (await prompt(urlPrompt)) || defaultUrl;

    if (!repoUrl) {
      console.log("\n  ? No repository URL provided. Setup incomplete.\n");
      console.log("  You can finish later with: \x1b[1mTaskSync init <repo-url>\x1b[0m\n");
      return;
    }

    if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
      console.error(`\n  ? Invalid repository URL: ${repoUrl}\n`);
      return;
    }

    console.log();
    await runInit(
      primary.provider,
      primary.root.id,
      primary.root.path,
      primary.root.label,
      { repoUrl }
    );
  }

  // -- Done ------------------------------------------------------------------

  const finalManifest = readManifest(primary.root.path);
  const finalRemote = await getRemoteUrl(primary.root.path);

  console.log("  ?--------------------------------------?");
  console.log("  ¦                                      ¦");
  console.log("  ¦   ? TaskSync is ready!               ¦");
  console.log("  ¦                                      ¦");
  console.log(`  ¦   Provider:     ${primary.provider.getProviderName().padEnd(19)}¦`);
  console.log(`  ¦   Tasks:        ${String(primary.taskCount).padEnd(19)}¦`);
  const repoDisplay = finalRemote
    ? finalRemote.replace("https://github.com/", "").replace(".git", "")
    : "(not set)";
  console.log(`  ¦   Syncing to:   ${repoDisplay.substring(0, 19).padEnd(19)}¦`);
  if (finalManifest?.workspaceId) {
    const wsShort = finalManifest.workspaceId.substring(0, 19);
    console.log(`  ¦   Workspace:    ${wsShort.padEnd(19)}¦`);
  }
  console.log("  ¦                                      ¦");
  console.log("  ¦   Next steps:                        ¦");
  console.log("  ¦   • TaskSync sync     Sync now       ¦");
  console.log("  ¦   • TaskSync status   Check status   ¦");
  console.log("  ¦   • TaskSync --help   All commands   ¦");
  console.log("  ¦                                      ¦");
  console.log("  ?--------------------------------------?");
  console.log();
}

// --- Error handler ------------------------------------------------------------

function handleError(e: any): never {
  if (e instanceof GitError || e?.name === "GitError") {
    console.error(`\n?  ${e.message}\n`);
  } else {
    console.error(`\n?  Unexpected error: ${e?.message ?? String(e)}\n`);
  }
  process.exit(1);
}

// --- Run ---------------------------------------------------------------------

program.parse(process.argv);

if (process.argv.length <= 2) {
  program.help();
}
