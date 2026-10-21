import { Router } from "express";
import { isDatabaseConnected } from "../db/mongoose.js";

export const healthRouter = Router();

healthRouter.get("/live", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

healthRouter.get("/ready", (_request, response) => {
  const databaseConnected = isDatabaseConnected();
  response.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "ready" : "not_ready",
    dependencies: {
      mongodb: databaseConnected ? "connected" : "disconnected"
    }
  });
});
