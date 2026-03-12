import { IProvider, ProviderRoot } from "./interface";
import { getCapturedTasksDir } from "../core/tasks/captured";

/**
 * Provider for TaskSync-owned captured context.
 *
 * Captured tasks are created by the `capture_context` MCP tool and stored in
 * `~/.TaskSync/captured/<taskId>/capture.json`. They are provider-agnostic and
 * represent context captured from any MCP-capable AI tool (Cursor, Claude Desktop, etc.).
 *
 * This provider makes captured tasks first-class participants in TaskSync's
 * existing task listing, search, summary, transcript, and rehydration flows.
 *
 * Sync note: captured tasks are currently local-only. Full sync participation
 * (git push/pull of ~/.TaskSync/captured/) is planned as follow-up work.
 */
export class CapturedProvider implements IProvider {
  private static readonly PROVIDER_NAME = "captured";
  private static readonly ROOT_ID = "local";

  getProviderName(): string {
    return CapturedProvider.PROVIDER_NAME;
  }

  getRoots(): ProviderRoot[] {
    return [
      {
        id: CapturedProvider.ROOT_ID,
        label: "TaskSync Captured",
        path: getCapturedTasksDir(),
      },
    ];
  }

  /**
   * Always returns true — the captured tasks directory is created on first write.
   * An absent directory simply means zero tasks have been captured yet.
   */
  validateRoot(_rootPath: string): boolean {
    return true;
  }

  getSchemaVersion(): number {
    return 1;
  }
}
