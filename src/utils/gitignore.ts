import fs from "fs";
import path from "path";

/**
 * The comprehensive set of patterns TaskSync manages.
 * These protect sensitive data and prevent large binary artifacts from
 * bloating the sync repository.
 */
const MANAGED_PATTERNS = [
  "# TaskSync managed — do not remove this section",
  "secrets.json",
  "*.token",
  "*.auth",
  "*.credentials",
  "*_secret*",
  "*_token*",
  "cache/",
  "temp/",
  "logs/",
  "*.log",
  "node_modules/",
  "puppeteer/",
  ".chromium-browser-snapshots/",
  "*.crdownload",
  ".DS_Store",
  "Thumbs.db",
  "*.sock",
  "*.pid",
  // End marker so we can detect whether the section already exists
  "# end TaskSync managed",
];

const SECTION_START = "# TaskSync managed — do not remove this section";
const SECTION_END = "# end TaskSync managed";

/**
 * Write (or update) the TaskSync-managed block in the `.gitignore` file
 * located at `<dataPath>/.gitignore`.
 *
 * Idempotent: calling multiple times is safe.
 */
export function ensureGitignore(dataPath: string): void {
  const gitignorePath = path.join(dataPath, ".gitignore");

  let existing = "";
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, "utf8");
  }

  if (existing.includes(SECTION_START)) {
    // Replace the existing managed section
    const before = existing.substring(0, existing.indexOf(SECTION_START));
    const after = existing.includes(SECTION_END)
      ? existing.substring(existing.indexOf(SECTION_END) + SECTION_END.length)
      : "";

    const updated = (before.trimEnd() + "\n\n" + MANAGED_PATTERNS.join("\n") + "\n" + (after.trimStart() ? "\n" + after.trimStart() : "")).trimEnd() + "\n";
    fs.writeFileSync(gitignorePath, updated, "utf8");
  } else {
    // Append the managed section
    const separator = existing.trimEnd().length > 0 ? "\n\n" : "";
    fs.appendFileSync(gitignorePath, separator + MANAGED_PATTERNS.join("\n") + "\n", "utf8");
  }
}
