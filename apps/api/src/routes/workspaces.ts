import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import {
  actorFromRequest,
  requireAuthentication
} from "../middleware/authenticate.js";
import { requireCsrfToken } from "../middleware/csrf.js";
import { InternalNote, Website, Visitor } from "../models/index.js";
import { Notification } from "../models/index.js";
import { listMembers, setMemberStatus, updateMemberRole } from "../services/member-service.js";
import { listConversations, updateConversation } from "../services/conversation-service.js";
import { createCannedReply, deleteCannedReply, listCannedReplies, updateCannedReply } from "../services/canned-reply-service.js";
import { createAgentMessage, listMessages, markConversationRead } from "../services/message-service.js";
import { disconnectWorkspaceMember, emitToConversation } from "../socket/realtime.js";
import {
  createWebsite,
  getWebsite,
  listWebsites,
  updateWebsite,
  rotateWebsiteWidgetId
} from "../services/website-service.js";
import { getWorkspace, createWorkspace, listWorkspaces, updateWorkspaceSettings } from "../services/workspace-service.js";
import { requireConversation, requireWorkspaceMember } from "../services/tenant-authorization.js";
import { getWorkspaceAnalytics } from "../services/analytics-service.js";
import { createInvitation, invitationEmailContext, listInvitations, resendInvitation, revokeInvitation } from "../services/invitation-service.js";
import { sendActionEmail } from "../services/email-service.js";
import { env } from "../config/env.js";
import { getWorkspaceUsage, planLimits } from "../services/usage-service.js";

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

workspacesRouter.patch("/:workspaceId", requireCsrfToken, async (request, response) => {
  const workspace = await updateWorkspaceSettings(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    request.body
  );
  response.json({ workspace });
});

workspacesRouter.get("/:workspaceId/usage", async (request, response) => {
  await requireWorkspaceMember(actorFromRequest(request), routeParam(request, "workspaceId"), ["owner", "admin"]);
  response.json(await getWorkspaceUsage(actorFromRequest(request), routeParam(request, "workspaceId")));
});

workspacesRouter.get("/:workspaceId/analytics", async (request, response) => {
  response.json(await getWorkspaceAnalytics(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    request.query
  ));
});

workspacesRouter.get("/:workspaceId/plans", async (request, response) => {
  await requireWorkspaceMember(actorFromRequest(request), routeParam(request, "workspaceId"), ["owner", "admin"]);
  response.json({ plans: planLimits });
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

workspacesRouter.post("/:workspaceId/websites/:websiteId/rotate-widget-id", requireCsrfToken, async (request, response) => {
  const website = await rotateWebsiteWidgetId(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    routeParam(request, "websiteId")
  );
  response.json({
    website: { id: website._id.toString(), publicWidgetId: website.publicWidgetId },
    warning: "The previous widget ID is invalid immediately. Update the installation script on every site using this widget."
  });
});

workspacesRouter.get("/:workspaceId/members", async (request, response) => {
  const members = await listMembers(actorFromRequest(request), routeParam(request, "workspaceId"));
  response.json({
    members: members.map((member) => ({
      id: member._id.toString(),
      userId: member.userId && typeof member.userId === "object" && "_id" in member.userId
        ? member.userId._id.toString()
        : null,
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

workspacesRouter.patch("/:workspaceId/members/:memberId/role", requireCsrfToken, async (request, response) => {
  const workspaceId = routeParam(request, "workspaceId");
  const member = await updateMemberRole(
    actorFromRequest(request),
    workspaceId,
    routeParam(request, "memberId"),
    request.body?.role
  );
  await disconnectWorkspaceMember(workspaceId, member.userId.toString());
  response.json({ member: { id: member._id.toString(), role: member.role, status: member.status } });
});

workspacesRouter.patch("/:workspaceId/members/:memberId/status", requireCsrfToken, async (request, response) => {
  const parsed = z.object({ status: z.enum(["active", "suspended"]) }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError("Invalid member status", 400, "VALIDATION_ERROR");
  const workspaceId = routeParam(request, "workspaceId");
  const member = await setMemberStatus(
    actorFromRequest(request),
    workspaceId,
    routeParam(request, "memberId"),
    parsed.data.status
  );
  await disconnectWorkspaceMember(workspaceId, member.userId.toString());
  response.json({ member: { id: member._id.toString(), role: member.role, status: member.status } });
});

workspacesRouter.get("/:workspaceId/invitations", async (request, response) => {
  const invitations = await listInvitations(actorFromRequest(request), routeParam(request, "workspaceId"));
  response.json({
    invitations: invitations.map((item) => ({
      id: item._id.toString(),
      email: item.email,
      role: item.role,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt
    }))
  });
});

async function sendInvitationResponse(
  response: import("express").Response,
  result: Awaited<ReturnType<typeof createInvitation>>
) {
  const context = await invitationEmailContext(result.invitation.workspaceId, result.invitation.email);
  const url = new URL("/loginlive", env.WEB_ORIGIN);
  url.searchParams.set("invitationToken", result.token);
  const sent = await sendActionEmail({
    to: result.invitation.email,
    subject: `Join ${context.workspaceName} on Relay Chat`,
    actionUrl: url.toString(),
    actionLabel: "Accept workspace invitation"
  });
  if (!sent && env.NODE_ENV === "production") {
    throw new AppError("Invitation was created, but email delivery failed. Retry sending the invitation.", 503, "EMAIL_DELIVERY_FAILED");
  }
  response.status(201).json({
    invitation: result.invitation,
    message: sent ? "Invitation email sent." : "Invitation created.",
    ...(!sent && env.NODE_ENV !== "production" ? { developmentInvitationUrl: url.toString() } : {})
  });
}

workspacesRouter.post("/:workspaceId/invitations", requireCsrfToken, async (request, response) => {
  const result = await createInvitation(actorFromRequest(request), routeParam(request, "workspaceId"), request.body);
  await sendInvitationResponse(response, result);
});

workspacesRouter.post("/:workspaceId/invitations/:invitationId/resend", requireCsrfToken, async (request, response) => {
  const result = await resendInvitation(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    routeParam(request, "invitationId")
  );
  await sendInvitationResponse(response, result);
});

workspacesRouter.delete("/:workspaceId/invitations/:invitationId", requireCsrfToken, async (request, response) => {
  await revokeInvitation(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    routeParam(request, "invitationId")
  );
  response.status(204).end();
});

workspacesRouter.get("/:workspaceId/conversations", async (request, response) => {
  const workspaceId = routeParam(request, "workspaceId");
  const conversations = await listConversations(
    actorFromRequest(request),
    workspaceId,
    request.query
  );
  const visitorIds = [...new Set(conversations.map((conversation) => conversation.visitorId.toString()))];
  const websiteIds = [...new Set(conversations.map((conversation) => conversation.websiteId.toString()))];
  const [visitors, websites] = await Promise.all([
    Visitor.find({ _id: { $in: visitorIds }, workspaceId })
      .select("displayName email phone firstSeenAt lastSeenAt currentPageUrl referrer browser operatingSystem customAttributes")
      .lean(),
    Website.find({ _id: { $in: websiteIds }, workspaceId })
      .select("name domain")
      .lean()
  ]);
  const visitorById = new Map(visitors.map((visitor) => [visitor._id.toString(), visitor]));
  const websiteById = new Map(websites.map((website) => [website._id.toString(), website]));
  response.json({
    conversations: conversations.map((conversation) => ({
      id: conversation._id.toString(),
      visitorId: conversation.visitorId.toString(),
      assignedAgentId: conversation.assignedAgentId?.toString() ?? null,
      tags: conversation.tags,
      status: conversation.status,
      priority: conversation.priority,
      subject: conversation.subject,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      visitorUnreadCount: conversation.visitorUnreadCount,
      agentUnreadCount: conversation.agentUnreadCount,
      visitor: visitorById.get(conversation.visitorId.toString()) ?? null,
      website: websiteById.get(conversation.websiteId.toString()) ?? null
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

workspacesRouter.get("/:workspaceId/conversations/:conversationId/notes", async (request, response) => {
  const actor = actorFromRequest(request);
  const workspaceId = routeParam(request, "workspaceId");
  const conversationId = routeParam(request, "conversationId");
  const scope = await requireConversation(actor, workspaceId, conversationId);
  const notes = await InternalNote.find({
    workspaceId: scope.workspaceId,
    conversationId: scope.conversation._id
  }).sort({ createdAt: 1 }).limit(200).populate("authorUserId", "name").lean();
  response.json({
    notes: notes.map((note) => ({
      id: note._id.toString(),
      body: note.body,
      createdAt: note.createdAt,
      author: note.authorUserId && typeof note.authorUserId === "object" && "name" in note.authorUserId
        ? note.authorUserId.name
        : "Workspace member"
    }))
  });
});

workspacesRouter.post("/:workspaceId/conversations/:conversationId/notes", requireCsrfToken, async (request, response) => {
  const actor = actorFromRequest(request);
  const workspaceId = routeParam(request, "workspaceId");
  const conversationId = routeParam(request, "conversationId");
  const scope = await requireConversation(actor, workspaceId, conversationId);
  const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError("Invalid internal note", 400, "VALIDATION_ERROR");
  const note = await InternalNote.create({
    workspaceId: scope.workspaceId,
    conversationId: scope.conversation._id,
    authorUserId: scope.userId,
    body: parsed.data.body
  });
  response.status(201).json({
    note: {
      id: note._id.toString(),
      body: note.body,
      createdAt: note.createdAt,
      author: "You"
    }
  });
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

workspacesRouter.post("/:workspaceId/canned-replies", requireCsrfToken, async (request, response) => {
  const reply = await createCannedReply(actorFromRequest(request), routeParam(request, "workspaceId"), request.body);
  response.status(201).json({
    reply: { id: reply._id.toString(), title: reply.title, shortcut: reply.shortcut, body: reply.body }
  });
});

workspacesRouter.patch("/:workspaceId/canned-replies/:replyId", requireCsrfToken, async (request, response) => {
  const reply = await updateCannedReply(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    routeParam(request, "replyId"),
    request.body
  );
  response.json({
    reply: { id: reply._id.toString(), title: reply.title, shortcut: reply.shortcut, body: reply.body }
  });
});

workspacesRouter.delete("/:workspaceId/canned-replies/:replyId", requireCsrfToken, async (request, response) => {
  await deleteCannedReply(
    actorFromRequest(request),
    routeParam(request, "workspaceId"),
    routeParam(request, "replyId")
  );
  response.status(204).end();
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
