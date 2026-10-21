import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export async function connectToDatabase(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  const modelNames = mongoose.modelNames();
  await Promise.all(modelNames.map((name) => mongoose.model(name).createIndexes()));
  logger.info({ modelCount: modelNames.length }, "MongoDB indexes initialized");
  logger.info("MongoDB connection established");
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}
