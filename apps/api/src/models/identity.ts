import { Schema, model } from "mongoose";
import { baseSchemaOptions, isHttpUrl, objectId, optionalText, sanitizePlainText } from "./common.js";

export interface UserRecord {
  name: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
  accountStatus: "active" | "pending" | "suspended" | "deleted";
  termsAcceptedAt?: Date;
  privacyAcceptedAt?: Date;
  lastLoginAt: Date | null;
  notificationPreferences: {
    sound: boolean;
    desktop: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
      set: sanitizePlainText
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    termsAcceptedAt: { type: Date, default: null },
    privacyAcceptedAt: { type: Date, default: null },
    avatarUrl: { ...optionalText(2048), default: null, validate: isHttpUrl },
    accountStatus: {
      type: String,
      enum: ["active", "pending", "suspended", "deleted"],
      default: "pending",
      required: true
    },
    lastLoginAt: { type: Date, default: null },
    notificationPreferences: {
      sound: { type: Boolean, default: false },
      desktop: { type: Boolean, default: false }
    }
  } as const,
  baseSchemaOptions
);
userSchema.set("toJSON", {
  transform: (_document, result) => {
    Reflect.deleteProperty(result, "passwordHash");
    return result;
  }
});
userSchema.index({ email: 1 }, { unique: true, name: "user_email_unique" });

const sessionSchema = new Schema(
  {
    userId: { ...objectId, ref: "User", required: true, index: true },
    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
      unique: true,
      match: /^[\da-f]{64}$/
    },
    previousRefreshTokenHash: {
      type: String,
      select: false,
      default: null,
      match: /^[\da-f]{64}$/
    },
    previousRefreshTokenHashes: {
      type: [String],
      select: false,
      default: [],
      validate: (hashes: string[]) => hashes.every((hash) => /^[\da-f]{64}$/.test(hash))
    },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { ...optionalText(512), default: null },
    ipAddress: { ...optionalText(64), default: null }
  } as const,
  baseSchemaOptions
);
sessionSchema.set("toJSON", {
  transform: (_document, result) => {
    Reflect.deleteProperty(result, "refreshTokenHash");
    return result;
  }
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "session_expiry_ttl" });

const passwordResetTokenSchema = new Schema(
  {
    userId: { ...objectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, select: false, unique: true, match: /^[\da-f]{64}$/ },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null }
  } as const,
  baseSchemaOptions
);
passwordResetTokenSchema.set("toJSON", {
  transform: (_document, result) => {
    Reflect.deleteProperty(result, "tokenHash");
    return result;
  }
});
passwordResetTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "password_reset_expiry_ttl" }
);

const emailVerificationTokenSchema = new Schema(
  {
    userId: { ...objectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, select: false, unique: true, match: /^[\da-f]{64}$/ },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null }
  } as const,
  baseSchemaOptions
);
emailVerificationTokenSchema.set("toJSON", {
  transform: (_document, result) => {
    Reflect.deleteProperty(result, "tokenHash");
    return result;
  }
});
emailVerificationTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "email_verification_expiry_ttl" }
);

export const User = model<UserRecord>("User", userSchema);
export const Session = model("Session", sessionSchema);
export const PasswordResetToken = model("PasswordResetToken", passwordResetTokenSchema);
export const EmailVerificationToken = model(
  "EmailVerificationToken",
  emailVerificationTokenSchema
);
