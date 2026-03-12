#!/usr/bin/env node
import { Command } from "commander";
import {
  runUnifiedInit,
  runUnifiedSync,
  UnifiedSyncTarget,
} from "./core/sync";
import { GitError, getRemoteUrl, hasRemote, hasUncommittedChanges, isGitRepo } from "./utils/git";
import { getMachineId, getSyncRepoPath } from "./utils/identity";
import { readUnifiedManifest, TaskSync_VERSION } from "./utils/manifest";
import {
  verifyToken,
  saveToken,
  loadToken,
  deleteToken,
  getAuthStatus,
  prompt,
  promptSelect,
} from "./utils/auth";
import { startDashboard } from "./dashboard/server";
import { getTasksForRoot } from "./core/tasks/indexer";
import { startTaskSyncMcpServer } from "./mcp/server";
import {
  ALL_CLIENTS,
  SupportedClient,
  buildPrintConfig,
  checkClientStatus,
  detectClientInstalled,
  getClientLabel,
  getConfigPath,
  getConfigPaths,
  getRestartHint,
  installForClient,
} from "./mcp/install";
import { getCapturedTasksDir, listCapturedTasks } from "./core/tasks/captured";
import { IProvider } from "./providers/interface";
import { createProviderRegistry } from "./providers/registry";

interface CliDependencies {
  startMcpServer?: () => Promise<void>;
}

export function createProgram(deps: CliDependencies = {}): Command {
  const program = new Command();
  const allProviders = createProviderRegistry();
  const startMcp = deps.startMcpServer ?? startTaskSyncMcpServer;

  program
    .name("TaskSync")
    .description("Sync your AI assistant session data across machines using Git.")
    .version(TaskSync_VERSION, "-v, --version", "Print TaskSync version");

  function getRequiredProviderByName(name: string): IProvider {
    const provider = allProviders.find((candidate) => candidate.getProviderName() === name.toLowerCase());
    if (!provider) {
      console.error(`\n✗  Unknown provider: ${name}. Supported: cline, roo, kilo, openclaw\n`);
      process.exit(1);
    }
    return provider;
  }

  function detectAllTargets(): UnifiedSyncTarget[] {
    const targets: UnifiedSyncTarget[] = [];

    for (const provider of allProviders) {
      for (const root of provider.getRoots()) {
        if (provider.validateRoot(root.path)) {
          targets.push({ provider, root });
        }
      }
    }

    return targets;
  }

  function buildTargets(providerName?: string): UnifiedSyncTarget[] {
    if (providerName) {
      const provider = getRequiredProviderByName(providerName);
      const roots = provider.getRoots();
      if (roots.length === 0) {
        console.error(`\n✗  No roots found for provider ${provider.getProviderName()}.\n`);
        process.exit(1);
      }

      const root = roots.find((candidate) => provider.validateRoot(candidate.path));
      if (!root) {
        console.error(`\n✗  Provider "${provider.getProviderName()}" not detected on this machine.\n`);
        process.exit(1);
      }

      return [{ provider, root }];
    }

    const targets = detectAllTargets();
    if (targets.length === 0) {
      console.error(`\n✗  No AI assistant providers detected on this machine.\n   Supported: cline, roo, kilo, openclaw\n`);
      process.exit(1);
    }

    return targets;
  }

  program
    .command("init <repoUrl>")
    .description("Initialize sync for all detected providers using a single private repo.")
    .option("--pat <token>", "GitHub Personal Access Token")
    .option("--provider <name>", "Limit init to a specific provider (default: all detected)")
    .action(async (repoUrl: string, options: { pat?: string; provider?: string }) => {
      if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
        console.error(`\n✗  Invalid repository URL: ${repoUrl}\n`);
        process.exit(1);
      }

      const targets = buildTargets(options.provider);

      console.log(`\n  Initializing sync for: ${targets.map((target) => target.provider.getProviderName()).join(", ")}`);
      console.log(`  Repository: ${repoUrl}\n`);

      try {
        await runUnifiedInit(targets, { repoUrl, pat: options.pat });
      } catch (error: any) {
        handleError(error);
      }
    });

  program
    .command("sync")
    .description("Pull remote changes and push local changes for all (or a specific) provider.")
    .option("--provider <name>", "Sync a specific provider only (default: all detected)")
    .action(async (options: { provider?: string }) => {
      const targets = buildTargets(options.provider);
      try {
        await runUnifiedSync(targets);
      } catch (error: any) {
        handleError(error);
      }
    });

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
      console.log(`  ${pad("Remote configured:")}${remoteConfigured ? `yes — ${remoteUrl ?? "unknown"}` : "no"}`);
      console.log(`  ${pad("Workspace ID:")}${manifest?.workspaceId ?? "(not initialised)"}`);
      console.log(`  ${pad("Uncommitted changes:")}${dirty ? "yes" : "no"}`);

      if (manifest?.providers && Object.keys(manifest.providers).length > 0) {
        console.log();
        console.log("  Providers:");
        for (const [name, entry] of Object.entries(manifest.providers)) {
          const lastSync = entry.lastSyncedAt ?? "never";
          console.log(`    ${name.padEnd(12)} last synced: ${lastSync}`);
          console.log(`    ${" ".repeat(12)} data path:   ${entry.dataPath}`);
        }
      }

      if (!repoInitialized) {
        console.log();
        console.log("  ⚠  Not initialized. Run: TaskSync init <repo-url>");
      }

      console.log();
    });

  program
    .command("dashboard")
    .description("Launch the local web dashboard for cross-provider task management.")
    .option("--port <number>", "Port to run the dashboard on", "3210")
    .option("--no-open", "Do not automatically open the browser")
    .action(async (options: { port: string; open: boolean }) => {
      try {
        await startDashboard(parseInt(options.port, 10), options.open);
      } catch (error: any) {
        handleError(error);
      }
    });

  const VALID_CLIENTS = ALL_CLIENTS.join("|");

  const mcp = program
    .command("mcp")
    .description("Run the local TaskSync MCP server over stdio for read-only task context retrieval.")
    .action(async () => {
      try {
        await startMcp();
      } catch (error: any) {
        handleError(error);
      }
    });

  mcp
    .command("install")
    .description(`Register the TaskSync MCP server in a supported AI tool's config (${VALID_CLIENTS}).`)
    .option(`--client <name>`, `Target client (${VALID_CLIENTS}). Omit to install for all detected clients.`)
    .action((options: { client?: string }) => {
      const clientsToInstall: SupportedClient[] = options.client
        ? [options.client as SupportedClient]
        : ALL_CLIENTS.filter(detectClientInstalled);

      if (options.client && !ALL_CLIENTS.includes(options.client as SupportedClient)) {
        console.error(`\n✗  Unknown client: ${options.client}. Supported: ${VALID_CLIENTS}\n`);
        process.exit(1);
      }

      if (clientsToInstall.length === 0) {
        console.log();
        console.log("  No supported MCP clients detected on this machine.");
        console.log(`  Supported: ${VALID_CLIENTS}`);
        console.log();
        console.log("  To install for a specific client regardless:");
        console.log(`    tasksync mcp install --client cursor`);
        console.log();
        return;
      }

      console.log();

      for (const client of clientsToInstall) {
        const label = getClientLabel(client);
        try {
          const result = installForClient(client);

          if (!result.clientDetected) {
            console.log(`  ⚠  ${label} does not appear to be installed — wrote config anyway.`);
            console.log(`     ${result.configPath}`);
          }

          if (result.configPaths.length > 1) {
            console.log(`  ℹ  ${label} has multiple VS Code storage locations on this machine.`);
            console.log(`     Updated all detected MCP config files:`);
            for (const p of result.configPaths) {
              console.log(`       - ${p}`);
            }
          }

          switch (result.status) {
            case "installed":
              console.log(`  ✓  ${label} — installed`);
              console.log(`     Config: ${result.configPath}`);
              console.log(`     Entry:  ${result.entry.command} ${result.entry.args.join(" ")}`);
              console.log(`     ↳ ${getRestartHint(client)}`);
              break;
            case "updated":
              console.log(`  ✓  ${label} — updated existing entry`);
              console.log(`     Config: ${result.configPath}`);
              console.log(`     Entry:  ${result.entry.command} ${result.entry.args.join(" ")}`);
              console.log(`     ↳ ${getRestartHint(client)}`);
              break;
            case "already-current":
              console.log(`  ✓  ${label} — already configured, no changes needed`);
              console.log(`     Config: ${result.configPath}`);
              break;
          }
        } catch (error: any) {
          console.error(`  ✗  ${label} — failed: ${error?.message ?? String(error)}`);
        }

        console.log();
      }
    });

  mcp
    .command("print-config")
    .description("Print the MCP server config snippet to paste into an AI tool's config file.")
    .option(`--client <name>`, `Target client (${VALID_CLIENTS}). Omit for a generic snippet.`)
    .action((options: { client?: string }) => {
      if (options.client && !ALL_CLIENTS.includes(options.client as SupportedClient)) {
        console.error(`\n✗  Unknown client: ${options.client}. Supported: ${VALID_CLIENTS}\n`);
        process.exit(1);
      }

      const target = (options.client ?? "generic") as SupportedClient | "generic";
      const result = buildPrintConfig(target);

      console.log();

      if (target === "generic") {
        console.log("  Add this to your MCP client config under the \"mcpServers\" key:");
        console.log();
        console.log("  " + result.snippet.split("\n").join("\n  "));
        console.log();
        console.log("  Client config file locations:");
        for (const client of ALL_CLIENTS) {
          const paths = getConfigPaths(client);
          console.log(`    ${getClientLabel(client).padEnd(20)} ${paths[0]}`);
          for (const extraPath of paths.slice(1)) {
            console.log(`    ${"".padEnd(20)} ${extraPath}`);
          }
        }
      } else {
        const client = target as SupportedClient;
        const detected = detectClientInstalled(client);
        console.log(`  ${getClientLabel(client)} MCP config:`);
        const configPaths = getConfigPaths(client);
        if (configPaths.length === 1) {
          console.log(`  Config file: ${result.configPath}`);
        } else {
          console.log(`  Config files (${configPaths.length}):`);
          for (const p of configPaths) console.log(`    - ${p}`);
        }
        if (!detected) console.log("  ⚠  Client does not appear to be installed on this machine.");
        console.log();
        console.log("  Paste this snippet into the config file (merge under \"mcpServers\"):");
        console.log();
        console.log("  " + result.snippet.split("\n").join("\n  "));
        console.log();
        console.log(`  Or run: tasksync mcp install --client ${client}`);
      }

      console.log();
    });

  mcp
    .command("doctor")
    .description("Validate the TaskSync MCP setup on this machine.")
    .action(() => {
      const { execFileSync } = require("child_process") as typeof import("child_process");
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");

      console.log();
      console.log("  ● TaskSync CLI");

      // Check if tasksync is on PATH
      let tasksyncPath: string | null = null;
      try {
        const findCmd = process.platform === "win32" ? "where" : "which";
        tasksyncPath = execFileSync(findCmd, ["tasksync"], { stdio: "pipe" }).toString().trim().split("\n")[0].trim();
        console.log(`  ✓  tasksync found on PATH`);
        console.log(`     ${tasksyncPath}`);
      } catch {
        console.log("  ✗  tasksync not found on PATH");
        console.log("     Install globally: npm install -g tasksync");
        console.log("     Or use: node /path/to/build/cli.js mcp");
      }

      // Check if build/cli.js exists (relevant for dev/local installs)
      const buildCli = path.resolve(__dirname, "cli.js");
      if (fs.existsSync(buildCli)) {
        console.log(`  ✓  build/cli.js exists`);
        console.log(`     ${buildCli}`);
      }

      // MCP client setup
      console.log();
      console.log("  ● MCP client setup");

      let anyDetected = false;
      for (const client of ALL_CLIENTS) {
        const status = checkClientStatus(client);
        const label = status.label.padEnd(16);
        const detectedMark = status.detected ? "✓ detected" : "✗ not detected";
        const configMark = status.configExists ? "config: exists" : "config: missing";
        const mcpMark = status.configured ? "tasksync: ✓ configured" : "tasksync: ✗ not configured";

        if (status.detected) anyDetected = true;

        console.log(`  ${status.detected ? "✓" : "✗"}  ${label}  ${detectedMark}  |  ${configMark}  |  ${mcpMark}`);

        if (!status.configured) {
          if (status.detected) {
            console.log(`       → Run: tasksync mcp install --client ${client}`);
          }
        }

        if (status.configPaths.length > 1) {
          const configuredCount = status.configuredPaths.length;
          console.log(`       Configured paths: ${configuredCount}/${status.configPaths.length}`);
        }
      }

      if (!anyDetected) {
        console.log("     No supported MCP clients detected on this machine.");
        console.log(`     Supported: ${VALID_CLIENTS}`);
      }

      // Captured context store
      console.log();
      console.log("  ● Captured context store");

      const capturedDir = getCapturedTasksDir();
      console.log(`     Path: ${capturedDir}`);

      try {
        const capturedTasks = listCapturedTasks();
        if (capturedTasks.length === 0) {
          console.log("     Status: exists — 0 tasks captured");
          console.log("     Use capture_context via MCP to store context from any AI tool.");
        } else {
          console.log(`     Status: exists — ${capturedTasks.length} task${capturedTasks.length === 1 ? "" : "s"} captured`);
          const latest = capturedTasks[0];
          console.log(`     Latest: "${latest.title.substring(0, 60)}" (${latest.capturedAt.substring(0, 10)})`);
        }
      } catch {
        console.log("     Status: not yet created (no tasks captured)");
        console.log("     Use capture_context via MCP to store context from any AI tool.");
      }

      console.log();
    });

  const auth = program
    .command("auth")
    .description("Manage GitHub authentication for syncing.")
    .action(async () => {
      try {
        await doAuthLogin();
      } catch (error: any) {
        handleError(error);
      }
    });

  async function doAuthLogin(): Promise<void> {
    const existing = getAuthStatus();

    if (existing.authenticated) {
      console.log();
      console.log("  Already authenticated:");
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

    console.log("  🔑 GitHub Authentication");
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
      console.log("\n  ✗ No token provided. Cancelled.\n");
      return;
    }

    console.log("  Verifying with GitHub API...");

    try {
      const user = await verifyToken(pat.trim());
      saveToken(pat.trim(), user.login);
      console.log(`  ✓ Authenticated as \x1b[1m@${user.login}\x1b[0m`);
      if (user.name) console.log(`    Name: ${user.name}`);
      console.log("  Token saved to ~/.TaskSync/auth.json");
      console.log();
    } catch (error: any) {
      console.error(`\n  ✗ ${error.message}\n`);
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
        console.log("\n  ✓ Token removed from ~/.TaskSync/auth.json\n");
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
        console.log(`  ✓ Token is valid — @${user.login}\n`);
      } catch (error: any) {
        console.error(`\n  ✗ Token is invalid: ${error.message}`);
        console.error("  Run \x1b[1mTaskSync auth\x1b[0m to update your token.\n");
        process.exit(1);
      }
    });

  program
    .command("setup")
    .description("Guided first-time setup — detect providers, authenticate, and connect a sync repo.")
    .action(async () => {
      try {
        await doSetup();
      } catch (error: any) {
        handleError(error);
      }
    });

  async function doSetup(): Promise<void> {
    console.log();
    console.log("  ┌──────────────────────────────────────┐");
    console.log("  │                                      │");
    console.log(`  │   🔁  Welcome to TaskSync v${TaskSync_VERSION}      │`);
    console.log("  │                                      │");
    console.log("  │   Sync your AI session history       │");
    console.log("  │   across machines using Git.         │");
    console.log("  │                                      │");
    console.log("  └──────────────────────────────────────┘");
    console.log();

    console.log("  \x1b[1mStep 1 of 3 — Detect Providers\x1b[0m");
    console.log("  " + "-".repeat(38));

    const targets = detectAllTargets();

    if (targets.length === 0) {
      console.log("  ✗ No AI assistant providers detected on this machine.");
      console.log("    Supported: Cline, Roo, Kilo Code, OpenClaw");
      console.log("    Install one and run it at least once, then try again.\n");
      return;
    }

    for (const { provider, root } of targets) {
      let taskCount = 0;
      try {
        taskCount = getTasksForRoot(provider, root).length;
      } catch {
        // ignore
      }
      console.log(`  ✓ Found: \x1b[1m${provider.getProviderName()}\x1b[0m (${root.label}) — ${taskCount} tasks`);
      console.log(`    Path: ${root.path}`);
    }
    console.log();

    console.log("  \x1b[1mStep 2 of 3 — GitHub Authentication\x1b[0m");
    console.log("  " + "-".repeat(38));

    const authStatus = getAuthStatus();
    if (authStatus.authenticated) {
      console.log(`  ✓ Already authenticated (${authStatus.method})`);
      if (authStatus.username) console.log(`    GitHub user: @${authStatus.username}`);
      console.log();
    } else {
      console.log("  TaskSync syncs your session data to a private GitHub repo.");
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
        console.log('    3. Select scope: \x1b[1mrepo\x1b[0m');
        console.log();
        const pat = await prompt("  Paste your token: ", { mask: true });
        if (pat && pat.trim().length > 0) {
          console.log("  Verifying with GitHub API...");
          try {
            const user = await verifyToken(pat.trim());
            saveToken(pat.trim(), user.login);
            console.log(`  ✓ Authenticated as \x1b[1m@${user.login}\x1b[0m`);
            console.log("  Token saved to ~/.TaskSync/auth.json");
          } catch (error: any) {
            console.error(`  ✗ ${error.message}`);
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

    console.log("  \x1b[1mStep 3 of 3 — Repository Setup\x1b[0m");
    console.log("  " + "-".repeat(38));

    const syncRepoPath = getSyncRepoPath();
    const existingManifest = readUnifiedManifest(syncRepoPath);
    const existingRemote = (await isGitRepo(syncRepoPath)) ? await getRemoteUrl(syncRepoPath) : null;

    if (existingManifest && existingRemote) {
      console.log("  ✓ Already initialized!");
      console.log(`    Remote:       ${existingRemote}`);
      console.log(`    Workspace ID: ${existingManifest.workspaceId}`);
      console.log(`    Providers:    ${Object.keys(existingManifest.providers).join(", ")}`);
      console.log();
    } else {
      const defaultUrl = existingRemote ?? "";
      if (defaultUrl) console.log(`  Existing git remote detected: ${defaultUrl}`);
      console.log("  Enter the GitHub repository URL for your session data.");
      console.log("  (Create a \x1b[1mprivate\x1b[0m repo at https://github.com/new)");
      console.log();
      const repoUrl = (await prompt(defaultUrl ? `  Repository URL [${defaultUrl}]: ` : "  Repository URL: ")) || defaultUrl;

      if (!repoUrl) {
        console.log("\n  ✗ No repository URL provided. Setup incomplete.\n");
        console.log("  Finish later with: \x1b[1mTaskSync init <repo-url>\x1b[0m\n");
        return;
      }

      if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
        console.error(`\n  ✗ Invalid repository URL: ${repoUrl}\n`);
        return;
      }

      console.log();
      await runUnifiedInit(targets, { repoUrl });
    }

    const finalManifest = readUnifiedManifest(syncRepoPath);
    const finalRemote = existingRemote ?? finalManifest?.repoUrl ?? "";
    const repoDisplay = finalRemote.replace("https://github.com/", "").replace(".git", "");

    console.log("  ┌──────────────────────────────────────┐");
    console.log("  │                                      │");
    console.log("  │   ✓ TaskSync is ready!               │");
    console.log("  │                                      │");
    console.log(`  │   Syncing to:   ${repoDisplay.substring(0, 19).padEnd(19)}│`);
    if (finalManifest?.workspaceId) {
      const wsShort = finalManifest.workspaceId.substring(0, 19);
      console.log(`  │   Workspace:    ${wsShort.padEnd(19)}│`);
    }
    console.log("  │                                      │");
    console.log("  │   Next steps:                        │");
    console.log("  │   • TaskSync sync     Sync now       │");
    console.log("  │   • TaskSync status   Check status   │");
    console.log("  │   • TaskSync --help   All commands   │");
    console.log("  │                                      │");
    console.log("  └──────────────────────────────────────┘");
    console.log();
  }

  function handleError(error: any): never {
    if (error instanceof GitError || error?.name === "GitError") {
      console.error(`\n✗  ${error.message}\n`);
    } else {
      console.error(`\n✗  Unexpected error: ${error?.message ?? String(error)}\n`);
    }
    process.exit(1);
  }

  return program;
}

export async function runCli(argv: string[] = process.argv, deps: CliDependencies = {}): Promise<Command> {
  const program = createProgram(deps);
  await program.parseAsync(argv);
  if (argv.length <= 2) {
    program.help();
  }
  return program;
}

if (require.main === module) {
  void runCli();
}