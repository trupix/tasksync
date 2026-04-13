import express from "express";
import { IProvider } from "../providers/interface";
import { getTasksForRoot } from "../core/tasks/indexer";
import { TaskContextService } from "../core/tasks/context";
import { getSyncRepoPath } from "../utils/identity";
import { readUnifiedManifest, readManifest, TaskSync_VERSION } from "../utils/manifest";
import { isValidProvider, isValidId, isValidRootId } from "../utils/security";
import { checkClientStatus, getClientForProvider } from "../mcp/install";
import { getProviderByNameOrThrow, getProviderRootOrThrow, safeErr } from "./helpers";

export function registerDashboardReadRoutes(app: express.Express, providers: IProvider[]): void {
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      version: TaskSync_VERSION,
      providers: providers.map((p) => ({
        name: p.getProviderName(),
        roots: p.getRoots().map((r) => ({
          id: r.id,
          label: r.label,
          initialized: p.validateRoot(r.path),
        })),
      })),
    });
  });

  app.get("/api/providers", (req, res) => {
    try {
      const result = providers.map((p) => ({
        name: p.getProviderName(),
        roots: p.getRoots().map((r) => {
          const mcpClientId = getClientForProvider(p.getProviderName());
          return {
            id: r.id,
            label: r.label,
            path: r.path,
            isInitialized: p.validateRoot(r.path),
            syncInitialized: (() => {
              const syncRepoPath = getSyncRepoPath();
              const unified = readUnifiedManifest(syncRepoPath);
              if (unified?.providers[p.getProviderName()]) return true;
              return r.path ? !!readManifest(r.path) : false;
            })(),
            mcpClientId: mcpClientId ?? null,
            mcpConfigured: mcpClientId ? checkClientStatus(mcpClientId).configured : false,
          };
        }),
      }));
      res.json({ providers: result });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.get("/api/tasks", (req, res) => {
    try {
      const { provider, rootId } = req.query;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid or missing provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid or missing rootId");
      const p = getProviderByNameOrThrow(providers, provider as string);
      const r = getProviderRootOrThrow(p, rootId as string);
      const tasks = getTasksForRoot(p, r);
      res.json(tasks);
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.get("/api/tasks/rehydrate", (req, res) => {
    try {
      const { provider, rootId, taskId } = req.query;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      if (!isValidId(taskId)) return void safeErr(res, 400, "Invalid taskId");

      const modeRaw = typeof req.query.mode === "string" ? req.query.mode.toLowerCase() : "smart";
      if (modeRaw !== "smart" && modeRaw !== "full") {
        return void safeErr(res, 400, "Invalid mode. Expected smart or full.");
      }

      const includeToolingRaw =
        typeof req.query.includeTooling === "string" ? req.query.includeTooling.toLowerCase() : undefined;
      let includeTooling: boolean | undefined = undefined;
      if (typeof includeToolingRaw === "string") {
        if (["1", "true", "yes"].includes(includeToolingRaw)) includeTooling = true;
        else if (["0", "false", "no"].includes(includeToolingRaw)) includeTooling = false;
        else return void safeErr(res, 400, "Invalid includeTooling flag. Use true/false.");
      }

      let maxChars: number | undefined = undefined;
      if (typeof req.query.maxChars === "string" && req.query.maxChars.trim()) {
        const parsed = Number(req.query.maxChars);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return void safeErr(res, 400, "Invalid maxChars. Must be a positive number.");
        }
        maxChars = Math.floor(parsed);
      }

      const service = new TaskContextService(providers);
      const locator = { provider: provider as string, rootId: rootId as string, taskId: taskId as string };
      const rendered = service.renderTaskContext(locator, {
        mode: modeRaw,
        includeTooling,
        maxChars,
      });

      res.json(rendered);
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });
}
