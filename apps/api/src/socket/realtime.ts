import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Types } from "mongoose";
import { Server, type Socket } from "socket.io";
import { createClient, type RedisClientType } from "redis";
import { z } from "zod";
import {
  agentConversationReadInputSchema,
  agentConversationScopeSchema,
  agentMessageInputSchema,
  agentTypingInputSchema,
  conversationAssignmentInputSchema,
  conversationJoinInputSchema,
  conversationUpdateInputSchema,
  emptySocketInputSchema,
  inboxJoinInputSchema,
  messageSocketInputSchema,
  socketErrorCodeSchema,
  socketMessageSchema,
  typingInputSchema,
  visitorProfileInputSchema,
  visitorSocketAuthSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketServerPayload,
  type SocketAck
} from "@live-chat/shared";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";
import {
  Conversation,
  Message,
  Notification,
  User,
  Visitor,
  Website,
  WorkspaceMember
} from "../models/index.js";
import { sessionCookieName } from "../security/cookies.js";
import { assignConversation, listConversations, updateConversation } from "../services/conversation-service.js";
import { createAgentMessage, markConversationRead } from "../services/message-service.js";
import { findSessionByToken } from "../services/identity-service.js";
import {
  authorizeVisitorConversation,
  createVisitorMessage,
  getOrCreateVisitorConversation,
  markVisitorConversationRead,
  updateWidgetVisitorProfile,
  verifyVisitorSession
} from "../services/widget-service.js";
import { requireConversation, requireWorkspaceMember, type TenantActor } from "../services/tenant-authorization.js";

type Ack<T = unknown> = (result: SocketAck<T>) => void;
type SocketRole = "visitor" | "agent";

const conversationRoom = (id: string) => `conversation:${id}`;
const workspaceInboxRoom = (id: string) => `workspace:${id}:inbox`;
const workspacePresenceRoom = (id: string) => `workspace:${id}:presence`;
const workspaceAgentsRoom = (id: string) => `workspace:${id}:agents`;
const workspaceAgentRoom = (workspaceId: string, userId: string) => `workspace:${workspaceId}:agent:${userId}`;

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

let ioServer: RealtimeServer | undefined;
let socketRedis: RedisClientType | undefined;
let socketRedisSubscriber: RedisClientType | undefined;

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const item of header?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    try {
      cookies.set(item.slice(0, separator).trim(), decodeURIComponent(item.slice(separator + 1).trim()));
    } catch {
      continue;
    }
  }
  return cookies;
}

function sendAckError(ack: Ack | undefined, error: unknown, socket?: RealtimeSocket) {
  if (error instanceof AppError) {
    const parsedCode = socketErrorCodeSchema.safeParse(error.code);
    const code = parsedCode.success ? parsedCode.data : "INTERNAL_ERROR";
    ack?.({ ok: false, error: { code, message: error.message } });
    socket?.emit("socket:error", { code, message: error.message });
    if (error.statusCode >= 500) {
      logger.error({ err: error, correlationId: socket?.data.correlationId }, "Socket event failed");
    }
    return;
  }
  ack?.({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "The request could not be completed." }
  });
  socket?.emit("socket:error", {
    code: "INTERNAL_ERROR",
    message: "The request could not be completed."
  });
  logger.error({ err: error, correlationId: socket?.data.correlationId }, "Socket event failed");
}

function actorKey(socket: RealtimeSocket): string {
  const actor = socket.data.actorType === "agent"
    ? socket.data.userId
    : socket.data.visitorId;
  return typeof actor === "string" ? `${socket.data.actorType}:${actor}` : `ip:${socket.handshake.address}`;
}

async function checkRate(
  socket: RealtimeSocket,
  category: string,
  limit: number,
  windowMs = 60_000
): Promise<boolean> {
  const key = `${category}:${actorKey(socket)}`;
  if (socketRedis?.isOpen) {
    const result = await socketRedis.eval(
      "local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return current",
      { keys: [`relay:socket-rate:${key}`], arguments: [String(windowMs)] }
    );
    return Number(result) <= limit;
  }
  if (env.NODE_ENV === "production") {
    throw new AppError("Shared rate limiting is unavailable", 503, "SERVICE_UNAVAILABLE");
  }
  const windows = socket.data.rateWindows as Map<string, { since: number; count: number }> | undefined;
  const now = Date.now();
  const current = windows?.get(category);
  if (!current || now - current.since > windowMs) {
    const next = windows ?? new Map<string, { since: number; count: number }>();
    next.set(category, { since: now, count: 1 });
    socket.data.rateWindows = next;
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function assertRate(allowed: boolean): void {
  if (!allowed) throw new AppError("Too many requests", 429, "RATE_LIMITED");
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return env.NODE_ENV !== "production" &&
      env.WIDGET_DEV_MODE === "true" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
      parsed.origin === origin;
  } catch {
    return false;
  }
}

async function isAllowedSocketOrigin(origin: string | undefined): Promise<boolean> {
  if (!origin) return env.NODE_ENV !== "production";
  if (origin === env.WEB_ORIGIN || isLocalDevelopmentOrigin(origin)) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  return Boolean(await Website.exists({ allowedOrigins: origin, status: "active" }));
}

async function assertAgentSession(socket: RealtimeSocket): Promise<TenantActor> {
  const sessionToken = socket.data.sessionToken;
  const userId = socket.data.userId;
  if (typeof sessionToken !== "string" || typeof userId !== "string") {
    throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  }
  const session = await findSessionByToken(sessionToken);
  if (!session || session.userId.toString() !== userId) {
    throw new AppError("Authentication session expired", 401, "UNAUTHENTICATED");
  }
  const user = await User.findOne({ _id: userId, accountStatus: "active" }).select("_id");
  if (!user) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  return { userId };
}

async function assertVisitorSession(socket: RealtimeSocket) {
  if (typeof socket.data.visitorToken !== "string" || typeof socket.data.origin !== "string") {
    throw new AppError("Visitor session required", 401, "UNAUTHENTICATED");
  }
  return verifyVisitorSession(socket.data.visitorToken, socket.data.origin);
}

function messageEvent(message: {
  _id: Types.ObjectId;
  senderType: "visitor" | "agent" | "system";
  senderId?: Types.ObjectId | null;
  body: string;
  createdAt: Date;
  clientMessageId?: string | null;
}) {
  return {
    id: message._id.toString(),
    senderType: message.senderType,
    ...(message.senderId ? { senderId: message.senderId.toString() } : {}),
    body: message.body,
    createdAt: message.createdAt,
    ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
    status: "sent" as const
  };
}

function conversationEvent(conversation: {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  websiteId: Types.ObjectId;
  visitorId: Types.ObjectId;
  assignedAgentId: Types.ObjectId | null;
  status: "open" | "pending" | "resolved";
  priority: "low" | "normal" | "high" | "urgent";
  subject: string | null;
  lastMessageAt: Date;
  lastMessagePreview: string;
  visitorUnreadCount: number;
  agentUnreadCount: number;
}) {
  return {
    id: conversation._id.toString(),
    workspaceId: conversation.workspaceId.toString(),
    websiteId: conversation.websiteId.toString(),
    visitorId: conversation.visitorId.toString(),
    assignedAgentId: conversation.assignedAgentId?.toString() ?? null,
    status: conversation.status,
    priority: conversation.priority,
    subject: conversation.subject,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    visitorUnreadCount: conversation.visitorUnreadCount,
    agentUnreadCount: conversation.agentUnreadCount
  };
}

async function emitUnread(io: RealtimeServer, conversationId: string) {
  const conversation = await Conversation.findById(conversationId)
    .select("visitorUnreadCount agentUnreadCount")
    .lean();
  if (!conversation) return;
  io.to(conversationRoom(conversationId)).emit("unread:update", {
    conversationId,
    visitorUnreadCount: conversation.visitorUnreadCount,
    agentUnreadCount: conversation.agentUnreadCount
  });
}

async function emitConversationUpdate(io: RealtimeServer, conversationId: string) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return;
  const snapshot = conversationEvent(conversation);
  io.to(conversationRoom(conversationId)).emit("conversation:updated", snapshot);
  io.to(workspaceInboxRoom(conversation.workspaceId.toString())).emit("conversation:updated", snapshot);
}

async function setAgentPresence(io: RealtimeServer, workspaceId: string) {
  const online = (await io.in(workspaceAgentsRoom(workspaceId)).fetchSockets()).length > 0;
  io.to(workspacePresenceRoom(workspaceId)).emit("agent:presence", { online });
}

async function hasVisitorInConversation(io: RealtimeServer, conversationId: string): Promise<boolean> {
  const sockets = await io.in(conversationRoom(conversationId)).fetchSockets();
  return sockets.some((candidate) => candidate.data.actorType === "visitor");
}

async function joinConversation(
  io: RealtimeServer,
  socket: RealtimeSocket,
  input: unknown
): Promise<{ joined: true; conversation: ReturnType<typeof conversationEvent>; messages: ReturnType<typeof messageEvent>[] }> {
  const parsed = conversationJoinInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("Invalid conversation request", 400, "VALIDATION_ERROR");
  const conversationId = parsed.data.conversationId;
  let conversation;
  let workspaceId: string;

  if (socket.data.actorType === "visitor") {
    if (parsed.data.workspaceId) {
      throw new AppError("Visitor tenant scope is server-managed", 400, "VALIDATION_ERROR");
    }
    const visitor = await assertVisitorSession(socket);
    conversation = await authorizeVisitorConversation(visitor, conversationId);
    workspaceId = visitor.workspace;
  } else {
    if (!parsed.data.workspaceId) {
      throw new AppError("Workspace is required", 400, "VALIDATION_ERROR");
    }
    const actor = await assertAgentSession(socket);
    const scope = await requireConversation(actor, parsed.data.workspaceId, conversationId);
    conversation = scope.conversation;
    workspaceId = scope.workspaceId.toString();
  }

  const filter: Record<string, unknown> = {
    workspaceId,
    conversationId,
    deletedAt: null
  };
  if (parsed.data.after) {
    filter.createdAt = { $gt: new Date(parsed.data.after) };
  }
  let messages = await Message.find(filter)
    .sort(parsed.data.after ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 })
    .limit(100)
    .lean();
  if (!parsed.data.after) messages = messages.reverse();

  socket.data.joinedConversations ??= new Map<string, string>();
  const joined = socket.data.joinedConversations as Map<string, string>;
  if (socket.data.actorType === "visitor") {
    for (const previousId of joined.keys()) {
      if (previousId !== conversationId) {
        await socket.leave(conversationRoom(previousId));
        if (!(await hasVisitorInConversation(io, previousId))) {
          io.to(conversationRoom(previousId)).emit("visitor:presence", { online: false });
        }
      }
    }
    joined.clear();
  }
  joined.set(conversationId, workspaceId);
  await socket.join(conversationRoom(conversationId));
  io.to(conversationRoom(conversationId)).emit("visitor:presence", {
    online: await hasVisitorInConversation(io, conversationId)
  });
  return {
    joined: true,
    conversation: conversationEvent(conversation),
    messages: messages.map((message) => messageEvent(message))
  };
}

async function notifyWorkspace(io: RealtimeServer, workspaceId: string, conversationId: string, preview: string) {
  const members = await WorkspaceMember.find({
    workspaceId,
    status: "active"
  }).select("userId");
  if (!members.length) return;
  const created = await Notification.insertMany(members.map(({ userId }) => ({
    workspaceId,
    userId,
    type: "new_message",
    payload: { conversationId, message: preview.slice(0, 240) }
  })));
  for (const notification of created) {
    const event = {
      id: notification._id.toString(),
      type: notification.type,
      payload: {
        conversationId: notification.payload.conversationId?.toString(),
        message: notification.payload.message
      }
    };
    io.to(workspaceAgentRoom(workspaceId, notification.userId.toString()))
      .emit("notification:new", event);
  }
}

async function assignNewConversationToOnlineAgent(io: RealtimeServer, conversationId: string, workspaceId: string) {
  const sockets = await io.in(workspaceAgentsRoom(workspaceId)).fetchSockets();
  const userIds = [...new Set(sockets
    .filter((candidate) => candidate.data.actorType === "agent" && typeof candidate.data.userId === "string")
    .map((candidate) => String(candidate.data.userId)))];
  if (!userIds.length) return Conversation.findById(conversationId);

  const memberships = await WorkspaceMember.find({
    workspaceId,
    userId: { $in: userIds },
    status: "active",
    role: { $in: ["agent", "supervisor"] }
  }).select("userId");
  const loads = await Promise.all(memberships.map(async ({ userId }) => ({
    userId,
    count: await Conversation.countDocuments({
      workspaceId,
      assignedAgentId: userId,
      status: { $in: ["open", "pending"] }
    })
  })));
  loads.sort((left, right) => left.count - right.count);
  const selected = loads[0]?.userId;
  if (!selected) return Conversation.findById(conversationId);
  await Conversation.updateOne(
    { _id: conversationId, workspaceId, assignedAgentId: null },
    { $set: { assignedAgentId: selected } }
  );
  const conversation = await Conversation.findOne({ _id: conversationId, workspaceId });
  if (conversation) {
    const snapshot = conversationEvent(conversation);
    io.to(workspaceInboxRoom(workspaceId)).emit("conversation:assigned", snapshot);
    io.to(workspaceAgentRoom(workspaceId, selected.toString())).emit("conversation:assigned", snapshot);
  }
  return conversation;
}

export async function openVisitorConversation(visitor: Awaited<ReturnType<typeof verifyVisitorSession>>) {
  const opened = await getOrCreateVisitorConversation(visitor);
  let conversation = await Conversation.findOne({
    _id: opened.conversationId,
    workspaceId: visitor.workspace,
    websiteId: visitor.website,
    visitorId: visitor.visitor
  });
  if (!conversation) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  if (!conversation.assignedAgentId && ioServer) {
    conversation = await assignNewConversationToOnlineAgent(
      ioServer,
      opened.conversationId,
      visitor.workspace
    ) ?? conversation;
  }
  if (opened.created && ioServer) {
    ioServer.to(workspaceInboxRoom(visitor.workspace))
      .emit("conversation:created", conversationEvent(conversation));
  }
  return opened;
}

function bindSocketEvents(io: RealtimeServer, socket: RealtimeSocket) {
  const wrap = async <T>(
    ack: Ack<T> | undefined,
    handler: () => Promise<T | undefined>
  ) => {
    try {
      assertRate(await checkRate(socket, "events", 120));
      const data = await handler();
      ack?.({ ok: true, ...(data === undefined ? {} : { data }) });
    } catch (error) {
      sendAckError(ack as Ack | undefined, error, socket);
    }
  };

  socket.on("inbox:join", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "agent") throw new AppError("Agent session required", 401, "UNAUTHENTICATED");
    const parsed = inboxJoinInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid inbox request", 400, "VALIDATION_ERROR");
    const actor = await assertAgentSession(socket);
    await requireWorkspaceMember(actor, parsed.data.workspaceId);
    await socket.join(workspaceInboxRoom(parsed.data.workspaceId));
    const conversations = await listConversations(actor, parsed.data.workspaceId, { limit: 50 });
    const onlineSockets = await io.in(workspaceAgentsRoom(parsed.data.workspaceId)).fetchSockets();
    const onlineAgentIds = [...new Set(onlineSockets
      .filter((item) => item.data.actorType === "agent" && typeof item.data.userId === "string")
      .map((item) => String(item.data.userId)))];
    return { joined: true as const, conversations: conversations.map(conversationEvent), onlineAgentIds };
  }));

  socket.on("conversation:open", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "visitor") throw new AppError("Visitor session required", 401, "UNAUTHENTICATED");
    assertRate(await checkRate(socket, "conversation-open", 10));
    const parsed = emptySocketInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid conversation request", 400, "VALIDATION_ERROR");
    const visitor = await assertVisitorSession(socket);
    const opened = await openVisitorConversation(visitor);
    const joined = await joinConversation(io, socket, { conversationId: opened.conversationId });
    return { ...opened, conversation: joined.conversation, messages: joined.messages };
  }));

  socket.on("conversation:join", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    return joinConversation(io, socket, input);
  }));

  const sendVisitorMessage = async (input: unknown) => {
    if (socket.data.actorType !== "visitor") throw new AppError("Visitor session required", 401, "UNAUTHENTICATED");
    assertRate(await checkRate(socket, "messages", 30));
    const parsed = messageSocketInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid message", 400, "VALIDATION_ERROR");
    const joined = socket.data.joinedConversations as Map<string, string> | undefined;
    const conversationId = joined?.keys().next().value as string | undefined;
    if (!conversationId) throw new AppError("Join a conversation first", 409, "CONVERSATION_NOT_JOINED");
    const visitor = await assertVisitorSession(socket);
    const message = await createVisitorMessage(visitor, conversationId, parsed.data);
    const event = messageEvent(message);
    io.to(conversationRoom(conversationId)).emit("conversation:message", event);
    io.to(conversationRoom(conversationId)).emit("message:new", event);
    await emitUnread(io, conversationId);
    const conversation = await Conversation.findById(conversationId).select("workspaceId");
    if (conversation) {
      const messageWorkspaceId = conversation.workspaceId.toString();
      await emitConversationUpdate(io, conversationId);
      await notifyWorkspace(io, messageWorkspaceId, conversationId, message.body);
    }
    return { message: event };
  };
  socket.on("conversation:message", (input: unknown, ack?: Ack) => void wrap(ack, () => sendVisitorMessage(input)));

  socket.on("message:send", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "agent") throw new AppError("Agent session required", 401, "UNAUTHENTICATED");
    assertRate(await checkRate(socket, "messages", 30));
    const parsed = agentMessageInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid message", 400, "VALIDATION_ERROR");
    const actor = await assertAgentSession(socket);
    const joined = socket.data.joinedConversations as Map<string, string> | undefined;
    if (joined?.get(parsed.data.conversationId) !== parsed.data.workspaceId) {
      throw new AppError("Join the conversation first", 409, "CONVERSATION_NOT_JOINED");
    }
    const message = await createAgentMessage(
      actor,
      parsed.data.workspaceId,
      parsed.data.conversationId,
      { clientMessageId: parsed.data.clientMessageId, body: parsed.data.body }
    );
    const event = messageEvent(message);
    io.to(conversationRoom(parsed.data.conversationId)).emit("conversation:message", event);
    io.to(conversationRoom(parsed.data.conversationId)).emit("message:new", event);
    await emitUnread(io, parsed.data.conversationId);
    await emitConversationUpdate(io, parsed.data.conversationId);
    return { message: event };
  }));

  const sendTyping = async (senderType: SocketRole, conversationId: string, isTyping: boolean) => {
    const timers = socket.data.typingTimers as Map<string, NodeJS.Timeout> | undefined
      ?? new Map<string, NodeJS.Timeout>();
    socket.data.typingTimers = timers;
    const existing = timers.get(conversationId);
    if (existing) clearTimeout(existing);
    const broadcast = (typing: boolean) => {
      io.to(conversationRoom(conversationId)).except(socket.id).emit("conversation:typing", {
        senderType,
        isTyping: typing
      });
    };
    broadcast(isTyping);
    if (isTyping) {
      const timer = setTimeout(() => {
        timers.delete(conversationId);
        broadcast(false);
      }, 5_000);
      timer.unref();
      timers.set(conversationId, timer);
    } else {
      timers.delete(conversationId);
    }
  };
  socket.on("conversation:typing", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "visitor") throw new AppError("Visitor session required", 401, "UNAUTHENTICATED");
    const parsed = typingInputSchema.safeParse(input);
    const joined = socket.data.joinedConversations as Map<string, string> | undefined;
    const conversationId = joined?.keys().next().value as string | undefined;
    if (!parsed.success || !conversationId) throw new AppError("Invalid typing update", 400, "VALIDATION_ERROR");
    assertRate(await checkRate(socket, "typing", 30));
    const visitor = await assertVisitorSession(socket);
    await authorizeVisitorConversation(visitor, conversationId);
    await sendTyping("visitor", conversationId, parsed.data.isTyping);
  }));

  socket.on("typing:set", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "agent") throw new AppError("Agent session required", 401, "UNAUTHENTICATED");
    const parsed = agentTypingInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid typing update", 400, "VALIDATION_ERROR");
    assertRate(await checkRate(socket, "typing", 30));
    const actor = await assertAgentSession(socket);
    const joined = socket.data.joinedConversations as Map<string, string> | undefined;
    if (joined?.get(parsed.data.conversationId) !== parsed.data.workspaceId) {
      throw new AppError("Join the conversation first", 409, "CONVERSATION_NOT_JOINED");
    }
    await requireConversation(actor, parsed.data.workspaceId, parsed.data.conversationId);
    await sendTyping("agent", parsed.data.conversationId, parsed.data.isTyping);
  }));

  socket.on("conversation:read", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType === "visitor") {
      const parsed = emptySocketInputSchema.safeParse(input);
      if (!parsed.success) throw new AppError("Invalid read receipt", 400, "VALIDATION_ERROR");
      const joined = socket.data.joinedConversations as Map<string, string> | undefined;
      const conversationId = joined?.keys().next().value as string | undefined;
      if (!conversationId) throw new AppError("Join a conversation first", 409, "CONVERSATION_NOT_JOINED");
      const visitor = await assertVisitorSession(socket);
      await markVisitorConversationRead(visitor, conversationId);
      io.to(conversationRoom(conversationId)).emit("conversation:read", { readerType: "visitor" });
      await emitUnread(io, conversationId);
      return;
    }
    const parsed = agentConversationReadInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid read receipt", 400, "VALIDATION_ERROR");
    const actor = await assertAgentSession(socket);
    const joined = socket.data.joinedConversations as Map<string, string> | undefined;
    if (joined?.get(parsed.data.conversationId) !== parsed.data.workspaceId) {
      throw new AppError("Join the conversation first", 409, "CONVERSATION_NOT_JOINED");
    }
    await markConversationRead(actor, parsed.data.workspaceId, parsed.data.conversationId);
    io.to(conversationRoom(parsed.data.conversationId)).emit("conversation:read", { readerType: "agent" });
    await emitUnread(io, parsed.data.conversationId);
  }));

  socket.on("conversation:update", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "agent") throw new AppError("Agent session required", 401, "UNAUTHENTICATED");
    const parsed = conversationUpdateInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid conversation update", 400, "VALIDATION_ERROR");
    const actor = await assertAgentSession(socket);
    const joined = socket.data.joinedConversations as Map<string, string> | undefined;
    if (joined?.get(parsed.data.conversationId) !== parsed.data.workspaceId) {
      throw new AppError("Join the conversation first", 409, "CONVERSATION_NOT_JOINED");
    }
    const { workspaceId, conversationId, ...updates } = parsed.data;
    const conversation = await updateConversation(actor, workspaceId, conversationId, updates);
    const snapshot = conversationEvent(conversation);
    io.to(conversationRoom(conversationId)).emit("conversation:updated", snapshot);
    io.to(workspaceInboxRoom(workspaceId)).emit("conversation:updated", snapshot);
    if (conversation.status === "resolved") {
      io.to(conversationRoom(conversationId)).emit("conversation:resolved", { status: "resolved" });
    }
    return { conversation: snapshot };
  }));

  socket.on("conversation:assign", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "agent") throw new AppError("Agent session required", 401, "UNAUTHENTICATED");
    const parsed = conversationAssignmentInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid assignment", 400, "VALIDATION_ERROR");
    const actor = await assertAgentSession(socket);
    const joined = socket.data.joinedConversations as Map<string, string> | undefined;
    if (joined?.get(parsed.data.conversationId) !== parsed.data.workspaceId) {
      throw new AppError("Join the conversation first", 409, "CONVERSATION_NOT_JOINED");
    }
    const conversation = await assignConversation(
      actor,
      parsed.data.workspaceId,
      parsed.data.conversationId,
      parsed.data.assignedAgentId
    );
    const snapshot = conversationEvent(conversation);
    io.to(conversationRoom(parsed.data.conversationId)).emit("conversation:assigned", snapshot);
    io.to(workspaceInboxRoom(parsed.data.workspaceId)).emit("conversation:assigned", snapshot);
    if (parsed.data.assignedAgentId) {
      io.to(workspaceAgentRoom(parsed.data.workspaceId, parsed.data.assignedAgentId))
        .emit("conversation:assigned", snapshot);
    }
    return { conversation: snapshot };
  }));

  socket.on("visitor:profile", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "visitor") throw new AppError("Visitor session required", 401, "UNAUTHENTICATED");
    const parsed = visitorProfileInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid visitor profile", 400, "VALIDATION_ERROR");
    const visitor = await assertVisitorSession(socket);
    return updateWidgetVisitorProfile(visitor, parsed.data);
  }));

  socket.on("visitor:details", (input: unknown, ack?: Ack) => void wrap(ack, async () => {
    if (socket.data.actorType !== "agent") throw new AppError("Agent session required", 401, "UNAUTHENTICATED");
    const parsed = agentConversationScopeSchema
      .safeParse(input);
    if (!parsed.success) throw new AppError("Invalid visitor details request", 400, "VALIDATION_ERROR");
    const actor = await assertAgentSession(socket);
    const scope = await requireConversation(actor, parsed.data.workspaceId, parsed.data.conversationId);
    const visitor = await Visitor.findOne({
      _id: scope.conversation.visitorId,
      workspaceId: scope.workspaceId,
      websiteId: scope.conversation.websiteId
    }).select("displayName email phone firstSeenAt lastSeenAt currentPageUrl referrer browser operatingSystem country customAttributes");
    if (!visitor) throw new AppError("Visitor not found", 404, "NOT_FOUND");
    return {
      displayName: visitor.displayName,
      email: visitor.email,
      phone: visitor.phone,
      firstSeenAt: visitor.firstSeenAt,
      lastSeenAt: visitor.lastSeenAt,
      currentPageUrl: visitor.currentPageUrl,
      referrer: visitor.referrer,
      browser: visitor.browser,
      operatingSystem: visitor.operatingSystem,
      country: visitor.country,
      customAttributes: visitor.customAttributes
    };
  }));

  socket.on("disconnect", () => {
    const timer = socket.data.authTimer as NodeJS.Timeout | undefined;
    if (timer) clearInterval(timer);
    const typingTimers = socket.data.typingTimers as Map<string, NodeJS.Timeout> | undefined;
    for (const [conversationId, typingTimer] of typingTimers ?? []) {
      clearTimeout(typingTimer);
      io.to(conversationRoom(conversationId)).except(socket.id).emit("conversation:typing", {
        senderType: socket.data.actorType,
        isTyping: false
      });
    }
    const workspaceIds = socket.data.presenceWorkspaceIds as string[] | undefined;
    for (const workspaceId of workspaceIds ?? []) {
      void setAgentPresence(io, workspaceId).catch((error: unknown) => {
        logger.error({ err: error, workspaceId }, "Unable to update agent presence");
      });
      const userId = socket.data.userId;
      if (typeof userId === "string") {
        void io.in(workspaceAgentsRoom(workspaceId)).fetchSockets().then((sockets) => {
          const stillOnline = sockets.some((candidate) =>
            candidate.data.actorType === "agent" && candidate.data.userId === userId
          );
          if (!stillOnline) {
            io.to(workspaceInboxRoom(workspaceId)).emit("workspace:agent-presence", { userId, online: false });
          }
        }).catch((error: unknown) => {
          logger.error({ err: error, workspaceId, userId }, "Unable to update member presence");
        });
      }
    }
    if (socket.data.actorType === "visitor") {
      const joined = socket.data.joinedConversations as Map<string, string> | undefined;
      for (const conversationId of joined?.keys() ?? []) {
        void hasVisitorInConversation(io, conversationId).then((online) => {
          if (!online) io.to(conversationRoom(conversationId)).emit("visitor:presence", { online: false });
        }).catch((error: unknown) => {
          logger.error({ err: error, conversationId }, "Unable to update visitor presence");
        });
      }
    }
  });
}

export async function createRealtimeServer(server: HttpServer): Promise<RealtimeServer> {
  if (env.REDIS_URL) {
    socketRedis = createClient({ url: env.REDIS_URL });
    socketRedisSubscriber = socketRedis.duplicate();
    socketRedis.on("error", (error) => logger.error({ err: error }, "Socket Redis connection failed"));
    socketRedisSubscriber.on("error", (error) => logger.error({ err: error }, "Socket Redis subscriber failed"));
    await Promise.all([socketRedis.connect(), socketRedisSubscriber.connect()]);
  }

  const io: RealtimeServer = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: {
      origin: (origin, callback) => {
        void isAllowedSocketOrigin(origin).then(
          (allowed) => callback(null, allowed),
          (error: unknown) => {
            logger.error({ err: error }, "Socket origin check failed");
            callback(null, false);
          }
        );
      },
      credentials: true,
      methods: ["GET", "POST"]
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      void isAllowedSocketOrigin(origin).then(
        (allowed) => callback(null, allowed),
        (error: unknown) => {
          logger.error({ err: error }, "Socket request origin check failed");
          callback(null, false);
        }
      );
    },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectTimeout: 10_000
  });
  if (socketRedis && socketRedisSubscriber) {
    io.adapter(createAdapter(socketRedis, socketRedisSubscriber));
  }
  ioServer = io;

  io.use(async (socket, next) => {
    const correlationId = randomUUID();
    socket.data.correlationId = correlationId;
    try {
      assertRate(await checkRate(socket, "connections", 60));
      const origin = socket.handshake.headers.origin;
      const visitorAuth = visitorSocketAuthSchema.safeParse(socket.handshake.auth);
      if (visitorAuth.success) {
        const visitor = await verifyVisitorSession(visitorAuth.data.visitorToken, origin);
        socket.data.actorType = "visitor";
        socket.data.visitorToken = visitorAuth.data.visitorToken;
        socket.data.origin = origin;
        socket.data.websiteId = visitor.website;
        socket.data.visitorId = visitor.visitor;
        socket.data.workspaceId = visitor.workspace;
        next();
        return;
      }
      const sessionToken = parseCookies(socket.handshake.headers.cookie).get(sessionCookieName);
      if (sessionToken && origin === env.WEB_ORIGIN) {
        const session = await findSessionByToken(sessionToken);
        if (session) {
          const user = await User.findOne({ _id: session.userId, accountStatus: "active" }).select("_id");
          if (user) {
            socket.data.actorType = "agent";
            socket.data.userId = user._id.toString();
            socket.data.sessionToken = sessionToken;
            socket.data.origin = origin;
            next();
            return;
          }
        }
      }
      next(new Error("unauthorized"));
    } catch (error) {
      logger.warn({ correlationId, err: error }, "Socket authentication rejected");
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.data.joinedConversations = new Map<string, string>();
    logger.info({
      correlationId: socket.data.correlationId,
      actorType: socket.data.actorType,
      socketId: socket.id
    }, "Socket connected");
    bindSocketEvents(io, socket);

    if (socket.data.actorType === "visitor" && typeof socket.data.workspaceId === "string") {
      const workspaceId = socket.data.workspaceId;
      void Promise.resolve(socket.join(workspacePresenceRoom(workspaceId))).then(async () => {
        const agents = await io.in(workspaceAgentsRoom(workspaceId)).fetchSockets();
        socket.emit("agent:presence", { online: agents.length > 0 });
      }).catch((error: unknown) => {
        logger.error({ err: error, correlationId: socket.data.correlationId }, "Visitor presence initialization failed");
        socket.disconnect(true);
      });
      return;
    }

    if (socket.data.actorType === "agent" && typeof socket.data.userId === "string") {
      const userId = socket.data.userId;
      void (async () => {
        const memberships = await WorkspaceMember.find({
          userId,
          status: "active"
        }).select("workspaceId");
        const workspaceIds = memberships.map(({ workspaceId }) => workspaceId.toString());
        socket.data.presenceWorkspaceIds = workspaceIds;
        for (const workspaceId of workspaceIds) {
          await socket.join(workspaceAgentsRoom(workspaceId));
          await socket.join(workspaceAgentRoom(workspaceId, userId));
          await socket.join(workspacePresenceRoom(workspaceId));
          await setAgentPresence(io, workspaceId);
          io.to(workspaceInboxRoom(workspaceId)).emit("workspace:agent-presence", { userId, online: true });
        }
        const timer = setInterval(() => {
          void assertAgentSession(socket).catch(() => socket.disconnect(true));
        }, 30_000);
        timer.unref();
        socket.data.authTimer = timer;
      })().catch((error: unknown) => {
        logger.error({ err: error, correlationId: socket.data.correlationId }, "Agent socket initialization failed");
        socket.disconnect(true);
      });
    }
  });
  return io;
}

export async function closeRealtimeInfrastructure(): Promise<void> {
  await Promise.all([
    socketRedis?.isOpen ? socketRedis.quit() : Promise.resolve(),
    socketRedisSubscriber?.isOpen ? socketRedisSubscriber.quit() : Promise.resolve()
  ]);
  socketRedis = undefined;
  socketRedisSubscriber = undefined;
  ioServer = undefined;
}

export function emitToConversation(
  conversationId: string,
  event: "conversation:message",
  payload: SocketServerPayload<"conversation:message">
): void;
export function emitToConversation(
  conversationId: string,
  event: "conversation:resolved",
  payload: SocketServerPayload<"conversation:resolved">
): void;
export function emitToConversation(
  conversationId: string,
  event: "conversation:read",
  payload: SocketServerPayload<"conversation:read">
): void;
export function emitToConversation(
  conversationId: string,
  event: "conversation:message" | "conversation:resolved" | "conversation:read",
  payload: unknown
) {
  const room = ioServer?.to(conversationRoom(conversationId));
  if (event === "conversation:message") {
    const message = socketMessageSchema.parse(payload);
    room?.emit("conversation:message", message);
    room?.emit("message:new", message);
  } else if (event === "conversation:resolved") {
    const status = z.object({ status: z.literal("resolved") }).strict().parse(payload);
    room?.emit("conversation:resolved", status);
  } else {
    const receipt = z.object({ readerType: z.enum(["visitor", "agent"]) }).strict().parse(payload);
    room?.emit("conversation:read", receipt);
  }
}

export async function disconnectWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  await ioServer?.in(workspaceAgentRoom(workspaceId, userId)).disconnectSockets(true);
}
