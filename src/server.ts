import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./db/index.js";
import { closeRealtime, initRealtime } from "./realtime/realtime.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  await connectDatabase(env.DATABASE_URL);

  const server = createServer(createApp());
  initRealtime(server);
  server.listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT, env: env.nodeEnv, origin: env.FRONTEND_URL }, "Faza API listening");
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    closeRealtime();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });

    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.error(error, "Failed to start server");
  process.exit(1);
});
