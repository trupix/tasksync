/**
 * IProvider interface every TaskSync provider must implement.
 * Providers represent either an AI assistant's native data directory
 * (for example Cline, Roo, OpenClaw) or a TaskSync-owned task store
 * such as captured MCP context.
 */
export interface ProviderRoot {
  id: string;
  label: string;
  path: string;
}

export interface IProvider {
  /** Human-readable provider name (e.g. "cline", "roo", "openclaw", "captured") */
  getProviderName(): string;

  /** 
   * Returns all discovered roots for this provider.
   * A root is a distinct data directory (e.g. local VS Code vs VS Code Server).
   */
  getRoots(): ProviderRoot[];

  /**
   * Returns true if the specific root directory exists and is readable.
   * Should print a descriptive error and return false on failure.
   */
  validateRoot(rootPath: string): boolean;

  /**
   * Schema version � bumped when the manifest format or
   * sync behaviour changes in a breaking way. Start at 1.
   */
  getSchemaVersion(): number;
}
