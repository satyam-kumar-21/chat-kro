# Socket.IO event reference

The authoritative schemas and event types live in `packages/shared/src/socket.ts`; runtime Zod validation runs before event handling. The API server hosts Socket.IO on the persistent Express HTTP server. See [socket-protocol.md](./socket-protocol.md) for authentication, room authorization, delivery semantics, scaling, and failure behavior.

## Client to server

| Event | Actor | Input | Success acknowledgement |
|---|---|---|---|
| `inbox:join` | Agent | `{ workspaceId }` | `{ joined, conversations, onlineAgentIds }` |
| `conversation:open` | Visitor | `{}` | Authorized conversation snapshot and message history |
| `conversation:join` | Agent/visitor | `{ conversationId, workspaceId? , after? }` | `{ joined, conversation, messages }` |
| `conversation:message` | Visitor | `{ clientMessageId, body }` | `{ message }` |
| `message:send` | Agent | `{ workspaceId, conversationId, clientMessageId, body }` | `{ message }` |
| `conversation:typing` | Visitor | `{ isTyping }` | Empty data |
| `typing:set` | Agent | `{ workspaceId, conversationId, isTyping }` | Empty data |
| `conversation:read` | Visitor/agent | `{}` / `{ workspaceId, conversationId }` | Empty data |
| `conversation:update` | Agent | `{ workspaceId, conversationId, status?, priority?, subject?, tags? }` | `{ conversation }` |
| `conversation:assign` | Agent with assignment permission | `{ workspaceId, conversationId, assignedAgentId }` | `{ conversation }` |
| `visitor:profile` | Visitor | `{ name?, email? }` | `{ updated: true }` |
| `visitor:details` | Agent | `{ workspaceId, conversationId }` | Safe profile details for authorized visitor |

## Server to client

| Event | Payload |
|---|---|
| `conversation:created`, `conversation:updated`, `conversation:assigned` | Safe persisted conversation snapshot |
| `conversation:message`, `message:new` | Persisted message, including message ID, sender, body, timestamp, and client idempotency ID |
| `conversation:typing` | `{ senderType: "visitor" \| "agent", isTyping }` |
| `conversation:read` | `{ readerType: "visitor" \| "agent" }` |
| `conversation:resolved` | `{ status: "resolved" }` |
| `agent:presence`, `visitor:presence` | `{ online }` |
| `workspace:agent-presence` | `{ userId, online }` |
| `unread:update` | `{ conversationId, visitorUnreadCount, agentUnreadCount }` |
| `notification:new` | `{ id, type, payload }` |
| `socket:error` | `{ code, message }` |

## Acknowledgement envelopes

```ts
{ ok: true, data?: T }
{ ok: false, error: { code, message } }
```

Failure codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_ID`, `VALIDATION_ERROR`, `RATE_LIMITED`, `CONVERSATION_NOT_JOINED`, `CONVERSATION_RESOLVED`, `IDEMPOTENCY_KEY_REUSED`, `WIDGET_SESSION_INVALID`, `ORIGIN_NOT_ALLOWED`, `SERVICE_UNAVAILABLE`, `PROFILE_COLLECTION_DISABLED`, `INTERNAL_ERROR`.

All message bodies are plain text with a 10,000-character maximum. The server persists before acknowledging, deduplicates by conversation-scoped client ID, and expects clients to recover missed events from API/database history; network delivery is not exactly once.
