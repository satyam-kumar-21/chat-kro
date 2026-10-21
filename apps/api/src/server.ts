import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase, disconnectFromDatabase } from "./db/mongoose.js";
import { logger } from "./lib/logger.js";
import { closeRealtimeInfrastructure, createRealtimeServer } from "./socket/realtime.js";
import { connectRateLimitRedis, disconnectRateLimitRedis } from "./security/rate-limits.js";

async function start(): Promise<void> {
  await connectToDatabase();
  await connectRateLimitRedis();
  const server = createServer(app);
  const io = await createRealtimeServer(server);

  server.listen(env.API_PORT, env.API_HOST, () => {
    logger.info({ host: env.API_HOST, port: env.API_PORT }, "API server listening");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down API server");
    io.close(async (error) => {
      if (error) {
        logger.error({ err: error }, "Socket.IO shutdown failed");
        process.exitCode = 1;
      }
      await closeRealtimeInfrastructure();
      await disconnectRateLimitRedis();
      await disconnectFromDatabase();
    });
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  logger.fatal({ err: error }, "API startup failed");
  process.exitCode = 1;
});
