import { Schema, model } from "mongoose";
import { baseSchemaOptions, objectId, optionalText, sanitizePlainText } from "./common.js";

export interface ConversationRecord {
  workspaceId: import("mongoose").Types.ObjectId;
  websiteId: import("mongoose").Types.ObjectId;
  visitorId: import("mongoose").Types.ObjectId;
  assignedAgentId: import("mongoose").Types.ObjectId | null;
  status: "open" | "pending" | "resolved";
  priority: "low" | "normal" | "high" | "urgent";
  subject: string | null;
  tags: string[];
  lastMessageAt: Date;
  lastMessagePreview: string;
  visitorUnreadCount: number;
  agentUnreadCount: number;
  closedAt: Date | null;
}

const conversationSchema = new Schema<ConversationRecord>(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    websiteId: { ...objectId, ref: "Website", required: true },
    visitorId: { ...objectId, ref: "Visitor", required: true },
    assignedAgentId: { ...objectId, ref: "User", default: null },
    status: { type: String, enum: ["open", "pending", "resolved"], default: "open" },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    subject: { ...optionalText(200), default: null, set: sanitizePlainText },
    tags: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      default: [],
      validate: (tags: string[]) => tags.length <= 20
    },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { ...optionalText(240), default: "" },
    visitorUnreadCount: { type: Number, min: 0, default: 0 },
    agentUnreadCount: { type: Number, min: 0, default: 0 },
    closedAt: { type: Date, default: null }
  } as const,
  baseSchemaOptions
);
conversationSchema.index(
  { workspaceId: 1, status: 1, lastMessageAt: -1, _id: -1 },
  { name: "conversation_workspace_status_activity" }
);
conversationSchema.index(
  { workspaceId: 1, assignedAgentId: 1, status: 1, lastMessageAt: -1 },
  { name: "conversation_agent_inbox" }
);
conversationSchema.index(
  { workspaceId: 1, status: 1, agentUnreadCount: 1, lastMessageAt: -1 },
  { name: "conversation_agent_unread" }
);
conversationSchema.index(
  { workspaceId: 1, status: 1, visitorUnreadCount: 1, lastMessageAt: -1 },
  { name: "conversation_visitor_unread" }
);
conversationSchema.index({ websiteId: 1, lastMessageAt: -1 }, { name: "conversation_website_activity" });

const messageSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    conversationId: { ...objectId, ref: "Conversation", required: true },
    senderType: { type: String, enum: ["visitor", "agent", "system"], required: true },
    senderId: { ...objectId, default: null },
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 10000,
      set: sanitizePlainText
    },
    contentType: { type: String, enum: ["text"], default: "text" },
    attachments: {
      type: [
        new Schema(
          {
            storageKey: { type: String, required: true, maxlength: 512 },
            fileName: { type: String, required: true, trim: true, maxlength: 255 },
            mimeType: { type: String, required: true, maxlength: 120 },
            sizeBytes: { type: Number, required: true, min: 1, max: 25_000_000 }
          },
          { _id: false, strict: "throw" }
        )
      ],
      default: [],
      validate: (attachments: unknown[]) => attachments.length <= 10
    },
    clientMessageId: { type: String, trim: true, maxlength: 128, default: undefined },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    metadata: {
      type: new Schema(
        {
          source: { type: String, enum: ["dashboard", "widget", "system"] },
          safe: { type: Boolean, default: true }
        },
        { _id: false, strict: "throw" }
      ),
      default: () => ({ safe: true })
    }
  } as const,
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } }
);
messageSchema.index(
  { conversationId: 1, createdAt: -1, _id: -1 },
  { name: "message_conversation_timeline" }
);
messageSchema.index(
  { conversationId: 1, clientMessageId: 1 },
  {
    unique: true,
    name: "message_client_id_unique_per_conversation",
    partialFilterExpression: { clientMessageId: { $type: "string" } }
  }
);

export const Conversation = model<ConversationRecord>("Conversation", conversationSchema);
export const Message = model("Message", messageSchema);
