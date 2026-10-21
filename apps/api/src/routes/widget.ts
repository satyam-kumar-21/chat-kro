import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { Message } from "../models/index.js";
import { authorizeVisitorConversation, createVisitorMessage, initializeWidget, updateWidgetVisitorProfile, verifyVisitorSession } from "../services/widget-service.js";
import { emitToConversation, openVisitorConversation } from "../socket/realtime.js";

export const widgetRouter = Router();

function routeParam(request: import("express").Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw new AppError("Invalid route parameter", 400, "VALIDATION_ERROR");
  return value;
}

function visitorToken(request: import("express").Request): string {
  const authorization = request.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_.-]{40,2048})$/);
  if (!match?.[1]) throw new AppError("Visitor session is required", 401, "WIDGET_SESSION_REQUIRED");
  return match[1];
}

function safeMessage(message: {
  _id: { toString(): string };
  senderType: "visitor" | "agent" | "system";
  body: string;
  createdAt: Date;
  clientMessageId?: string | null;
}) {
  return {
    id: message._id.toString(),
    senderType: message.senderType,
    body: message.body,
    createdAt: message.createdAt,
    ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
    status: "sent" as const
  };
}

widgetRouter.post("/init", async (request, response) => {
  const initialized = await initializeWidget(request.body, request.get("origin"));
  response.json(initialized);
});

widgetRouter.post("/conversation", async (request, response) => {
  const visitor = await verifyVisitorSession(visitorToken(request), request.get("origin"));
  const conversation = await openVisitorConversation(visitor);
  response.json(conversation);
});

widgetRouter.post("/profile", async (request, response) => {
  const visitor = await verifyVisitorSession(visitorToken(request), request.get("origin"));
  response.json(await updateWidgetVisitorProfile(visitor, request.body));
});

widgetRouter.get("/:conversationId/messages", async (request, response) => {
  const visitor = await verifyVisitorSession(visitorToken(request), request.get("origin"));
  const conversation = await authorizeVisitorConversation(visitor, routeParam(request, "conversationId"));
  const before = z.string().datetime().optional().safeParse(request.query.before);
  if (!before.success) throw new AppError("Invalid message cursor", 400, "VALIDATION_ERROR");
  const filter: Record<string, unknown> = {
    workspaceId: visitor.workspace,
    conversationId: conversation._id,
    deletedAt: null
  };
  if (before.data) filter.createdAt = { $lt: new Date(before.data) };
  const messages = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100).lean();
  response.json({ messages: messages.reverse().map(safeMessage) });
});

widgetRouter.post("/:conversationId/messages", async (request, response) => {
  const visitor = await verifyVisitorSession(visitorToken(request), request.get("origin"));
  const conversationId = routeParam(request, "conversationId");
  const message = await createVisitorMessage(visitor, conversationId, request.body);
  emitToConversation(conversationId, "conversation:message", safeMessage(message));
  response.status(201).json({ message: safeMessage(message) });
});
