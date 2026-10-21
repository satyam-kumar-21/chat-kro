import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { logger } from "../lib/logger.js";
import "../models/index.js";

connectToDatabase()
  .catch((error: unknown) => {
    logger.error({ err: error }, "MongoDB index initialization failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFromDatabase();
  });
