import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(projectRoot, ".env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/live-chat-saas"),
  REDIS_URL: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().url().optional()
  ),
  WEB_ORIGIN: z.string().url().refine((origin) => new URL(origin).origin === origin).default("http://localhost:3000"),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().email().optional()
  ),
  WIDGET_SESSION_SECRET: z.string().min(32).default("development-only-widget-secret-change-this-32"),
  WIDGET_DEV_MODE: z.enum(["true", "false"]).default("false")
});

export const env = envSchema.parse(process.env);
if (env.NODE_ENV === "production" && env.WIDGET_SESSION_SECRET.startsWith("development-only-")) {
  throw new Error("WIDGET_SESSION_SECRET must be configured with a production secret");
}
if (env.NODE_ENV === "production" && !env.REDIS_URL) {
  throw new Error("REDIS_URL is required in production for shared rate limits and Socket.IO scaling");
}
