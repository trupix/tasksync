import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedClient = "cursor" | "claude-desktop" | "windsurf" | "cline" | "roo" | "kilo";
type VsCodeProviderClient = "cline" | "roo" | "kilo";

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export type InstallStatus =
  | "installed"      // newly written
  | "already-current" // entry existed and was identical
  | "updated"        // entry existed but was different — updated
  | "skipped";       // client not detected, user opted to skip

export interface InstallResult {
  status: InstallStatus;
  client: SupportedClient;
  /** Primary config path (first path in configPaths). */
  configPath: string;
  /** All config paths that were evaluated/updated for this install operation. */
  configPaths: string[];
  entry: McpServerEntry;
  clientDetected: boolean;
}

export interface PrintConfigResult {
  client: SupportedClient | "generic";
  configPath: string | null;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Config path resolution
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const APPDATA = process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming");

// VS Code globalStorage base per platform
const CODE_GS_WIN = path.join(APPDATA, "Code", "User", "globalStorage");
const CODE_GS_INSIDERS_WIN = path.join(APPDATA, "Code - Insiders", "User", "globalStorage");
const CURSOR_GS_WIN = path.join(APPDATA, "Cursor", "User", "globalStorage");
const WINDSURF_GS_WIN = path.join(APPDATA, "Windsurf", "User", "globalStorage");
const CODE_GS_MAC = path.join(HOME, "Library", "Application Support", "Code", "User", "globalStorage");
const CODE_GS_INSIDERS_MAC = path.join(HOME, "Library", "Application Support", "Code - Insiders", "User", "globalStorage");
const CURSOR_GS_MAC = path.join(HOME, "Library", "Application Support", "Cursor", "User", "globalStorage");
const WINDSURF_GS_MAC = path.join(HOME, "Library", "Application Support", "Windsurf", "User", "globalStorage");
const CODE_GS_LNX = path.join(HOME, ".config", "Code", "User", "globalStorage");
const CODE_GS_INSIDERS_LNX = path.join(HOME, ".config", "Code - Insiders", "User", "globalStorage");
const CURSOR_GS_LNX = path.join(HOME, ".config", "Cursor", "User", "globalStorage");
const WINDSURF_GS_LNX = path.join(HOME, ".config", "Windsurf", "User", "globalStorage");
const CODE_SERVER_GS_LNX = path.join(HOME, ".vscode-server", "data", "User", "globalStorage");
const CODE_SERVER_INSIDERS_GS_LNX = path.join(HOME, ".vscode-server-insiders", "data", "User", "globalStorage");

const PROVIDER_EXTENSION_IDS: Record<VsCodeProviderClient, string> = {
  cline: "saoudrizwan.claude-dev",
  roo: "rooveterinaryinc.roo-cline",
  kilo: "kilocode.kilo-code",
};

interface PlatformPaths {
  win32?: string;
  darwin?: string;
  linux?: string;
  default: string;
}

const CONFIG_PATHS: Record<SupportedClient, PlatformPaths> = {
  cursor: {
    win32: path.join(HOME, ".cursor", "mcp.json"),
    darwin: path.join(HOME, ".cursor", "mcp.json"),
    linux: path.join(HOME, ".cursor", "mcp.json"),
    default: path.join(HOME, ".cursor", "mcp.json"),
  },
  "claude-desktop": {
    win32: path.join(APPDATA, "Claude", "claude_desktop_config.json"),
    darwin: path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    linux: path.join(HOME, ".config", "claude-desktop", "claude_desktop_config.json"),
    default: path.join(HOME, ".config", "claude-desktop", "claude_desktop_config.json"),
  },
  windsurf: {
    win32: path.join(HOME, ".codeium", "windsurf", "mcp.json"),
    darwin: path.join(HOME, ".codeium", "windsurf", "mcp.json"),
    linux: path.join(HOME, ".codeium", "windsurf", "mcp.json"),
    default: path.join(HOME, ".codeium", "windsurf", "mcp.json"),
  },
  cline: {
    win32: path.join(CODE_GS_WIN, "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
    darwin: path.join(CODE_GS_MAC, "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
    linux: path.join(CODE_GS_LNX, "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
    default: path.join(CODE_GS_WIN, "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
  },
  roo: {
    win32: path.join(CODE_GS_WIN, "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json"),
    darwin: path.join(CODE_GS_MAC, "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json"),
    linux: path.join(CODE_GS_LNX, "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json"),
    default: path.join(CODE_GS_WIN, "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json"),
  },
  kilo: {
    win32: path.join(CODE_GS_WIN, "kilocode.kilo-code", "settings", "cline_mcp_settings.json"),
    darwin: path.join(CODE_GS_MAC, "kilocode.kilo-code", "settings", "cline_mcp_settings.json"),
    linux: path.join(CODE_GS_LNX, "kilocode.kilo-code", "settings", "cline_mcp_settings.json"),
    default: path.join(CODE_GS_WIN, "kilocode.kilo-code", "settings", "cline_mcp_settings.json"),
  },
};

/** Detection directories — if any exist, the client is likely installed. */
const DETECTION_DIRS: Record<SupportedClient, string[]> = {
  cursor: [
    path.join(HOME, ".cursor"),
  ],
  "claude-desktop": [
    path.join(APPDATA, "Claude"),
    path.join(HOME, "Library", "Application Support", "Claude"),
  ],
  windsurf: [
    path.join(HOME, ".codeium", "windsurf"),
  ],
  cline: [
    path.join(CODE_GS_WIN, "saoudrizwan.claude-dev"),
    path.join(CODE_GS_INSIDERS_WIN, "saoudrizwan.claude-dev"),
    path.join(CODE_GS_MAC, "saoudrizwan.claude-dev"),
    path.join(CODE_GS_INSIDERS_MAC, "saoudrizwan.claude-dev"),
    path.join(CODE_GS_LNX, "saoudrizwan.claude-dev"),
    path.join(CODE_GS_INSIDERS_LNX, "saoudrizwan.claude-dev"),
    path.join(HOME, ".vscode-server", "data", "User", "globalStorage", "saoudrizwan.claude-dev"),
    path.join(HOME, ".vscode-server-insiders", "data", "User", "globalStorage", "saoudrizwan.claude-dev"),
  ],
  roo: [
    path.join(CODE_GS_WIN, "rooveterinaryinc.roo-cline"),
    path.join(CODE_GS_INSIDERS_WIN, "rooveterinaryinc.roo-cline"),
    path.join(CODE_GS_MAC, "rooveterinaryinc.roo-cline"),
    path.join(CODE_GS_INSIDERS_MAC, "rooveterinaryinc.roo-cline"),
    path.join(CODE_GS_LNX, "rooveterinaryinc.roo-cline"),
    path.join(CODE_GS_INSIDERS_LNX, "rooveterinaryinc.roo-cline"),
    path.join(HOME, ".vscode-server", "data", "User", "globalStorage", "rooveterinaryinc.roo-cline"),
    path.join(HOME, ".vscode-server-insiders", "data", "User", "globalStorage", "rooveterinaryinc.roo-cline"),
  ],
  kilo: [
    path.join(CODE_GS_WIN, "kilocode.kilo-code"),
    path.join(CODE_GS_INSIDERS_WIN, "kilocode.kilo-code"),
    path.join(CODE_GS_MAC, "kilocode.kilo-code"),
    path.join(CODE_GS_INSIDERS_MAC, "kilocode.kilo-code"),
    path.join(CODE_GS_LNX, "kilocode.kilo-code"),
    path.join(CODE_GS_INSIDERS_LNX, "kilocode.kilo-code"),
    path.join(HOME, ".vscode-server", "data", "User", "globalStorage", "kilocode.kilo-code"),
    path.join(HOME, ".vscode-server-insiders", "data", "User", "globalStorage", "kilocode.kilo-code"),
  ],
};

/** Human-readable display names. */
const CLIENT_LABELS: Record<SupportedClient, string> = {
  cursor: "Cursor",
  "claude-desktop": "Claude Desktop",
  windsurf: "Windsurf",
  cline: "Cline",
  roo: "Roo Code",
  kilo: "Kilo Code",
};

/** Post-install restart hints. */
const RESTART_HINTS: Record<SupportedClient, string> = {
  cursor: "Restart Cursor (Cmd/Ctrl+Shift+P → \"Reload Window\", or close and reopen Cursor) to activate the MCP server.",
  "claude-desktop": "Quit and reopen Claude Desktop to activate the MCP server.",
  windsurf: "Restart Windsurf to activate the MCP server.",
  cline: "Reload VS Code (Cmd/Ctrl+Shift+P → \"Reload Window\") to activate the MCP server in Cline.",
  roo: "Reload VS Code (Cmd/Ctrl+Shift+P → \"Reload Window\") to activate the MCP server in Roo Code.",
  kilo: "Reload VS Code (Cmd/Ctrl+Shift+P → \"Reload Window\") to activate the MCP server in Kilo Code.",
};

/**
 * Maps a TaskSync provider name to its corresponding MCP client ID.
 * Returns null for providers that don't have a corresponding standalone MCP client config.
 */
const PROVIDER_CLIENT_MAP: Partial<Record<string, SupportedClient>> = {
  cline: "cline",
  roo: "roo",
};

export function getClientForProvider(providerName: string): SupportedClient | null {
  return PROVIDER_CLIENT_MAP[providerName] ?? null;
}

export function getClientLabel(client: SupportedClient): string {
  return CLIENT_LABELS[client];
}

export function getRestartHint(client: SupportedClient): string {
  return RESTART_HINTS[client];
}

export function getConfigPath(client: SupportedClient): string {
  return getConfigPaths(client)[0];
}

export function getConfigPaths(client: SupportedClient): string[] {
  if (!isVsCodeProviderClient(client)) {
    return [getDefaultConfigPath(client)];
  }

  const extensionRoots = getProviderExtensionStorageRoots(client);
  if (extensionRoots.length > 0) {
    return extensionRoots.map((root) => path.join(root, "settings", "cline_mcp_settings.json"));
  }

  return [getDefaultConfigPath(client)];
}

export function detectClientInstalled(client: SupportedClient): boolean {
  if (isVsCodeProviderClient(client)) {
    return getProviderExtensionStorageRoots(client).length > 0;
  }

  return DETECTION_DIRS[client].some((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

export const ALL_CLIENTS: SupportedClient[] = ["cursor", "claude-desktop", "windsurf", "cline", "roo", "kilo"];

function getDefaultConfigPath(client: SupportedClient): string {
  const paths = CONFIG_PATHS[client] as unknown as Record<string, string>;
  return paths[process.platform] ?? paths["default"];
}

function isVsCodeProviderClient(client: SupportedClient): client is VsCodeProviderClient {
  return client === "cline" || client === "roo" || client === "kilo";
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function getVsCodeGlobalStorageRoots(): string[] {
  switch (process.platform) {
    case "win32":
      return [CODE_GS_WIN, CODE_GS_INSIDERS_WIN, CURSOR_GS_WIN, WINDSURF_GS_WIN];
    case "darwin":
      return [CODE_GS_MAC, CODE_GS_INSIDERS_MAC, CURSOR_GS_MAC, WINDSURF_GS_MAC];
    case "linux":
      return [
        CODE_GS_LNX,
        CODE_GS_INSIDERS_LNX,
        CURSOR_GS_LNX,
        WINDSURF_GS_LNX,
        CODE_SERVER_GS_LNX,
        CODE_SERVER_INSIDERS_GS_LNX,
      ];
    default:
      return [CODE_GS_WIN, CODE_GS_INSIDERS_WIN, CURSOR_GS_WIN, WINDSURF_GS_WIN];
  }
}

function getVsCodeProfilesRoots(): string[] {
  const profileParents = (() => {
    switch (process.platform) {
      case "win32":
        return [
          path.join(APPDATA, "Code", "User", "profiles"),
          path.join(APPDATA, "Code - Insiders", "User", "profiles"),
          path.join(APPDATA, "Cursor", "User", "profiles"),
          path.join(APPDATA, "Windsurf", "User", "profiles"),
        ];
      case "darwin":
        return [
          path.join(HOME, "Library", "Application Support", "Code", "User", "profiles"),
          path.join(HOME, "Library", "Application Support", "Code - Insiders", "User", "profiles"),
          path.join(HOME, "Library", "Application Support", "Cursor", "User", "profiles"),
          path.join(HOME, "Library", "Application Support", "Windsurf", "User", "profiles"),
        ];
      case "linux":
        return [
          path.join(HOME, ".config", "Code", "User", "profiles"),
          path.join(HOME, ".config", "Code - Insiders", "User", "profiles"),
          path.join(HOME, ".config", "Cursor", "User", "profiles"),
          path.join(HOME, ".config", "Windsurf", "User", "profiles"),
        ];
      default:
        return [] as string[];
    }
  })();

  const roots: string[] = [];
  for (const parent of profileParents) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(parent);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const globalStorage = path.join(parent, entry, "globalStorage");
      if (isDirectory(globalStorage)) roots.push(globalStorage);
    }
  }

  return roots;
}

function getProviderExtensionStorageRoots(client: VsCodeProviderClient): string[] {
  const extId = PROVIDER_EXTENSION_IDS[client];
  const roots = new Set<string>();

  for (const globalStorage of [...getVsCodeGlobalStorageRoots(), ...getVsCodeProfilesRoots()]) {
    const extensionRoot = path.join(globalStorage, extId);
    if (isDirectory(extensionRoot)) {
      roots.add(extensionRoot);
    }
  }

  return Array.from(roots);
}

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

/**
 * Determines the best command to use for launching the TaskSync MCP server.
 *
 * Priority:
 *  1. If `tasksync` is on PATH → use it directly
 *  2. Otherwise → use `node` with the absolute path to build/cli.js
 */
export function resolveTaskSyncCommand(): McpServerEntry {
  // Check if tasksync binary is available on PATH
  try {
    const findCmd = process.platform === "win32" ? "where" : "which";
    execFileSync(findCmd, ["tasksync"], { stdio: "pipe" });
    return { command: "tasksync", args: ["mcp"] };
  } catch {
    // Not on PATH — fall back to node + absolute path
    // __dirname is src/mcp at dev time, build/mcp after compile
    // Walk up to find the root of the install
    const here = __dirname;
    const buildCli = path.resolve(here, "..", "cli.js");
    const srcCli = path.resolve(here, "..", "..", "build", "cli.js");

    // Prefer build/cli.js relative to the package root
    const candidatePaths = [buildCli, srcCli];
    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        return { command: "node", args: [candidate, "mcp"] };
      }
    }

    // Last resort: use process.argv[1] if it looks like our CLI
    if (process.argv[1] && (process.argv[1].endsWith("cli.js") || process.argv[1].endsWith("tasksync"))) {
      return { command: "node", args: [process.argv[1], "mcp"] };
    }

    // Give up and use the binary name — user will see a useful error if missing
    return { command: "tasksync", args: ["mcp"] };
  }
}

// ---------------------------------------------------------------------------
// Config file I/O
// ---------------------------------------------------------------------------

function readOrCreateConfig(configPath: string): McpConfig {
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as McpConfig;
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        parsed.mcpServers = {};
      }
      return parsed;
    } catch {
      // Unreadable or corrupt — start fresh but warn
      console.warn(`  ⚠  Could not parse existing config at ${configPath}. A fresh config will be written.`);
      return { mcpServers: {} };
    }
  }
  return { mcpServers: {} };
}

function writeConfig(configPath: string, config: McpConfig): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const json = JSON.stringify(config, null, 2) + "\n";
  // Atomic-ish write: write to temp then rename
  const tmp = configPath + ".tasksync.tmp";
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, configPath);
}

function entriesEqual(a: McpServerEntry, b: McpServerEntry): boolean {
  return (
    a.command === b.command &&
    JSON.stringify(a.args) === JSON.stringify(b.args) &&
    JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {})
  );
}

// ---------------------------------------------------------------------------
// Core install logic
// ---------------------------------------------------------------------------

/**
 * Install the TaskSync MCP server entry into a client's config file.
 *
 * Safe merge:
 *  - Reads existing config
 *  - Adds or updates the "tasksync" entry in mcpServers
 *  - Preserves all other entries and top-level keys (e.g. "preferences" in Claude Desktop)
 *  - Writes back atomically
 */
export function installForClient(client: SupportedClient): InstallResult {
  const configPaths = getConfigPaths(client);
  const configPath = configPaths[0];
  const clientDetected = detectClientInstalled(client);
  const entry = resolveTaskSyncCommand();

  const perPathStatus: Array<"installed" | "updated" | "already-current"> = [];

  for (const targetPath of configPaths) {
    const config = readOrCreateConfig(targetPath);
    const existing = config.mcpServers["tasksync"] as McpServerEntry | undefined;

    if (existing) {
      if (entriesEqual(existing, entry)) {
        perPathStatus.push("already-current");
      } else {
        config.mcpServers["tasksync"] = entry;
        writeConfig(targetPath, config);
        perPathStatus.push("updated");
      }
    } else {
      config.mcpServers["tasksync"] = entry;
      writeConfig(targetPath, config);
      perPathStatus.push("installed");
    }
  }

  let status: InstallStatus = "already-current";
  if (perPathStatus.some((s) => s === "installed")) {
    status = "installed";
  } else if (perPathStatus.some((s) => s === "updated")) {
    status = "updated";
  }

  return { status, client, configPath, configPaths, entry, clientDetected };
}

// ---------------------------------------------------------------------------
// Print config logic
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Doctor / status check
// ---------------------------------------------------------------------------

export interface ClientStatus {
  client: SupportedClient;
  label: string;
  detected: boolean;
  /** True when all targeted config files exist. */
  configExists: boolean;
  /** True when all targeted config files have a "tasksync" entry under mcpServers. */
  configured: boolean;
  /** All config files considered relevant for this client on this machine. */
  configPaths: string[];
  /** Subset of configPaths that currently exist on disk. */
  existingConfigPaths: string[];
  /** Subset of configPaths that currently include mcpServers.tasksync. */
  configuredPaths: string[];
  configPath: string;
}

export function checkClientStatus(client: SupportedClient): ClientStatus {
  const configPaths = getConfigPaths(client);
  const configPath = configPaths[0];
  const detected = detectClientInstalled(client);
  const existingConfigPaths: string[] = [];
  const configuredPaths: string[] = [];

  for (const targetPath of configPaths) {
    if (!fs.existsSync(targetPath)) continue;
    existingConfigPaths.push(targetPath);

    try {
      const config = JSON.parse(fs.readFileSync(targetPath, "utf8")) as McpConfig;
      if (config.mcpServers?.["tasksync"]) configuredPaths.push(targetPath);
    } catch {
      // unreadable or corrupt — leave unconfigured for this path
    }
  }

  const configExists = configPaths.length > 0 && existingConfigPaths.length === configPaths.length;
  const configured = configPaths.length > 0 && configuredPaths.length === configPaths.length;

  return {
    client,
    label: CLIENT_LABELS[client],
    detected,
    configExists,
    configured,
    configPaths,
    existingConfigPaths,
    configuredPaths,
    configPath,
  };
}

// ---------------------------------------------------------------------------
// Print config logic
// ---------------------------------------------------------------------------

/**
 * Builds a ready-to-paste JSON snippet for a specific client or generic use.
 * Reflects the actual command that would be written (PATH-aware).
 */
export function buildPrintConfig(client: SupportedClient | "generic"): PrintConfigResult {
  const entry = resolveTaskSyncCommand();
  const snippet = JSON.stringify({ mcpServers: { tasksync: entry } }, null, 2);

  if (client === "generic") {
    return { client, configPath: null, snippet };
  }

  return {
    client,
    configPath: getConfigPath(client),
    snippet,
  };
}
