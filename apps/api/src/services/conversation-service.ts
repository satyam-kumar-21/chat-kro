import { conversationStatusSchema, objectIdSchema } from "@live-chat/shared";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { Conversation, Visitor, WorkspaceMember } from "../models/index.js";
import { parseObjectId, requireConversation, requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";
import { writeAuditLog } from "./audit.js";

const listSchema = z.object({
  status: conversationStatusSchema.optional(),
  assignedAgentId: objectIdSchema.optional(),
  assignment: z.enum(["mine", "unassigned"]).optional(),
  unread: z.coerce.boolean().optional(),
  search: z.string().trim().max(100).optional(),
  visitorId: objectIdSchema.optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export async function listConversations(
  actor: TenantActor,
  workspaceId: string,
  query: unknown = {}
) {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  const parsed = listSchema.safeParse(query);
  if (!parsed.success) throw new AppError("Invalid conversation query", 400, "VALIDATION_ERROR");
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
  if (parsed.data.status) filter.status = parsed.data.status;
  if (scope.membership.role === "agent") {
    if (parsed.data.assignedAgentId && parsed.data.assignedAgentId !== scope.userId.toString()) {
      throw new AppError("Workspace resource not found", 404, "NOT_FOUND");
    }
    if (parsed.data.assignment === "mine") filter.assignedAgentId = scope.userId;
    else if (parsed.data.assignment === "unassigned") filter.assignedAgentId = null;
    else filter.assignedAgentId = { $in: [null, scope.userId] };
  } else if (parsed.data.assignedAgentId) {
    filter.assignedAgentId = parseObjectId(parsed.data.assignedAgentId, "agent id");
  }
  if (scope.membership.role !== "agent" && parsed.data.assignment === "mine") {
    filter.assignedAgentId = scope.userId;
  } else if (scope.membership.role !== "agent" && parsed.data.assignment === "unassigned") {
    filter.assignedAgentId = null;
  }
  if (parsed.data.unread) filter.agentUnreadCount = { $gt: 0 };
  if (parsed.data.visitorId) filter.visitorId = parseObjectId(parsed.data.visitorId, "visitor id");
  if (parsed.data.search) {
    const escapedSearch = parsed.data.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escapedSearch, "i");
    const matchingVisitors = await Visitor.find({
      workspaceId: scope.workspaceId,
      $or: [{ displayName: expression }, { email: expression }]
    }).distinct("_id");
    filter.$or = [
      { subject: expression },
      { lastMessagePreview: expression },
      { visitorId: { $in: matchingVisitors } }
    ];
  }
  if (parsed.data.before) filter.lastMessageAt = { $lt: new Date(parsed.data.before) };
  return Conversation.find(filter)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(parsed.data.limit)
    .lean();
}

export async function getConversation(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string
) {
  const { conversation } = await requireConversation(actor, workspaceId, conversationId);
  return conversation;
}

export async function updateConversation(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string,
  input: unknown
) {
  const scope = await requireConversation(actor, workspaceId, conversationId);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppError("Invalid conversation update", 400, "VALIDATION_ERROR");
  }
  const data = input as Record<string, unknown>;
  const allowed = ["status", "priority", "subject", "tags"];
  if (Object.keys(data).some((key) => !allowed.includes(key))) {
    throw new AppError("Unsupported conversation field", 400, "VALIDATION_ERROR");
  }

  const update: Record<string, unknown> = {};
  if ("status" in data) {
    const parsed = conversationStatusSchema.safeParse(data.status);
    if (!parsed.success) throw new AppError("Invalid status", 400, "VALIDATION_ERROR");
    update.status = parsed.data;
    update.closedAt = parsed.data === "resolved" ? new Date() : null;
  }
  if ("priority" in data) {
    if (!["low", "normal", "high", "urgent"].includes(String(data.priority))) {
      throw new AppError("Invalid priority", 400, "VALIDATION_ERROR");
    }
    update.priority = data.priority;
  }
  if ("subject" in data) {
    if (data.subject !== null && (typeof data.subject !== "string" || data.subject.length > 200)) {
      throw new AppError("Invalid subject", 400, "VALIDATION_ERROR");
    }
    update.subject = data.subject;
  }
  if ("tags" in data) {
    if (!Array.isArray(data.tags) || data.tags.length > 20 || data.tags.some((tag) => typeof tag !== "string" || tag.length > 40)) {
      throw new AppError("Invalid tags", 400, "VALIDATION_ERROR");
    }
    update.tags = [...new Set(data.tags.map((tag: string) => tag.trim()).filter(Boolean))];
  }

  const conversation = await Conversation.findOneAndUpdate(
    { _id: scope.conversation._id, workspaceId: scope.workspaceId },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!conversation) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "conversation.updated",
    resourceType: "conversation",
    resourceId: conversation._id,
    changedFields: Object.keys(update)
  });
  return conversation;
}

export async function assignConversation(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string,
  assignedAgentId: string | null
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin", "supervisor"]);
  const conversationObjectId = parseObjectId(conversationId, "conversation id");
  let agentObjectId = null;
  if (assignedAgentId !== null) {
    agentObjectId = parseObjectId(assignedAgentId, "agent id");
    const agent = await WorkspaceMember.findOne({
      workspaceId: scope.workspaceId,
      userId: agentObjectId,
      status: "active",
      role: { $in: ["agent", "supervisor"] }
    }).select("_id");
    if (!agent) throw new AppError("Workspace agent not found", 404, "NOT_FOUND");
  }
  const conversation = await Conversation.findOneAndUpdate(
    { _id: conversationObjectId, workspaceId: scope.workspaceId },
    { $set: { assignedAgentId: agentObjectId } },
    { new: true, runValidators: true }
  );
  if (!conversation) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "conversation.assigned",
    resourceType: "conversation",
    resourceId: conversation._id,
    changedFields: ["assignedAgentId"]
  });
  return conversation;
}
