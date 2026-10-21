import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { widgetCors } from "./middleware/widget-cors.js";
import {
  loginRateLimit,
  messageSubmissionRateLimit,
  passwordResetRateLimit,
  emailVerificationRateLimit,
  registrationRateLimit,
  widgetInitializationRateLimit
} from "./security/rate-limits.js";
import { logger } from "./lib/logger.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { widgetRouter } from "./routes/widget.js";

export const app = express();

app.disable("x-powered-by");
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  if (env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use("/auth/register", registrationRateLimit);
app.use("/auth/verify-email", emailVerificationRateLimit);
app.use("/auth/resend-verification", emailVerificationRateLimit);
app.use("/auth/login", loginRateLimit);
app.use("/auth/password-reset", passwordResetRateLimit);
app.use("/widget/init", widgetInitializationRateLimit);
app.use("/widget/conversation", widgetInitializationRateLimit);
app.use("/widget/profile", messageSubmissionRateLimit);
app.use("/widget/:conversationId/messages", messageSubmissionRateLimit);
app.use("/widget", widgetCors);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origin === env.WEB_ORIGIN) {
        callback(null, origin === env.WEB_ORIGIN);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    maxAge: 600
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/workspaces", workspacesRouter);
app.use("/widget", widgetRouter);
app.use(errorHandler);
