import express from "express";
import fs from "fs";
import path from "path";
import { IProvider } from "../providers/interface";
import { exportTaskBundle, importTaskBundle } from "../core/tasks/migration";
import {
  isValidProvider,
  isValidId,
  isValidRootId,
  safePath,
  safeRmDir,
  safeReadFile,
  safeWriteFile,
} from "../utils/security";
import {
  getProviderByNameOrThrow,
  getProviderRootOrThrow,
  requireDashboardAuth,
  safeErr,
} from "./helpers";

export function registerDashboardTaskMutationRoutes(app: express.Express, providers: IProvider[]): void {
  app.delete("/api/tasks", requireDashboardAuth, async (req, res) => {
    try {
      const { provider, rootId, taskId } = req.query;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      if (!isValidId(taskId)) return void safeErr(res, 400, "Invalid taskId");
      const p = getProviderByNameOrThrow(providers, provider as string);
      const r = getProviderRootOrThrow(p, rootId as string);

      safeRmDir(path.join(r.path, "tasks"), taskId as string);

      const rooIndexPath = path.join(r.path, "tasks", "_index.json");
      const clineStatePath = path.join(r.path, "globalState.json");

      if (fs.existsSync(rooIndexPath)) {
        const idx = JSON.parse(safeReadFile(path.join(r.path, "tasks"), "_index.json"));
        idx.entries = (idx.entries || []).filter((e: any) => e.id !== taskId);
        idx.updatedAt = Date.now();
        safeWriteFile(path.join(r.path, "tasks"), "_index.json", JSON.stringify(idx));
      } else if (fs.existsSync(clineStatePath)) {
        const state = JSON.parse(safeReadFile(r.path, "globalState.json"));
        state.taskHistory = (state.taskHistory || []).filter((e: any) => e.id !== taskId);
        safeWriteFile(r.path, "globalState.json", JSON.stringify(state, null, 2));
      }

      res.json({ success: true });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.patch("/api/tasks/workspace", requireDashboardAuth, async (req, res) => {
    try {
      const { provider, rootId, taskId, newWorkspace } = req.body;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      if (!isValidId(taskId)) return void safeErr(res, 400, "Invalid taskId");
      if (typeof newWorkspace !== "string" || newWorkspace.trim() === "") return void safeErr(res, 400, "Invalid newWorkspace");
      const p = getProviderByNameOrThrow(providers, provider as string);
      const r = getProviderRootOrThrow(p, rootId as string);

      const rooIndexPath = path.join(r.path, "tasks", "_index.json");
      if (fs.existsSync(rooIndexPath)) {
        const idx = JSON.parse(safeReadFile(path.join(r.path, "tasks"), "_index.json"));
        const entry = (idx.entries || []).find((e: any) => e.id === taskId);
        if (entry) {
          entry.workspace = newWorkspace;
          idx.updatedAt = Date.now();
          safeWriteFile(path.join(r.path, "tasks"), "_index.json", JSON.stringify(idx));
        }
        const historyItemPath = safePath(path.join(r.path, "tasks"), `${taskId}/history_item.json`);
        if (fs.existsSync(historyItemPath)) {
          const hi = JSON.parse(safeReadFile(path.join(r.path, "tasks"), `${taskId}/history_item.json`));
          hi.workspace = newWorkspace;
          safeWriteFile(path.join(r.path, "tasks"), `${taskId}/history_item.json`, JSON.stringify(hi));
        }
      }

      const clineStatePath = path.join(r.path, "globalState.json");
      if (fs.existsSync(clineStatePath)) {
        const state = JSON.parse(safeReadFile(r.path, "globalState.json"));
        const entry = (state.taskHistory || []).find((e: any) => e.id === taskId);
        if (entry) {
          entry.workspace = newWorkspace;
          safeWriteFile(r.path, "globalState.json", JSON.stringify(state, null, 2));
        }
      }

      res.json({ success: true });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.post("/api/migrate", requireDashboardAuth, async (req, res) => {
    try {
      const { fromProvider, fromRootId, taskId, toProvider, toRootId } = req.body;
      if (!isValidProvider(fromProvider)) return void safeErr(res, 400, "Invalid fromProvider");
      if (!isValidProvider(toProvider)) return void safeErr(res, 400, "Invalid toProvider");
      if (!isValidRootId(fromRootId)) return void safeErr(res, 400, "Invalid fromRootId");
      if (!isValidRootId(toRootId)) return void safeErr(res, 400, "Invalid toRootId");
      if (!isValidId(taskId)) return void safeErr(res, 400, "Invalid taskId");

      const pFrom = getProviderByNameOrThrow(providers, fromProvider);
      const rFrom = getProviderRootOrThrow(pFrom, fromRootId);
      const pTo = getProviderByNameOrThrow(providers, toProvider);
      const rTo = getProviderRootOrThrow(pTo, toRootId);

      const bundleDir = await exportTaskBundle(pFrom, rFrom, taskId, req.body.title || "Migrated Task");
      const newTaskId = await importTaskBundle(pTo, rTo, bundleDir);
      res.json({ success: true, newTaskId });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });
}
