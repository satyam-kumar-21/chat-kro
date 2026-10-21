import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { registrationSchema } from "@live-chat/shared";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { actorFromRequest, requireAuthentication } from "../middleware/authenticate.js";
import { requireCsrfToken } from "../middleware/csrf.js";
import { EmailVerificationToken, User, WorkspaceMember } from "../models/index.js";
import { hashPassword } from "../security/passwords.js";
import {
  clearCsrfCookieOptions,
  clearSessionCookieOptions,
  csrfCookieName,
  csrfCookieOptions,
  sessionCookieName,
  sessionCookieOptions
} from "../security/cookies.js";
import {
  createEmailVerificationToken,
  createPasswordResetToken,
  createRefreshSession,
  findSessionByToken,
  resetPasswordWithToken,
  revokeRefreshSession,
  rotateRefreshSession,
  verifyEmailWithToken,
  verifyUserPassword
} from "../services/identity-service.js";
import { sendActionEmail } from "../services/email-service.js";
import { acceptInvitation } from "../services/invitation-service.js";

export const authRouter = Router();
const authOrigin = env.WEB_ORIGIN;
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
}).strict();
const tokenSchema = z.object({ token: z.string().min(32).max(128) }).strict();

function routeParam(request: import("express").Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw new AppError("Invalid route parameter", 400, "VALIDATION_ERROR");
  return value;
}

function setCsrfCookie(response: import("express").Response) {
  const token = randomBytes(32).toString("base64url");
  response.cookie(csrfCookieName, token, csrfCookieOptions);
  return token;
}

function setSessionCookie(response: import("express").Response, token: string) {
  response.cookie(sessionCookieName, token, sessionCookieOptions);
  return setCsrfCookie(response);
}

function clearAuthCookies(response: import("express").Response) {
  response.clearCookie(sessionCookieName, clearSessionCookieOptions);
  response.clearCookie(csrfCookieName, clearCsrfCookieOptions);
}

authRouter.get("/csrf", (_request, response) => {
  const csrfToken = setCsrfCookie(response);
  response.json({ csrfToken });
});

authRouter.post("/register", async (request, response) => {
  const parsed = registrationSchema.extend({
    acceptedTerms: z.literal(true)
  }).safeParse(request.body);
  if (!parsed.success) {
    throw new AppError("Please provide valid registration details and accept the terms", 400, "VALIDATION_ERROR");
  }
  const email = parsed.data.email.toLowerCase();
  const existing = await User.exists({ email });
  if (existing) {
    response.status(202).json({
      message: "If this email can be registered, a verification message will be sent."
    });
    return;
  }
  let user;
  try {
    user = await User.create({
      name: parsed.data.name,
      email,
      passwordHash: await hashPassword(parsed.data.password),
      accountStatus: "pending",
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date()
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      response.status(202).json({
        message: "If this email can be registered, a verification message will be sent."
      });
      return;
    }
    throw error;
  }
  const token = await createEmailVerificationToken(user._id.toString());
  const verificationUrl = new URL("/verify-email", authOrigin);
  verificationUrl.searchParams.set("token", token);
  const sent = await sendActionEmail({
    to: user.email,
    subject: "Verify your Relay Chat account",
    actionUrl: verificationUrl.toString(),
    actionLabel: "Verify email"
  });
  response.status(202).json({
    message: "If this email can be registered, a verification message will be sent.",
    ...(!sent && env.NODE_ENV !== "production"
      ? { developmentVerificationUrl: verificationUrl.toString() }
      : {})
  });
});

authRouter.post("/verify-email", async (request, response) => {
  const parsed = tokenSchema.safeParse(request.body);
  if (!parsed.success || !(await verifyEmailWithToken(parsed.data.token))) {
    throw new AppError("Verification link is invalid or expired", 400, "INVALID_VERIFICATION");
  }
  response.json({ message: "Email verified. You can now sign in and create your workspace." });
});

authRouter.post("/resend-verification", async (request, response) => {
  const emailSchema = z.object({ email: z.string().trim().email().max(254) }).strict();
  const parsed = emailSchema.safeParse(request.body);
  if (!parsed.success) throw new AppError("Invalid request", 400, "VALIDATION_ERROR");
  const user = await User.findOne({
    email: parsed.data.email.toLowerCase(),
    accountStatus: "pending"
  }).select("_id email");
  let developmentVerificationUrl: string | undefined;
  if (user) {
    const token = await createEmailVerificationToken(user._id.toString());
    const url = new URL("/verify-email", authOrigin);
    url.searchParams.set("token", token);
    const sent = await sendActionEmail({
      to: user.email,
      subject: "Verify your Relay Chat account",
      actionUrl: url.toString(),
      actionLabel: "Verify email"
    });
    if (!sent && env.NODE_ENV !== "production") developmentVerificationUrl = url.toString();
  }
  response.status(202).json({
    message: "If verification is available for this account, a message will be sent.",
    ...(developmentVerificationUrl ? { developmentVerificationUrl } : {})
  });
});

authRouter.post("/login", async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  const user = await verifyUserPassword(parsed.data.email, parsed.data.password);
  if (!user) throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  const session = await createRefreshSession({
    userId: user._id.toString(),
    expiresAt: new Date(Date.now() + sessionCookieOptions.maxAge!),
    userAgent: request.get("user-agent")?.slice(0, 512),
    ipAddress: request.ip
  });
  const csrfToken = setSessionCookie(response, session.refreshToken);
  const fullUser = await User.findById(user._id).select("name email emailVerifiedAt").lean();
  const workspaces = await WorkspaceMember.find({
    userId: user._id,
    status: "active"
  }).populate({ path: "workspaceId", select: "name slug" }).lean();
  response.json({
    user: fullUser,
    workspaces: workspaces.map((membership) => ({
      id: membership.workspaceId && typeof membership.workspaceId === "object" && "_id" in membership.workspaceId
        ? membership.workspaceId._id.toString()
        : "",
      name: membership.workspaceId && typeof membership.workspaceId === "object" && "name" in membership.workspaceId
        ? membership.workspaceId.name
        : "",
      role: membership.role
    })),
    csrfToken
  });
});

authRouter.post("/refresh", requireCsrfToken, async (request, response) => {
  const token = request.cookies?.[sessionCookieName];
  if (typeof token !== "string") throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  const rotated = await rotateRefreshSession(token, new Date(Date.now() + sessionCookieOptions.maxAge!));
  if (!rotated) {
    clearAuthCookies(response);
    throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  }
  const csrfToken = setSessionCookie(response, rotated.refreshToken);
  response.json({ csrfToken });
});

authRouter.post("/logout", requireAuthentication, requireCsrfToken, async (request, response) => {
  const token = request.cookies?.[sessionCookieName];
  if (typeof token === "string") await revokeRefreshSession(token);
  clearAuthCookies(response);
  response.status(204).end();
});

authRouter.post("/accept-invitation", requireAuthentication, requireCsrfToken, async (request, response) => {
  const parsed = tokenSchema.safeParse(request.body);
  if (!parsed.success) throw new AppError("Invitation is invalid or expired", 404, "NOT_FOUND");
  const accepted = await acceptInvitation(
    actorFromRequest(request),
    parsed.data.token
  );
  response.json({ accepted });
});

authRouter.get("/me", requireAuthentication, async (request, response) => {
  const token = request.cookies?.[sessionCookieName] as string;
  const session = await findSessionByToken(token);
  if (!session) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  const user = await User.findById(session.userId)
    .select("name email emailVerifiedAt avatarUrl accountStatus")
    .lean();
  if (!user) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  const workspaces = await WorkspaceMember.find({ userId: user._id, status: "active" })
    .populate({ path: "workspaceId", select: "name slug" })
    .lean();
  response.json({
    user: { ...user, id: user._id.toString() },
    session: { id: session._id.toString(), expiresAt: session.expiresAt },
    workspaces: workspaces.map((membership) => ({
      workspace: membership.workspaceId && typeof membership.workspaceId === "object" && "_id" in membership.workspaceId
        ? {
            id: membership.workspaceId._id.toString(),
            name: "name" in membership.workspaceId ? membership.workspaceId.name : "",
            slug: "slug" in membership.workspaceId ? membership.workspaceId.slug : "",
            plan: "plan" in membership.workspaceId ? membership.workspaceId.plan : undefined
          }
        : null,
      role: membership.role
    }))
  });
});

authRouter.patch("/profile", requireAuthentication, requireCsrfToken, async (request, response) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.union([
      z.string().url().max(2048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
      z.literal("")
    ]).nullable().optional()
  }).strict().refine((value) => Object.keys(value).length > 0).safeParse(request.body);
  if (!parsed.success) throw new AppError("Invalid profile details", 400, "VALIDATION_ERROR");
  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.avatarUrl !== undefined) update.avatarUrl = parsed.data.avatarUrl || null;
  const user = await User.findOneAndUpdate(
    { _id: actorFromRequest(request).userId, accountStatus: "active" },
    { $set: update },
    { new: true, runValidators: true }
  ).select("name email emailVerifiedAt avatarUrl");
  if (!user) throw new AppError("Account not found", 404, "NOT_FOUND");
  response.json({ user: { id: user._id.toString(), name: user.name, email: user.email, emailVerifiedAt: user.emailVerifiedAt, avatarUrl: user.avatarUrl } });
});

authRouter.get("/preferences", requireAuthentication, async (request, response) => {
  const user = await User.findOne({ _id: actorFromRequest(request).userId, accountStatus: "active" })
    .select("notificationPreferences")
    .lean();
  if (!user) throw new AppError("Account not found", 404, "NOT_FOUND");
  response.json({ preferences: user.notificationPreferences ?? { sound: false, desktop: false } });
});

authRouter.patch("/preferences", requireAuthentication, requireCsrfToken, async (request, response) => {
  const parsed = z.object({
    sound: z.boolean(),
    desktop: z.boolean()
  }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError("Invalid notification preferences", 400, "VALIDATION_ERROR");
  const user = await User.findOneAndUpdate(
    { _id: actorFromRequest(request).userId, accountStatus: "active" },
    { $set: { notificationPreferences: parsed.data } },
    { new: true, runValidators: true }
  ).select("notificationPreferences");
  if (!user) throw new AppError("Account not found", 404, "NOT_FOUND");
  response.json({ preferences: user.notificationPreferences });
});

authRouter.post("/password-reset", async (request, response) => {
  const parsed = z.object({ email: z.string().trim().email().max(254) }).strict().safeParse(request.body);
  if (!parsed.success) {
    response.status(202).json({ message: "If the account exists, password reset instructions will be sent." });
    return;
  }
  const reset = await createPasswordResetToken(parsed.data.email);
  let developmentResetUrl: string | undefined;
  if (reset) {
    const url = new URL("/reset-password", authOrigin);
    url.searchParams.set("token", reset.token);
    const sent = await sendActionEmail({
      to: parsed.data.email,
      subject: "Reset your Relay Chat password",
      actionUrl: url.toString(),
      actionLabel: "Reset password"
    });
    if (!sent && env.NODE_ENV !== "production") developmentResetUrl = url.toString();
  }
  response.status(202).json({
    message: "If the account exists, password reset instructions will be sent.",
    ...(developmentResetUrl ? { developmentResetUrl } : {})
  });
});

authRouter.post("/reset-password", async (request, response) => {
  const parsed = z.object({
    token: z.string().min(32).max(128),
    password: z.string().min(12).max(128)
  }).strict().safeParse(request.body);
  if (!parsed.success || !(await resetPasswordWithToken(parsed.data.token, parsed.data.password))) {
    throw new AppError("Password reset link is invalid or expired", 400, "INVALID_RESET_TOKEN");
  }
  clearAuthCookies(response);
  response.json({ message: "Password reset. Sign in with your new password." });
});

authRouter.get("/sessions", requireAuthentication, async (request, response) => {
  const token = request.cookies?.[sessionCookieName] as string;
  const session = await findSessionByToken(token);
  if (!session) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  const sessions = await (await import("../models/index.js")).Session.find({
    userId: session.userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  }).select("createdAt expiresAt userAgent ipAddress");
  response.json({
    sessions: sessions.map((item) => ({
      id: item._id.toString(),
      current: item._id.equals(session._id),
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      userAgent: item.userAgent,
      ipAddress: item.ipAddress
    }))
  });
});

authRouter.delete(
  "/sessions/:sessionId",
  requireAuthentication,
  requireCsrfToken,
  async (request, response) => {
  const token = request.cookies?.[sessionCookieName] as string;
  const currentSession = await findSessionByToken(token);
  const sessionId = routeParam(request, "sessionId");
  if (!currentSession || !/^[\da-f]{24}$/i.test(sessionId)) {
    throw new AppError("Session not found", 404, "NOT_FOUND");
  }
  const { Session } = await import("../models/index.js");
  await Session.updateOne(
    { _id: sessionId, userId: currentSession.userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  if (currentSession._id.toString() === sessionId) clearAuthCookies(response);
  response.status(204).end();
  }
);
