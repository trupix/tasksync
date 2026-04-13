import express from "express";
import { IProvider, ProviderRoot } from "../providers/interface";
import { runUnifiedInit, runUnifiedSync } from "../core/sync";
import { isValidProvider, isValidRootId } from "../utils/security";
import { installForClient, getClientForProvider } from "../mcp/install";
import {
  getProviderByNameOrThrow,
  getProviderRootOrThrow,
  requireDashboardAuth,
  safeErr,
} from "./helpers";

export function registerDashboardOpsRoutes(app: express.Express, providers: IProvider[]): void {
  app.post("/api/init", requireDashboardAuth, async (req, res) => {
    try {
      const { provider, rootId, repoUrl, pat } = req.body;
      if (typeof repoUrl !== "string" || !repoUrl.startsWith("http")) return void safeErr(res, 400, "Invalid repoUrl");

      let targets: { provider: IProvider; root: ProviderRoot }[];
      if (provider && rootId) {
        if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
        if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
        const p = getProviderByNameOrThrow(providers, provider);
        const r = getProviderRootOrThrow(p, rootId);
        targets = [{ provider: p, root: r }];
      } else {
        targets = providers
          .flatMap((p) => p.getRoots().map((r) => ({ provider: p, root: r })))
          .filter(({ provider: p, root: r }) => p.validateRoot(r.path));
        if (targets.length === 0) return void safeErr(res, 400, "No providers detected on this machine");
      }

      await runUnifiedInit(targets, { repoUrl, pat });
      res.json({ success: true, providers: targets.map((t) => t.provider.getProviderName()) });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.post("/api/sync", requireDashboardAuth, async (req, res) => {
    try {
      const { provider, rootId } = req.body;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      if (!isValidRootId(rootId)) return void safeErr(res, 400, "Invalid rootId");
      const p = getProviderByNameOrThrow(providers, provider);
      const r = getProviderRootOrThrow(p, rootId);
      await runUnifiedSync([{ provider: p, root: r }]);
      res.json({ success: true });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.post("/api/mcp/install", requireDashboardAuth, (req, res) => {
    try {
      const { provider } = req.body;
      if (!isValidProvider(provider)) return void safeErr(res, 400, "Invalid provider");
      const clientId = getClientForProvider(provider);
      if (!clientId) return void safeErr(res, 400, `No MCP client config known for provider: ${provider}`);
      const result = installForClient(clientId);
      res.json({ success: true, status: result.status, configPath: result.configPath });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });
}
