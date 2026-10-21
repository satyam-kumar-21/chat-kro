import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

const rateLimitRedis = env.REDIS_URL ? createClient({ url: env.REDIS_URL }) : undefined;
rateLimitRedis?.on("error", (error) => logger.error({ err: error }, "Rate-limit Redis connection failed"));

export async function connectRateLimitRedis(): Promise<void> {
  if (rateLimitRedis && !rateLimitRedis.isOpen) await rateLimitRedis.connect();
}

export async function disconnectRateLimitRedis(): Promise<void> {
  if (rateLimitRedis?.isOpen) await rateLimitRedis.quit();
}

function limiter(name: string, windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later."
      }
    },
    ...(rateLimitRedis
      ? {
          store: new RedisStore({
            prefix: `relay:rate-limit:${name}:`,
            sendCommand: (...args: string[]) => rateLimitRedis.sendCommand(args)
          })
        }
      : {})
  });
}

export const registrationRateLimit = limiter("registration", 60 * 60 * 1000, 5);
export const emailVerificationRateLimit = limiter("email-verification", 60 * 60 * 1000, 10);
export const loginRateLimit = limiter("login", 15 * 60 * 1000, 10);
export const passwordResetRateLimit = limiter("password-reset", 60 * 60 * 1000, 5);
export const widgetInitializationRateLimit = limiter("widget-initialization", 60 * 1000, 60);
export const messageSubmissionRateLimit = limiter("message-submission", 60 * 1000, 30);
