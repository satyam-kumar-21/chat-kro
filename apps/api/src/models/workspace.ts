import { randomBytes } from "node:crypto";
import { Schema, model } from "mongoose";
import { baseSchemaOptions, objectId, optionalText, sanitizePlainText } from "./common.js";

export interface WorkspaceRecord {
  name: string;
  slug: string;
  ownerUserId: import("mongoose").Types.ObjectId;
  plan: "free" | "starter" | "pro" | "business";
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  settings?: {
    timezone?: string;
    defaultLanguage?: string;
    dataRetentionDays?: number;
  };
}

export interface WorkspaceMemberRecord {
  workspaceId: import("mongoose").Types.ObjectId;
  userId: import("mongoose").Types.ObjectId;
  role: "owner" | "admin" | "supervisor" | "agent";
  status: "invited" | "active" | "suspended";
  invitedAt: Date | null;
  joinedAt: Date | null;
}

const workspaceSettingsSchema = new Schema(
  {
    timezone: { type: String, trim: true, maxlength: 100, default: "UTC" },
    defaultLanguage: { type: String, trim: true, maxlength: 16, default: "en" },
    dataRetentionDays: { type: Number, min: 30, max: 3650, default: 365 }
  },
  { _id: false, strict: "throw" }
);

const workspaceSchema = new Schema<WorkspaceRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
      set: sanitizePlainText
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      maxlength: 80
    },
    ownerUserId: { ...objectId, ref: "User", required: true },
    plan: { type: String, enum: ["free", "starter", "pro", "business"], default: "free" },
    subscriptionStatus: {
      type: String,
      enum: ["trialing", "active", "past_due", "canceled", "incomplete"],
      default: "trialing"
    },
    settings: { type: workspaceSettingsSchema, default: () => ({}) }
  } as const,
  baseSchemaOptions
);
workspaceSchema.index({ slug: 1 }, { unique: true, name: "workspace_slug_unique" });
workspaceSchema.index({ ownerUserId: 1, createdAt: -1 }, { name: "workspace_owner_lookup" });

const workspaceMemberSchema = new Schema<WorkspaceMemberRecord>(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    userId: { ...objectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "admin", "supervisor", "agent"], required: true },
    status: { type: String, enum: ["invited", "active", "suspended"], default: "invited" },
    invitedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: null }
  } as const,
  baseSchemaOptions
);
workspaceMemberSchema.index(
  { workspaceId: 1, userId: 1 },
  { unique: true, name: "workspace_member_unique" }
);
workspaceMemberSchema.index(
  { userId: 1, status: 1, workspaceId: 1 },
  { name: "workspace_member_user_lookup" }
);

const widgetSettingsSchema = new Schema(
  {
    accentColor: {
      type: String,
      match: /^#[\da-fA-F]{6}$/,
      default: "#2564E5"
    },
    welcomeMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "How can we help?",
      set: sanitizePlainText
    },
    position: { type: String, enum: ["bottom-right", "bottom-left"], default: "bottom-right" },
    title: { type: String, trim: true, maxlength: 80, default: "Chat with us", set: sanitizePlainText },
    subtitle: { type: String, trim: true, maxlength: 120, default: "We usually reply shortly", set: sanitizePlainText },
    launcherLabel: { type: String, trim: true, maxlength: 40, default: "Open chat", set: sanitizePlainText },
    launcherIcon: { type: String, enum: ["chat", "message"], default: "chat" },
    logoUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: null,
      validate: (value: string | null) => {
        if (!value) return true;
        try {
          return ["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }
    },
    theme: { type: String, enum: ["light", "dark"], default: "light" },
    onlineText: { type: String, trim: true, maxlength: 80, default: "We are online", set: sanitizePlainText },
    offlineText: { type: String, trim: true, maxlength: 80, default: "Leave us a message", set: sanitizePlainText },
    greeting: { type: String, trim: true, maxlength: 500, default: "Hi there! How can we help?", set: sanitizePlainText },
    collectName: { type: Boolean, default: false },
    collectEmail: { type: Boolean, default: false },
    offlineContactForm: { type: Boolean, default: false },
    availabilityTimezone: { type: String, trim: true, maxlength: 100, default: "UTC" },
    availabilitySchedule: {
      type: [new Schema({
        day: { type: Number, min: 0, max: 6, required: true },
        start: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
        end: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true }
      }, { _id: false, strict: "throw" })],
      default: []
    }
  },
  { _id: false, strict: "throw" }
);

const websiteSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
      set: sanitizePlainText
    },
    domain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 253,
      validate: (value: string) => {
        try {
          return new URL(`http://${value}`).host === value;
        } catch {
          return false;
        }
      }
    },
    allowedOrigins: {
      type: [{ type: String, trim: true, maxlength: 2048 }],
      default: [],
      validate: {
        validator: (origins: string[]) =>
          origins.length <= 50 &&
          origins.every((origin) => {
            try {
              const parsed = new URL(origin);
              return (
                (parsed.protocol === "https:" || parsed.protocol === "http:") &&
                parsed.origin === origin
              );
            } catch {
              return false;
            }
          }),
        message: "Allowed origins must be exact http(s) origins"
      }
    },
    publicWidgetId: {
      type: String,
      required: true,
      default: () => randomBytes(24).toString("base64url"),
      match: /^[A-Za-z0-9_-]{32}$/
    },
    widgetSettings: { type: widgetSettingsSchema, default: () => ({}) },
    status: { type: String, enum: ["active", "disabled"], default: "active" }
  } as const,
  baseSchemaOptions
);
websiteSchema.index(
  { publicWidgetId: 1 },
  { unique: true, name: "website_public_widget_id_unique" }
);
websiteSchema.index({ workspaceId: 1, createdAt: -1 }, { name: "website_workspace_lookup" });
websiteSchema.pre("validate", function () {
  if (this.isNew) this.publicWidgetId = randomBytes(24).toString("base64url");
});

export const Workspace = model<WorkspaceRecord>("Workspace", workspaceSchema);
export const WorkspaceMember = model<WorkspaceMemberRecord>("WorkspaceMember", workspaceMemberSchema);
export const Website = model("Website", websiteSchema);
