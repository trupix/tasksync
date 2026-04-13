import express from "express";
import cors from "cors";
import path from "path";
import { KiloProvider } from "../providers/kilo";
import { getDashboardToken } from "../utils/security";
import { loadDashboardLogoSvg } from "./assets";
import { loadDashboardDocsHtml } from "./docs";
import { createDashboardProviders } from "./helpers";
import { registerDashboardReadRoutes } from "./routes-read";
import { registerDashboardOpsRoutes } from "./routes-ops";
import { registerDashboardTaskMutationRoutes } from "./routes-tasks";
import { registerDashboardAuthRoutes } from "./routes-auth";
import { registerDashboardPageRoute } from "./routes-page";

export async function startDashboard(port: number, openBrowser: boolean) {
  const app = express();
  app.use(cors({ origin: `http://127.0.0.1:${port}` }));
  app.use(express.json({ limit: "2mb" }));

  const authToken = getDashboardToken();

  const providers = [
    ...createDashboardProviders(),
    new KiloProvider(),
  ];

  const LOGO_SVG = loadDashboardLogoSvg(__dirname);
  const DOCS_HTML = loadDashboardDocsHtml(__dirname);

  registerDashboardReadRoutes(app, providers);
  registerDashboardOpsRoutes(app, providers);
  registerDashboardTaskMutationRoutes(app, providers);
  registerDashboardAuthRoutes(app);
  registerDashboardPageRoute(app, { authToken, LOGO_SVG, DOCS_HTML });

  app.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n🚀 TaskSync Dashboard running at ${url}\n`);
    if (openBrowser) {
      import("child_process").then(({ exec }) => {
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${cmd} ${url}`);
      });
    }
  });
}
