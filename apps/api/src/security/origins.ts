import { AppError } from "../errors/app-error.js";
import { Website } from "../models/index.js";
import { env } from "../config/env.js";

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const localDevelopmentOrigin =
      env.NODE_ENV !== "production" &&
      env.WIDGET_DEV_MODE === "true" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
      (parsed.protocol === "http:" || parsed.protocol === "https:");
    return (
      parsed.origin === origin &&
      (allowedOrigins.includes(origin) || localDevelopmentOrigin)
    );
  } catch {
    return false;
  }
}

export async function assertWidgetOrigin(
  publicWidgetId: string,
  origin: string | undefined
): Promise<void> {
  if (!origin || publicWidgetId.length > 64 || !isAllowedOrigin(origin, [origin])) {
    throw new AppError("Widget origin is not allowed", 403, "ORIGIN_NOT_ALLOWED");
  }
  const website = await Website.findOne({
    publicWidgetId,
    status: "active",
    ...(isAllowedOrigin(origin, []) ? {} : { allowedOrigins: origin })
  }).select("_id");
  if (!website) {
    throw new AppError("Widget origin is not allowed", 403, "ORIGIN_NOT_ALLOWED");
  }
}
