import { registrationSchema } from "@live-chat/shared";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import {
  EmailVerificationToken,
  PasswordResetToken,
  Session,
  User
} from "../models/index.js";
import { hashPassword, verifyPassword } from "../security/passwords.js";
import { createOpaqueToken, hashOpaqueToken } from "./token-service.js";

export async function registerUser(input: unknown) {
  const parsed = registrationSchema.extend({
    acceptedTerms: z.literal(true)
  }).safeParse(input);
  if (!parsed.success) throw new AppError("Invalid registration details", 400, "VALIDATION_ERROR");
  const acceptedAt = new Date();
  const user = await User.create({
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
    accountStatus: "pending",
    termsAcceptedAt: acceptedAt,
    privacyAcceptedAt: acceptedAt
  });
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    accountStatus: user.accountStatus,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt
  };
}

export async function verifyUserPassword(email: string, password: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase() })
    .select("+passwordHash")
    .lean();
  if (!user || user.accountStatus !== "active") return null;
  if (!(await verifyPassword(user.passwordHash, password))) return null;
  const safeUser = await User.findByIdAndUpdate(
    user._id,
    { $set: { lastLoginAt: new Date() } },
    { new: true }
  );
  return safeUser?.toJSON() ?? null;
}

export async function createRefreshSession(input: {
  userId: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}) {
  const { token, tokenHash } = createOpaqueToken();
  const session = await Session.create({
    userId: input.userId,
    refreshTokenHash: tokenHash,
    expiresAt: input.expiresAt,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress
  });
  return {
    session: { id: session._id.toString(), userId: session.userId.toString(), expiresAt: session.expiresAt },
    refreshToken: token
  };
}

export async function rotateRefreshSession(refreshToken: string, expiresAt: Date) {
  const oldHash = hashOpaqueToken(refreshToken);
  const replacement = createOpaqueToken();
  const session = await Session.findOneAndUpdate(
    { refreshTokenHash: oldHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    {
      $addToSet: { previousRefreshTokenHashes: oldHash },
      $set: {
        previousRefreshTokenHash: oldHash,
        refreshTokenHash: replacement.tokenHash,
        expiresAt
      }
    },
    { new: true, runValidators: true }
  );
  if (!session) {
    const reused = await Session.findOne({
      $or: [
        { previousRefreshTokenHash: oldHash },
        { previousRefreshTokenHashes: oldHash }
      ]
    }).select("_id");
    if (reused) {
      await Session.updateOne(
        { _id: reused._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    return null;
  }
  return {
    session: { id: session._id.toString(), userId: session.userId.toString(), expiresAt: session.expiresAt },
    refreshToken: replacement.token
  };
}

export async function revokeRefreshSession(refreshToken: string): Promise<void> {
  await Session.updateOne(
    { refreshTokenHash: hashOpaqueToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function findSessionByToken(token: string) {
  return Session.findOne({
    refreshTokenHash: hashOpaqueToken(token),
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  });
}

export async function createPasswordResetToken(email: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase(), accountStatus: "active" })
    .select("_id");
  if (!user) return null;
  const { token, tokenHash } = createOpaqueToken();
  await PasswordResetToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });
  return { userId: user._id.toString(), token };
}

export async function resetPasswordWithToken(token: string, password: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  const resetToken = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: hashOpaqueToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
  if (!resetToken) return false;
  const userUpdate = await User.updateOne(
    { _id: resetToken.userId, accountStatus: "active" },
    { $set: { passwordHash } }
  );
  if (!userUpdate.matchedCount) return false;
  await Session.updateMany(
    { userId: resetToken.userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return true;
}

export async function createEmailVerificationToken(userId: string) {
  const { token, tokenHash } = createOpaqueToken();
  await EmailVerificationToken.create({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  return token;
}

export async function verifyEmailWithToken(token: string): Promise<boolean> {
  const verification = await EmailVerificationToken.findOneAndUpdate(
    { tokenHash: hashOpaqueToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
  if (!verification) return false;
  const userUpdate = await User.updateOne(
    { _id: verification.userId, accountStatus: "pending" },
    { $set: { accountStatus: "active", emailVerifiedAt: new Date() } }
  );
  return userUpdate.matchedCount > 0;
}
