import express from "express";
import {
  saveToken,
  loadToken,
  deleteToken,
  verifyToken,
  getAuthStatus,
  checkGitHubRepoExists,
  createGitHubRepo,
} from "../utils/auth";
import { requireDashboardAuth, safeErr } from "./helpers";

export function registerDashboardAuthRoutes(app: express.Express): void {
  app.get("/api/auth/status", (req, res) => {
    res.json(getAuthStatus());
  });

  app.post("/api/auth/save", requireDashboardAuth, async (req, res) => {
    try {
      const { pat } = req.body;
      if (typeof pat !== "string" || pat.trim().length === 0) return void safeErr(res, 400, "PAT is required");
      const user = await verifyToken(pat.trim());
      saveToken(pat.trim(), user.login);
      res.json({ success: true, username: user.login, name: user.name });
    } catch (e: any) {
      safeErr(res, 400, e.message);
    }
  });

  app.delete("/api/auth", requireDashboardAuth, (req, res) => {
    deleteToken();
    res.json({ success: true });
  });

  app.post("/api/auth/check-repo", requireDashboardAuth, async (req, res) => {
    try {
      const { repoName } = req.body;
      if (typeof repoName !== "string" || repoName.trim().length === 0) return void safeErr(res, 400, "repoName is required");
      const status = getAuthStatus();
      if (!status.authenticated || !status.username) return void safeErr(res, 401, "Not authenticated — save a PAT first");
      const config = loadToken();
      if (!config) return void safeErr(res, 401, "No stored token");
      const exists = await checkGitHubRepoExists(config.github.pat, status.username, repoName.trim());
      res.json({ exists, username: status.username, repoName: repoName.trim() });
    } catch (e: any) {
      safeErr(res, 500, e.message);
    }
  });

  app.post("/api/auth/create-repo", requireDashboardAuth, async (req, res) => {
    try {
      const { repoName } = req.body;
      if (typeof repoName !== "string" || repoName.trim().length === 0) return void safeErr(res, 400, "repoName is required");
      const config = loadToken();
      if (!config) return void safeErr(res, 401, "No stored token — save a PAT first");
      const { cloneUrl, htmlUrl } = await createGitHubRepo(config.github.pat, repoName.trim());
      res.json({ success: true, cloneUrl, htmlUrl });
    } catch (e: any) {
      safeErr(res, 400, e.message);
    }
  });
}
