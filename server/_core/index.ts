import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startScheduler, runMonitoringCycle, telegramWebhookHandler, registerTelegramWebhook } from "../scheduler";
import { closeBrowser } from "../scrapers/browser";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Chat API with streaming and tool calling
  registerChatRoutes(app);
  // Telegram webhook
  app.post("/api/telegram/webhook", (req, res) => {
    telegramWebhookHandler(req as Parameters<typeof telegramWebhookHandler>[0], res as Parameters<typeof telegramWebhookHandler>[1]);
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Health check endpoint (also used for keep-alive self-ping)
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // External cron trigger endpoint — call this from cron-job.org or similar every 30 min
  app.post("/api/cron/run", async (_req, res) => {
    res.json({ ok: true, message: "Monitoring cycle triggered" });
    // Run async after responding
    runMonitoringCycle().catch((err) => {
      console.error("[Cron] External trigger error:", err);
    });
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start the 30-minute monitoring scheduler
    startScheduler().catch(console.error);
    // Register Telegram webhook for callback_query (inline keyboard buttons)
    const appId = process.env.VITE_APP_ID ?? "";
    if (appId) {
      // Manus public domain: {appname}-{appid_prefix}.manus.space
      // Extract first 8 chars of appId (lowercase) for domain prefix
      const appIdPrefix = appId.slice(0, 8).toLowerCase();
      const webhookUrl = `https://officerent-${appIdPrefix}.manus.space/api/telegram/webhook`;
      registerTelegramWebhook(webhookUrl).catch((err) =>
        console.warn("[Telegram] Webhook registration failed:", err)
      );
    }

    // Self-ping keep-alive: ping public health endpoint every 2 minutes to prevent hibernation.
    // Must use the public URL (not localhost) so the platform sees real external traffic.
    const appIdPrefix2 = (process.env.VITE_APP_ID ?? "").slice(0, 8).toLowerCase();
    const publicPingUrl = appIdPrefix2
      ? `https://officerent-${appIdPrefix2}.manus.space/api/health`
      : `http://localhost:${port}/api/health`;
    setInterval(async () => {
      try {
        const res = await fetch(publicPingUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) console.warn(`[KeepAlive] Ping returned ${res.status}`);
      } catch (err) {
        console.warn(`[KeepAlive] Ping failed: ${err instanceof Error ? err.message : err}`);
      }
    }, 2 * 60 * 1000); // every 2 minutes
    console.log(`[KeepAlive] Self-ping started every 2 minutes → ${publicPingUrl}`);
  });
}

// Graceful shutdown: close browser before process exits (important for hot reload)
const shutdown = async () => {
  console.log("[Server] Shutting down gracefully...");
  await closeBrowser();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startServer().catch(console.error);
