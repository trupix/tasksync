/**
 * Auth utility — manages GitHub PAT storage and verification.
 *
 * Token is stored in ~/.TaskSync/auth.json with chmod 600.
 * Never written to git config, env files, or remote URLs.
 */
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";

// --- Paths -------------------------------------------------------------------

const TaskSync_DIR = path.join(os.homedir(), ".TaskSync");
const AUTH_FILE = path.join(TaskSync_DIR, "auth.json");

// --- Types -------------------------------------------------------------------

export interface AuthConfig {
  github: {
    pat: string;
    username: string;
    verifiedAt: string;
  };
}

export interface GitHubUser {
  login: string;
  name: string | null;
  html_url: string;
}

// --- Token verification -----------------------------------------------------

/**
 * Verify a GitHub PAT by calling the /user endpoint.
 * Returns the GitHub user info on success, throws on failure.
 */
export function verifyToken(pat: string): Promise<GitHubUser> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/user",
        method: "GET",
        headers: {
          Authorization: `token ${pat}`,
          "User-Agent": "TaskSync-cli",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const user = JSON.parse(body);
              resolve({
                login: user.login,
                name: user.name ?? null,
                html_url: user.html_url,
              });
            } catch {
              reject(new Error("Failed to parse GitHub API response"));
            }
          } else if (res.statusCode === 401) {
            reject(new Error("Invalid token — authentication failed (401)"));
          } else if (res.statusCode === 403) {
            reject(
              new Error(
                "Token forbidden (403) — check scopes. Required: repo"
              )
            );
          } else {
            reject(
              new Error(
                `GitHub API returned ${res.statusCode}: ${body.substring(0, 200)}`
              )
            );
          }
        });
      }
    );

    req.on("error", (e) => {
      reject(new Error(`Network error verifying token: ${e.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Timeout verifying token with GitHub API"));
    });

    req.end();
  });
}

// --- Token storage -----------------------------------------------------------

/**
 * Save a verified token to ~/.TaskSync/auth.json (chmod 600).
 */
export function saveToken(pat: string, username: string): void {
  fs.mkdirSync(TaskSync_DIR, { recursive: true });

  const config: AuthConfig = {
    github: {
      pat,
      username,
      verifiedAt: new Date().toISOString(),
    },
  };

  fs.writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  // Ensure permissions even if file already existed
  fs.chmodSync(AUTH_FILE, 0o600);
}

/**
 * Load the stored token from ~/.TaskSync/auth.json.
 * Returns null if not found or unreadable.
 */
export function loadToken(): AuthConfig | null {
  if (!fs.existsSync(AUTH_FILE)) return null;

  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8");
    const config = JSON.parse(raw) as AuthConfig;

    // Basic validation
    if (!config?.github?.pat || !config?.github?.username) return null;

    return config;
  } catch {
    return null;
  }
}

/**
 * Get just the PAT string, or null if not stored.
 */
export function loadPat(): string | null {
  const config = loadToken();
  return config?.github?.pat ?? null;
}

/**
 * Delete the stored auth config.
 */
export function deleteToken(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;

  try {
    fs.rmSync(AUTH_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if authentication is configured (any method).
 */
export function isAuthenticated(): boolean {
  // Check stored token
  if (loadPat()) return true;

  // Check env var
  if (process.env.TaskSync_GIT_TOKEN) return true;

  return false;
}

/**
 * Get a human-readable auth status summary.
 */
export function getAuthStatus(): {
  authenticated: boolean;
  method: string;
  username?: string;
  maskedToken?: string;
  verifiedAt?: string;
} {
  // Priority 1: env var
  if (process.env.TaskSync_GIT_TOKEN) {
    const pat = process.env.TaskSync_GIT_TOKEN;
    return {
      authenticated: true,
      method: "TaskSync_GIT_TOKEN environment variable",
      maskedToken: maskToken(pat),
    };
  }

  // Priority 2: stored token
  const config = loadToken();
  if (config) {
    return {
      authenticated: true,
      method: "~/.TaskSync/auth.json",
      username: config.github.username,
      maskedToken: maskToken(config.github.pat),
      verifiedAt: config.github.verifiedAt,
    };
  }

  return {
    authenticated: false,
    method: "none",
  };
}

// --- Helpers -----------------------------------------------------------------

/** Mask a token for display: show first 4 and last 4 chars. */
function maskToken(token: string): string {
  if (token.length <= 12) return "****";
  return `${token.slice(0, 4)}${"•".repeat(Math.min(token.length - 8, 28))}${token.slice(-4)}`;
}

// --- Interactive prompt ------------------------------------------------------

import readline from "readline";

/**
 * Prompt the user for input on stdin. Supports masked input for tokens.
 */
export function prompt(question: string, options?: { mask?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (options?.mask) {
      // Mask input characters
      const stdin = process.stdin;
      const stdout = process.stdout;
      let input = "";

      stdout.write(question);

      // Switch to raw mode for masking
      if (stdin.isTTY) {
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf8");

        const onData = (char: string) => {
          const c = char.toString();

          if (c === "\n" || c === "\r" || c === "\u0004") {
            // Enter or Ctrl+D
            stdin.setRawMode(false);
            stdin.removeListener("data", onData);
            stdout.write("\n");
            rl.close();
            resolve(input);
          } else if (c === "\u0003") {
            // Ctrl+C
            stdin.setRawMode(false);
            stdout.write("\n");
            rl.close();
            process.exit(0);
          } else if (c === "\u007F" || c === "\b") {
            // Backspace
            if (input.length > 0) {
              input = input.slice(0, -1);
              stdout.write("\b \b");
            }
          } else {
            input += c;
            stdout.write("•");
          }
        };

        stdin.on("data", onData);
      } else {
        // Not a TTY — just read normally (e.g. piped input)
        rl.question("", (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      }
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * Present a list of options and let the user choose with arrow keys.
 * Returns the index of the selected option.
 */
export function promptSelect(question: string, options: string[]): Promise<number> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let selected = 0;

    const render = () => {
      // Move cursor up to redraw
      if (selected >= 0) {
        stdout.write(`\x1b[${options.length}A`);
      }
      for (let i = 0; i < options.length; i++) {
        const prefix = i === selected ? "  ? " : "    ";
        const style = i === selected ? "\x1b[36m" : "\x1b[2m"; // cyan vs dim
        stdout.write(`\x1b[2K${prefix}${style}${options[i]}\x1b[0m\n`);
      }
    };

    stdout.write(`  ${question}\n`);
    // Initial render
    for (let i = 0; i < options.length; i++) {
      const prefix = i === selected ? "  ? " : "    ";
      const style = i === selected ? "\x1b[36m" : "\x1b[2m";
      stdout.write(`${prefix}${style}${options[i]}\x1b[0m\n`);
    }

    if (!stdin.isTTY) {
      // Not interactive, pick first option
      resolve(0);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (key: string) => {
      if (key === "\x1b[A") {
        // Up arrow
        selected = (selected - 1 + options.length) % options.length;
        render();
      } else if (key === "\x1b[B") {
        // Down arrow
        selected = (selected + 1) % options.length;
        render();
      } else if (key === "\r" || key === "\n") {
        // Enter
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        stdin.pause();
        resolve(selected);
      } else if (key === "\x03") {
        // Ctrl+C
        stdin.setRawMode(false);
        stdout.write("\n");
        process.exit(0);
      }
    };

    stdin.on("data", onData);
  });
}
