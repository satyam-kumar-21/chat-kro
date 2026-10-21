import type { NextConfig } from "next";

const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;
const isProduction = process.env.NODE_ENV === "production";
const widgetScriptUrl = process.env.NEXT_PUBLIC_WIDGET_SCRIPT_URL ??
  (isProduction ? undefined : "http://localhost:5173/src/index.ts");
const widgetScriptOrigin = widgetScriptUrl ? new URL(widgetScriptUrl).origin : undefined;
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}${widgetScriptOrigin ? ` ${widgetScriptOrigin}` : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} ${apiOrigin.replace(/^http/, "ws")}${widgetScriptOrigin ? ` ${widgetScriptOrigin} ${widgetScriptOrigin.replace(/^http/, "ws")}` : ""}`,
  "worker-src 'self' blob:",
  ...(isProduction ? ["upgrade-insecure-requests"] : [])
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ...(isProduction
          ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
          : [])
      ]
    }];
  }
};

export default nextConfig;
