import express from "express";
import { ClineProvider } from "../providers/cline";
import { RooProvider } from "../providers/roo";
import { OpenClawProvider } from "../providers/openclaw";
import { IProvider, ProviderRoot } from "../providers/interface";
import { redactTokens, verifyDashboardToken } from "../utils/security";

export function createDashboardProviders(): IProvider[] {
  return [
    new ClineProvider(),
    new RooProvider(),
    new OpenClawProvider(),
  ];
}

export function safeErr(res: express.Response, status: number, message: string): void {
  res.status(status).json({ error: redactTokens(message) });
}

export function requireDashboardAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const headerVal = req.headers["x-tasksync-token"] as string | undefined;
  if (!verifyDashboardToken(headerVal)) {
    res.status(401).json({ error: "Unauthorized: missing or invalid x-tasksync-token header" });
    return;
  }
  next();
}

export function getProviderByNameOrThrow(providers: IProvider[], name: string): IProvider {
  const provider = providers.find((p) => p.getProviderName() === name);
  if (!provider) throw new Error(`Provider ${name} not found`);
  return provider;
}

export function getProviderRootOrThrow(provider: IProvider, rootId: string): ProviderRoot {
  const root = provider.getRoots().find((r) => r.id === rootId);
  if (!root) throw new Error(`Root ${rootId} not found for provider ${provider.getProviderName()}`);
  return root;
}
