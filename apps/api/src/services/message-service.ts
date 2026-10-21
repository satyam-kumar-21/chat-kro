import sanitizeHtml from "sanitize-html";
import { messageInputSchema } from "@live-chat/shared";
import { AppError } from "../errors/app-error.js";
import { Conversation, Message } from "../models/index.js";
import { parseObjectId, requireConversation, type TenantActor } from "./tenant-authorization.js";
import { releaseWorkspaceUsage, reserveWorkspaceUsage } from "./usage-service.js";

export async function listMessages(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string,
  before?: string,
  limit = 50
) {
  const scope = await requireConversation(actor, workspaceId, conversationId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Invalid message page size", 400, "VALIDATION_ERROR");
  }
  const filter: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    conversationId: scope.conversation._id
  };
  if (before) {
    const date = new Date(before);
    if (Number.isNaN(date.getTime())) {
      throw new AppError("Invalid message cursor", 400, "VALIDATION_ERROR");
    }
    filter.createdAt = { $lt: date };
  }
  return Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
}

export async function createAgentMessage(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string,
  input: unknown
) {
  const scope = await requireConversation(actor, workspaceId, conversationId);
  return persistConversationMessage({
    workspaceId: scope.workspaceId,
    conversationId: scope.conversation._id,
    senderType: "agent",
    senderId: scope.userId,
    source: "dashboard",
    input
  });
}

export async function persistConversationMessage(input: {
  workspaceId: import("mongoose").Types.ObjectId;
  conversationId: import("mongoose").Types.ObjectId;
  senderType: "visitor" | "agent";
  senderId: import("mongoose").Types.ObjectId;
  source: "widget" | "dashboard";
  input: unknown;
}) {
  const parsed = messageInputSchema.safeParse(input.input);
  if (!parsed.success) throw new AppError("Invalid message", 400, "VALIDATION_ERROR");
  const body = sanitizeHtml(parsed.data.body, { allowedTags: [], allowedAttributes: {} }).trim();
  if (!body) throw new AppError("Message body is empty", 400, "VALIDATION_ERROR");

  const messageFilter = {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    clientMessageId: parsed.data.clientMessageId
  };
  const existing = await Message.findOne(messageFilter);
  if (existing) {
    if (
      existing.senderType !== input.senderType ||
      existing.senderId?.toString() !== input.senderId.toString() ||
      existing.body !== body
    ) {
      throw new AppError("This message id was already used", 409, "IDEMPOTENCY_KEY_REUSED");
    }
    return existing;
  }

  await reserveWorkspaceUsage(input.workspaceId.toString(), "monthlyMessages");
  let usageReserved = true;
  const messageDocument = {
    ...messageFilter,
    senderType: input.senderType,
    senderId: input.senderId,
    body,
    contentType: "text" as const,
    metadata: { source: input.source, safe: true }
  };
  let message;
  try {
    const session = await Message.startSession();
    try {
      await session.withTransaction(async () => {
        const [created] = await Message.create([messageDocument], { session });
        const result = await updateConversationAfterMessage(input, created, session);
        if (result.matchedCount !== 1) {
          throw new AppError("Conversation not found", 404, "NOT_FOUND");
        }
        message = created;
      });
      if (message) {
        usageReserved = false;
        return message;
      }
    } catch (error) {
      if (!isTransactionUnsupported(error)) throw error;
    } finally {
      await session.endSession();
    }

    message = await Message.create(messageDocument);
    await updateConversationAfterMessage(input, message);
    usageReserved = false;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      if (usageReserved) {
        await releaseWorkspaceUsage(input.workspaceId.toString(), "monthlyMessages");
        usageReserved = false;
      }
      const retryResult = await Message.findOne(messageFilter);
      if (
        retryResult &&
        retryResult.senderType === input.senderType &&
        retryResult.senderId?.toString() === input.senderId.toString() &&
        retryResult.body === body
      ) {
        return retryResult;
      }
      if (retryResult) {
        throw new AppError("This message id was already used", 409, "IDEMPOTENCY_KEY_REUSED");
      }
    }
    if (usageReserved) await releaseWorkspaceUsage(input.workspaceId.toString(), "monthlyMessages");
    throw error;
  }
  return message;
}

function isTransactionUnsupported(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { code?: unknown; codeName?: unknown; message?: unknown };
  return details.code === 20 ||
    (details.codeName === "IllegalOperation" &&
      typeof details.message === "string" &&
      details.message.includes("Transaction numbers are only allowed"));
}

async function updateConversationAfterMessage(
  input: {
    workspaceId: import("mongoose").Types.ObjectId;
    conversationId: import("mongoose").Types.ObjectId;
    senderType: "visitor" | "agent";
  },
  message: { createdAt: Date; body: string },
  session?: import("mongoose").ClientSession
) {
  const unreadField = input.senderType === "visitor" ? "agentUnreadCount" : "visitorUnreadCount";
  const setFields: Record<string, unknown> = {
    lastMessageAt: {
      $max: [{ $ifNull: ["$lastMessageAt", new Date(0)] }, message.createdAt]
    },
    lastMessagePreview: {
      $cond: [
        { $gte: [message.createdAt, { $ifNull: ["$lastMessageAt", new Date(0)] }] },
        message.body.slice(0, 240),
        "$lastMessagePreview"
      ]
    },
    [unreadField]: { $add: [{ $ifNull: [`$${unreadField}`, 0] }, 1] }
  };
  if (input.senderType === "visitor") setFields.status = "open";
  return Conversation.updateOne(
    { _id: input.conversationId, workspaceId: input.workspaceId },
    [{ $set: setFields }],
    session ? { session } : undefined
  );
}

export async function markConversationRead(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string
): Promise<void> {
  const scope = await requireConversation(actor, workspaceId, conversationId);
  await Conversation.updateOne(
    { _id: scope.conversation._id, workspaceId: scope.workspaceId },
    { $set: { agentUnreadCount: 0 } }
  );
}

export async function deleteAgentMessage(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string,
  messageId: string
): Promise<void> {
  const scope = await requireConversation(actor, workspaceId, conversationId);
  const message = await Message.findOneAndUpdate(
    {
      _id: parseObjectId(messageId, "message id"),
      workspaceId: scope.workspaceId,
      conversationId: scope.conversation._id,
      senderType: "agent",
      senderId: scope.userId
    },
    { $set: { deletedAt: new Date(), body: "This message was deleted" } },
    { new: true, runValidators: true }
  );
  if (!message) throw new AppError("Message not found", 404, "NOT_FOUND");
}

export function assertMessageId(value: string) {
  return parseObjectId(value, "message id");
}
