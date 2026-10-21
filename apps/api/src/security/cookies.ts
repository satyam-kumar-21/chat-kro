import type { CookieOptions } from "express";
import { env } from "../config/env.js";

export const sessionCookieName = "relay_session";
export const csrfCookieName = "relay_csrf";

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000
};

export const csrfCookieOptions: CookieOptions = {
  httpOnly: false,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000
};

export const clearSessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/"
};

export const clearCsrfCookieOptions: CookieOptions = {
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/"
};
