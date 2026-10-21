import { z } from "zod";
import {
  conversationStatusSchema,
  messageInputSchema,
  objectIdSchema
} from "./schemas.js";

export const emptySocketInputSchema = z.object({}).strict();
export const inboxJoinInputSchema = z.object({
  workspaceId: objectIdSchema
}).strict();
export const agentConversationScopeSchema = z.object({
  workspaceId: objectIdSchema,
  conversationId: objectIdSchema
}).strict();
export const conversationJoinInputSchema = z.object({
  conversationId: objectIdSchema,
  workspaceId: objectIdSchema.optional(),
  after: z.string().datetime().optional()
}).strict();
export const conversationUpdateInputSchema = agentConversationScopeSchema.extend({
  status: conversationStatusSchema.optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional()
}).strict().refine(({ workspaceId: _workspaceId, conversationId: _conversationId, ...changes }) =>
  Object.keys(changes).length > 0
);
export const conversationAssignmentInputSchema = z.object({
  workspaceId: objectIdSchema,
  conversationId: objectIdSchema,
  assignedAgentId: objectIdSchema.nullable()
}).strict();
export const typingInputSchema = z.object({
  isTyping: z.boolean()
}).strict();
export const agentTypingInputSchema = agentConversationScopeSchema.extend({
  isTyping: z.boolean()
}).strict();
export const agentMessageInputSchema = agentConversationScopeSchema.extend({
  clientMessageId: z.string().trim().min(1).max(128),
  body: z.string().trim().min(1).max(10_000)
}).strict();
export const agentConversationReadInputSchema = agentConversationScopeSchema;
export const visitorProfileInputSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254).optional()
}).strict().refine((value) => Object.keys(value).length > 0);
export const messageSocketInputSchema = messageInputSchema;
export const visitorSocketAuthSchema = z.object({
  visitorToken: z.string().min(32).max(4096)
}).strict();

export const socketErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_ID",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "CONVERSATION_NOT_JOINED",
  "CONVERSATION_RESOLVED",
  "IDEMPOTENCY_KEY_REUSED",
  "WIDGET_SESSION_INVALID",
  "ORIGIN_NOT_ALLOWED",
  "SERVICE_UNAVAILABLE",
  "PROFILE_COLLECTION_DISABLED",
  "INTERNAL_ERROR"
]);

export const socketAckSchema = <T extends z.ZodTypeAny>(dataSchema: T) => z.union([
  z.object({ ok: z.literal(true), data: dataSchema.optional() }).strict(),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: socketErrorCodeSchema,
      message: z.string().max(200)
    }).strict()
  }).strict()
]);

export const socketMessageSchema = z.object({
  id: objectIdSchema,
  senderType: z.enum(["visitor", "agent", "system"]),
  senderId: objectIdSchema.nullable().optional(),
  body: z.string().max(10_000),
  createdAt: z.union([z.string().datetime(), z.date()]),
  clientMessageId: z.string().max(128).optional(),
  status: z.literal("sent").optional()
}).strict();
export const socketConversationSnapshotSchema = z.object({
  id: objectIdSchema,
  workspaceId: objectIdSchema,
  websiteId: objectIdSchema,
  visitorId: objectIdSchema,
  assignedAgentId: objectIdSchema.nullable(),
  status: conversationStatusSchema,
  priority: z.enum(["low", "normal", "high", "urgent"]),
  subject: z.string().max(200).nullable(),
  lastMessageAt: z.union([z.string().datetime(), z.date()]),
  lastMessagePreview: z.string().max(240),
  visitorUnreadCount: z.number().int().nonnegative(),
  agentUnreadCount: z.number().int().nonnegative()
}).strict();

export const socketClientToServerSchemas = {
  "inbox:join": inboxJoinInputSchema,
  "conversation:open": emptySocketInputSchema,
  "conversation:join": conversationJoinInputSchema,
  "conversation:message": messageSocketInputSchema,
  "message:send": agentMessageInputSchema,
  "conversation:typing": typingInputSchema,
  "typing:set": agentTypingInputSchema,
  "conversation:read": z.union([emptySocketInputSchema, agentConversationReadInputSchema]),
  "conversation:update": conversationUpdateInputSchema,
  "conversation:assign": conversationAssignmentInputSchema,
  "visitor:profile": visitorProfileInputSchema,
  "visitor:details": agentConversationScopeSchema
} as const;

export const socketServerToClientSchemas = {
  "conversation:created": socketConversationSnapshotSchema,
  "conversation:updated": socketConversationSnapshotSchema,
  "conversation:assigned": socketConversationSnapshotSchema,
  "conversation:message": socketMessageSchema,
  "message:new": socketMessageSchema,
  "conversation:typing": z.object({
    senderType: z.enum(["visitor", "agent"]),
    isTyping: z.boolean()
  }).strict(),
  "conversation:read": z.object({
    readerType: z.enum(["visitor", "agent"])
  }).strict(),
  "conversation:resolved": z.object({ status: z.literal("resolved") }).strict(),
  "agent:presence": z.object({ online: z.boolean() }).strict(),
  "visitor:presence": z.object({ online: z.boolean() }).strict(),
  "workspace:agent-presence": z.object({
    userId: objectIdSchema,
    online: z.boolean()
  }).strict(),
  "unread:update": z.object({
    conversationId: objectIdSchema,
    visitorUnreadCount: z.number().int().nonnegative(),
    agentUnreadCount: z.number().int().nonnegative()
  }).strict(),
  "notification:new": z.object({
    id: objectIdSchema,
    type: z.string().max(80),
    payload: z.record(z.unknown())
  }).strict(),
  "socket:error": z.object({
    code: socketErrorCodeSchema,
    message: z.string().max(200)
  }).strict()
} as const;

export type SocketClientEvent = keyof typeof socketClientToServerSchemas;
export type SocketServerEvent = keyof typeof socketServerToClientSchemas;
export type SocketClientPayload<Event extends SocketClientEvent> =
  z.infer<(typeof socketClientToServerSchemas)[Event]>;
export type SocketServerPayload<Event extends SocketServerEvent> =
  z.infer<(typeof socketServerToClientSchemas)[Event]>;
export type SocketAck<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: z.infer<typeof socketErrorCodeSchema>; message: string } };

export interface ClientToServerEvents {
  "inbox:join": (input: SocketClientPayload<"inbox:join">, ack?: SocketAckCallback<unknown>) => void;
  "conversation:open": (input: SocketClientPayload<"conversation:open">, ack?: SocketAckCallback<unknown>) => void;
  "conversation:join": (input: SocketClientPayload<"conversation:join">, ack?: SocketAckCallback<unknown>) => void;
  "conversation:message": (input: SocketClientPayload<"conversation:message">, ack?: SocketAckCallback<unknown>) => void;
  "message:send": (input: SocketClientPayload<"message:send">, ack?: SocketAckCallback<unknown>) => void;
  "conversation:typing": (input: SocketClientPayload<"conversation:typing">, ack?: SocketAckCallback<unknown>) => void;
  "typing:set": (input: SocketClientPayload<"typing:set">, ack?: SocketAckCallback<unknown>) => void;
  "conversation:read": (input: SocketClientPayload<"conversation:read">, ack?: SocketAckCallback<unknown>) => void;
  "conversation:update": (input: SocketClientPayload<"conversation:update">, ack?: SocketAckCallback<unknown>) => void;
  "conversation:assign": (input: SocketClientPayload<"conversation:assign">, ack?: SocketAckCallback<unknown>) => void;
  "visitor:profile": (input: SocketClientPayload<"visitor:profile">, ack?: SocketAckCallback<unknown>) => void;
  "visitor:details": (input: SocketClientPayload<"visitor:details">, ack?: SocketAckCallback<unknown>) => void;
}

export interface SocketAckCallback<T = unknown> {
  (result: SocketAck<T>): void;
}

export interface ServerToClientEvents {
  "conversation:created": (conversation: SocketServerPayload<"conversation:created">) => void;
  "conversation:updated": (conversation: SocketServerPayload<"conversation:updated">) => void;
  "conversation:assigned": (conversation: SocketServerPayload<"conversation:assigned">) => void;
  "conversation:message": (message: SocketServerPayload<"conversation:message">) => void;
  "message:new": (message: SocketServerPayload<"message:new">) => void;
  "conversation:typing": (event: SocketServerPayload<"conversation:typing">) => void;
  "conversation:read": (event: SocketServerPayload<"conversation:read">) => void;
  "conversation:resolved": (event: SocketServerPayload<"conversation:resolved">) => void;
  "agent:presence": (presence: SocketServerPayload<"agent:presence">) => void;
  "visitor:presence": (presence: SocketServerPayload<"visitor:presence">) => void;
  "workspace:agent-presence": (presence: SocketServerPayload<"workspace:agent-presence">) => void;
  "unread:update": (unread: SocketServerPayload<"unread:update">) => void;
  "notification:new": (notification: SocketServerPayload<"notification:new">) => void;
  "socket:error": (error: SocketServerPayload<"socket:error">) => void;
}
