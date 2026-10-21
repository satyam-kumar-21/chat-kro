import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { csrfCookieName } from "../security/cookies.js";

function equalToken(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export const requireCsrfToken: RequestHandler = (request, _response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  const cookie = request.cookies?.[csrfCookieName];
  const header = request.get("x-csrf-token");
  if (!cookie || !header || !equalToken(cookie, header)) {
    next(new AppError("CSRF token validation failed", 403, "CSRF_INVALID"));
    return;
  }
  next();
};
