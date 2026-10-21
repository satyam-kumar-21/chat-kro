import { Schema, model } from "mongoose";
import { baseSchemaOptions, objectId, optionalText, sanitizePlainText } from "./common.js";

const cannedReplySchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    shortcut: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_-]+$/,
      maxlength: 50
    },
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 10000,
      set: sanitizePlainText
    },
    createdBy: { ...objectId, ref: "User", required: true }
  } as const,
  baseSchemaOptions
);
cannedReplySchema.index(
  { workspaceId: 1, shortcut: 1 },
  { unique: true, name: "canned_reply_workspace_shortcut_unique" }
);

const internalNoteSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    conversationId: { ...objectId, ref: "Conversation", required: true },
    authorUserId: { ...objectId, ref: "User", required: true },
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 5000,
      set: sanitizePlainText
    }
  } as const,
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } }
);
internalNoteSchema.index(
  { workspaceId: 1, conversationId: 1, createdAt: 1 },
  { name: "internal_note_conversation_timeline" }
);

const invitationSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    role: { type: String, enum: ["admin", "supervisor", "agent"], required: true },
    tokenHash: { type: String, required: true, select: false, unique: true, match: /^[\da-f]{64}$/ },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    invitedBy: { ...objectId, ref: "User", required: true }
  } as const,
  baseSchemaOptions
);
invitationSchema.set("toJSON", {
  transform: (_document, result) => {
    Reflect.deleteProperty(result, "tokenHash");
    return result;
  }
});
invitationSchema.index(
  { workspaceId: 1, email: 1, acceptedAt: 1 },
  { name: "invitation_pending_lookup" }
);
invitationSchema.index(
  { workspaceId: 1, email: 1 },
  {
    unique: true,
    name: "invitation_workspace_email_pending_unique",
    partialFilterExpression: { acceptedAt: null }
  }
);
invitationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "invitation_expiry_ttl" }
);

const notificationSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    userId: { ...objectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["conversation_assigned", "new_message", "mention", "system"],
      required: true
    },
    payload: {
      type: new Schema(
        {
          conversationId: { ...objectId, ref: "Conversation" },
          message: { type: String, trim: true, maxlength: 240, set: sanitizePlainText }
        },
        { _id: false, strict: "throw" }
      ),
      default: () => ({})
    },
    readAt: { type: Date, default: null }
  } as const,
  baseSchemaOptions
);
notificationSchema.index(
  { workspaceId: 1, userId: 1, readAt: 1, createdAt: -1 },
  { name: "notification_user_unread" }
);

const auditMetadataSchema = new Schema(
  {
    source: { type: String, enum: ["dashboard", "api", "system"], default: "api" },
    ipAddress: { ...optionalText(64), default: null },
    changedFields: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: (fields: string[]) => fields.length <= 50
    },
    reason: { ...optionalText(240), default: null }
  },
  { _id: false, strict: "throw" }
);

const auditLogSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    actorUserId: { ...objectId, ref: "User", default: null },
    action: { type: String, required: true, trim: true, maxlength: 100 },
    resourceType: { type: String, required: true, trim: true, maxlength: 80 },
    resourceId: { ...objectId, default: null },
    safeMetadata: { type: auditMetadataSchema, default: () => ({}) }
  } as const,
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } }
);
auditLogSchema.index(
  { workspaceId: 1, createdAt: -1 },
  { name: "audit_workspace_timeline" }
);
auditLogSchema.index(
  { workspaceId: 1, resourceType: 1, resourceId: 1, createdAt: -1 },
  { name: "audit_resource_timeline" }
);

const subscriptionUsageSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    websites: { type: Number, min: 0, default: 0 },
    members: { type: Number, min: 0, default: 1 },
    monthlyConversations: { type: Number, min: 0, default: 0 },
    monthlyMessages: { type: Number, min: 0, default: 0 },
    fileStorageBytes: { type: Number, min: 0, default: 0 },
    periodStart: { type: Date, required: true, default: () => new Date() }
  } as const,
  baseSchemaOptions
);
subscriptionUsageSchema.index(
  { workspaceId: 1 },
  { unique: true, name: "subscription_usage_workspace_unique" }
);

const idempotencyRecordSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    key: { type: String, required: true, trim: true, maxlength: 128 },
    responseStatus: { type: Number, min: 100, max: 599, required: true },
    resourceId: { ...objectId, default: null },
    expiresAt: { type: Date, required: true }
  } as const,
  baseSchemaOptions
);
idempotencyRecordSchema.index(
  { workspaceId: 1, key: 1 },
  { unique: true, name: "idempotency_workspace_key_unique" }
);
idempotencyRecordSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "idempotency_expiry_ttl" }
);

export const CannedReply = model("CannedReply", cannedReplySchema);
export const InternalNote = model("InternalNote", internalNoteSchema);
export const Invitation = model("Invitation", invitationSchema);
export const Notification = model("Notification", notificationSchema);
export const AuditLog = model("AuditLog", auditLogSchema);
export const SubscriptionUsage = model("SubscriptionUsage", subscriptionUsageSchema);
export const IdempotencyRecord = model("IdempotencyRecord", idempotencyRecordSchema);
