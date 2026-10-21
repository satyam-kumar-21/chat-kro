import cors from "cors";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { Website } from "../models/index.js";

const applyCors = cors({
  origin: true,
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Public-Widget-Id", "Authorization"],
  maxAge: 600
});

export const widgetCors: RequestHandler = (request, response, next) => {
  const origin = request.get("origin");
  const queryId = request.query.widgetId;
  const widgetId =
    typeof queryId === "string" ? queryId : request.get("x-public-widget-id");

  if (!origin || !widgetId || widgetId.length > 64) {
    next();
    return;
  }
  let localDevelopmentOrigin = false;
  try {
    const parsed = new URL(origin);
    localDevelopmentOrigin =
      env.NODE_ENV !== "production" &&
      env.WIDGET_DEV_MODE === "true" &&
      parsed.origin === origin &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    next();
    return;
  }
  void Website.findOne({
    publicWidgetId: widgetId,
    status: "active",
    ...(!localDevelopmentOrigin ? { allowedOrigins: origin } : {})
  })
    .select("_id")
    .then((website) => {
      if (!website) {
        next();
        return;
      }
      applyCors(request, response, next);
    })
    .catch(next);
}
