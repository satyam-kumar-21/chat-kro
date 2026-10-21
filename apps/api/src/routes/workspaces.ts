import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import {
  actorFromRequest,
  requireAuthentication
} from "../middleware/authenticate.js";
import { requireCsrfToken } from "../middleware/csrf.js";
import { Visitor } from "../models/index.js";
import { Notification } from "../models/index.js";
import { listMembers } from "../services/member-service.js";
import { listConversations, updateConversation } from "../services/conversation-service.js";
import { listCannedReplies } from "../services/canned-reply-service.js";
import { createAgentMessage, listMessages, markConversationRead } from "../services/message-service.js";
import { emitToConversation } from "../socket/realtime.js";
import {
  createWebsite,
  getWebsite,
  listWebsites,
  updateWebsite
} from "../services/website-service.js";
import { getWorkspace, createWorkspace, listWorkspaces } from "../services/workspace-service.js";
import { requireWorkspaceMember } from "../services/tenant-authorization.js";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuthentication);

function routeParam(request: import("express").Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw new AppError("Invalid route parameter", 400, "VALIDATION_ERROR");
  return value;
}

workspacesRouter.get("/", async (request, response) => {
  const memberships = await listWorkspaces(actorFromRequest(request));
  response.json({
    workspaces: memberships.map((membership) => ({
      workspace: membership.workspaceId && typeof membership.workspaceId === "object" && "_id" in membership.workspaceId
        ? {
            id: membership.workspaceId._id.toString(),
            name: "name" in membership.workspaceId ? membership.workspaceId.name : "",
            slug: "slug" in membership.workspaceId ? membership.workspaceId.slug : ""
          }
        : null,
      role: membership.role
    }))
  });
});

workspacesRouter.post("/", requireCsrfToken, async (request, response) => {
  const workspace = await createWorkspace(actorFromRequest(request), request.body);
  response.status(201).json({
    workspace: {
      id: workspace._id.toString(),
      name: workspace.name,
      slug: workspace.slug,
      role: "owner"
    }
  });
});

workspacesRouter.get("/:workspaceId", async (request, response) => {
  response.json({
    workspace: await getWorkspace(actorFromRequest(request), routeParam(request, "workspaceId"))
  });
});

workspacesRouter.get("/:workspaceId/websites", async (request, response) => {
  const websites = await listWebsites(actorFromRequest(request), routeParam(request, "workspaceId"));
  response.json({
    websites: websites.map((website) => ({
      id: website._id.toString(),
      name: website.name,
      domain: website.domain,
      publicWidgetId: website.publicWidgetId,
      allowedOrigins: website.allowedOrigins,
      widgetSettings: website.widgetSettings,
      status: website.status
    }))
  });
});

workspacesRouter.get("/:workspaceId/websites/:websiteId", async (request, response) => {
  const website = await getWebsite(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    routeParam(request, "websiteId")
  );
  response.json({
    website: {
      id: website._id.toString(),
      name: website.name,
      domain: website.domain,
      publicWidgetId: website.publicWidgetId,
      allowedOrigins: website.allowedOrigins,
      widgetSettings: website.widgetSettings,
      status: website.status,
      createdAt: website.createdAt
    }
  });
});

workspacesRouter.post("/:workspaceId/websites", requireCsrfToken, async (request, response) => {
  const website = await createWebsite(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    request.body
  );
  response.status(201).json({
    website: {
      id: website._id.toString(),
      name: website.name,
      domain: website.domain,
      publicWidgetId: website.publicWidgetId,
      allowedOrigins: website.allowedOrigins,
      widgetSettings: website.widgetSettings,
      status: website.status
    }
  });
});

workspacesRouter.patch(
  "/:workspaceId/websites/:websiteId",
  requireCsrfToken,
  async (request, response) => {
    const website = await updateWebsite(
      actorFromRequest(request),
      routeParam(request, "workspaceId"),
      routeParam(request, "websiteId"),
      request.body
    );
    response.json({ website });
  }
);

workspacesRouter.get("/:workspaceId/members", async (request, response) => {
  const members = await listMembers(actorFromRequest(request), routeParam(request, "workspaceId"));
  response.json({
    members: members.map((member) => ({
      id: member._id.toString(),
      role: member.role,
      status: member.status,
      name: member.userId && typeof member.userId === "object" && "name" in member.userId
        ? member.userId.name
        : "",
      email: member.userId && typeof member.userId === "object" && "email" in member.userId
        ? member.userId.email
        : ""
    }))
  });
});

workspacesRouter.get("/:workspaceId/conversations", async (request, response) => {
  const conversations = await listConversations(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    request.query
  );
  response.json({
    conversations: conversations.map((conversation) => ({
      id: conversation._id.toString(),
      status: conversation.status,
      priority: conversation.priority,
      subject: conversation.subject,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      visitorUnreadCount: conversation.visitorUnreadCount,
      agentUnreadCount: conversation.agentUnreadCount
    }))
  });
});

workspacesRouter.patch("/:workspaceId/conversations/:conversationId", requireCsrfToken, async (request, response) => {
  const conversationId = routeParam(request, "conversationId");
  const conversation = await updateConversation(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    conversationId,
    request.body
  );
  if (conversation.status === "resolved") {
    emitToConversation(conversationId, "conversation:resolved", { status: "resolved" });
  }
  response.json({
    conversation: {
      id: conversation._id.toString(),
      status: conversation.status,
      priority: conversation.priority
    }
  });
});

workspacesRouter.get("/:workspaceId/conversations/:conversationId/messages", async (request, response) => {
  const before = typeof request.query.before === "string" ? request.query.before : undefined;
  const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
  const messages = await listMessages(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    routeParam(request, "conversationId"),
    before,
    limit
  );
  response.json({
    messages: messages.reverse().map((message) => ({
      id: message._id.toString(),
      senderType: message.senderType,
      senderId: message.senderId?.toString() ?? null,
      body: message.body,
      createdAt: message.createdAt,
      ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
      status: "sent" as const
    }))
  });
});

workspacesRouter.post("/:workspaceId/conversations/:conversationId/messages", requireCsrfToken, async (request, response) => {
  const conversationId = routeParam(request, "conversationId");
  const message = await createAgentMessage(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    conversationId,
    request.body
  );
  const result = {
    id: message._id.toString(),
    senderType: message.senderType,
    body: message.body,
    createdAt: message.createdAt,
    ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
    status: "sent" as const
  };
  emitToConversation(conversationId, "conversation:message", result);
  response.status(201).json({ message: result });
});

workspacesRouter.post("/:workspaceId/conversations/:conversationId/read", requireCsrfToken, async (request, response) => {
  const conversationId = routeParam(request, "conversationId");
  await markConversationRead(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    conversationId
  );
  emitToConversation(conversationId, "conversation:read", { readerType: "agent" });
  response.status(204).end();
});

workspacesRouter.get("/:workspaceId/contacts", async (request, response) => {
  const actor = actorFromRequest(request);
  const scope = await requireWorkspaceMember(actor, routeParam(request, "workspaceId"));
  const pageSchema = z.object({
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  }).strict();
  const parsed = pageSchema.safeParse(request.query);
  if (!parsed.success) throw new AppError("Invalid contact query", 400, "VALIDATION_ERROR");
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
  if (parsed.data.before) filter.lastSeenAt = { $lt: new Date(parsed.data.before) };
  const contacts = await Visitor.find(filter).sort({ lastSeenAt: -1, _id: -1 })
    .limit(parsed.data.limit).lean();
  response.json({
    contacts: contacts.map(({ _id, workspaceId: _workspaceId, websiteId: _websiteId, visitorId: _visitorId, ...safe }) => ({
      id: _id.toString(),
      ...safe
    }))
  });
});

workspacesRouter.get("/:workspaceId/canned-replies", async (request, response) => {
  const replies = await listCannedReplies(actorFromRequest(request), routeParam(request, "workspaceId"));
  response.json({
    replies: replies.map((reply) => ({
      id: reply._id.toString(),
      title: reply.title,
      shortcut: reply.shortcut,
      body: reply.body,
      updatedAt: reply.updatedAt
    }))
  });
});

workspacesRouter.get("/:workspaceId/notifications", async (request, response) => {
  const scope = await requireWorkspaceMember(
    actorFromRequest(request),
    routeParam(request, "workspaceId")
  );
  const notifications = await Notification.find({
    workspaceId: scope.workspaceId,
    userId: scope.userId
  }).sort({ createdAt: -1 }).limit(25).lean();
  response.json({
    notifications: notifications.map((item) => ({
      id: item._id.toString(),
      type: item.type,
      payload: item.payload,
      readAt: item.readAt,
      createdAt: item.createdAt
    }))
  });
});

workspacesRouter.get("/:workspaceId/onboarding", async (request, response) => {
  const actor = actorFromRequest(request);
  const workspaceId = routeParam(request, "workspaceId");
  const workspace = await getWorkspace(actor, workspaceId);
  const websites = await listWebsites(actor, workspaceId);
  response.json({
    workspace: { id: workspace._id.toString(), name: workspace.name },
    completed: websites.length > 0,
    websites: websites.map((website) => ({
      id: website._id.toString(),
      name: website.name,
      domain: website.domain,
      publicWidgetId: website.publicWidgetId
    }))
  });
});
