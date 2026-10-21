# Socket.IO protocol

The API hosts Socket.IO on the same HTTP origin as the Express API. Shared request schemas, event names, payload types, and acknowledgement types are exported from `@live-chat/shared`. The server validates every client event with Zod before using its payload.

## Authentication and scope

The Socket.IO connection supports two distinct actor types:

- **Dashboard agent:** the browser sends the `relay_session` HTTP-only cookie and must connect from the exact configured `WEB_ORIGIN`. The API resolves the hashed session, checks the active account, and revalidates the session on each action and every 30 seconds.
- **Website visitor:** the client sends `{ "visitorToken": "..." }` in Socket.IO `auth`. The signed credential is checked against current visitor, website, workspace, and exact allowlisted origin records. A public widget ID or visitor ID is never sufficient to authorize a conversation.

Conversation rooms use `conversation:<conversationId>`. An agent must be an active workspace member and pass conversation authorization before joining. A visitor can join only conversations bound to the signed visitor, website, and workspace. Inbox, agent, presence, and workspace rooms are created by the server after membership checks; clients cannot choose room names.

## Client-to-server events

| Event | Actor | Payload | Successful acknowledgement data |
|---|---|---|---|
| `inbox:join` | Agent | `{ workspaceId }` | `{ joined: true, conversations: [...] }` |
| `conversation:open` | Visitor | `{}` | Conversation ID, status, history, and safe conversation snapshot; assigns an online agent when available |
| `conversation:join` | Both | Visitor: `{ conversationId, after? }`; agent: `{ workspaceId, conversationId, after? }` | `{ joined: true, conversation, messages }`; returns the newest 100 messages when no `after` cursor is supplied |
| `conversation:message` | Visitor | `{ clientMessageId, body }` | `{ message }`; retained for compatibility with the installed widget |
| `message:send` | Agent | `{ workspaceId, conversationId, clientMessageId, body }` | `{ message }` |
| `conversation:typing` | Visitor | `{ isTyping }` | Empty data |
| `typing:set` | Agent | `{ workspaceId, conversationId, isTyping }` | Empty data |
| `conversation:read` | Visitor | `{}`; agent: `{ workspaceId, conversationId }` | Empty data |
| `conversation:update` | Agent | `{ workspaceId, conversationId, status?, priority?, subject?, tags? }` | `{ conversation }` |
| `conversation:assign` | Agent with owner/admin/supervisor permission | `{ workspaceId, conversationId, assignedAgentId }` | `{ conversation }` |
| `visitor:profile` | Visitor | `{ name?, email? }` | `{ updated: true }` |
| `visitor:details` | Agent | `{ workspaceId, conversationId }` | Safe visitor profile fields for an authorized conversation |

Message bodies are text only and limited to 10,000 characters. `clientMessageId` is the client-generated idempotency key, unique in the conversation. A retry with the same actor, body, and key resolves to the persisted message; reusing that key for a different actor or body is rejected.

## Server-to-client events

| Event | Payload |
|---|---|
| `conversation:created` | Safe conversation snapshot for a new conversation |
| `conversation:updated` | Safe conversation snapshot after status/priority/subject/tag changes |
| `conversation:assigned` | Safe conversation snapshot after automatic or manual assignment |
| `conversation:message` | Persisted message; compatibility event used by the widget |
| `message:new` | Persisted message event for current dashboard clients |
| `conversation:typing` | `{ senderType: "visitor" \| "agent", isTyping }`; ephemeral, automatically expires after five seconds |
| `conversation:read` | `{ readerType: "visitor" \| "agent" }` |
| `conversation:resolved` | `{ status: "resolved" }` |
| `agent:presence` | `{ online }` for the authorized website's workspace |
| `unread:update` | `{ conversationId, visitorUnreadCount, agentUnreadCount }` |
| `notification:new` | `{ id, type, payload }` for the authenticated member |
| `socket:error` | `{ code, message }` for an event failure |

## Acknowledgements and failure codes

Every event acknowledgement uses one of these envelopes:

```ts
{ ok: true, data?: T }
{ ok: false, error: { code: FailureCode, message: string } }
```

Failure codes are `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_ID`, `VALIDATION_ERROR`, `RATE_LIMITED`, `CONVERSATION_NOT_JOINED`, `CONVERSATION_RESOLVED`, `IDEMPOTENCY_KEY_REUSED`, `WIDGET_SESSION_INVALID`, `ORIGIN_NOT_ALLOWED`, `PROFILE_COLLECTION_DISABLED`, `SERVICE_UNAVAILABLE`, and `INTERNAL_ERROR`. Internal errors return a generic client message and are logged with a correlation ID.

## Persistence, recovery, and delivery semantics

Messages are stored before a success acknowledgement or broadcast. Message creation and unread/summary updates use a MongoDB transaction when the deployment supports transactions; standalone development MongoDB uses an idempotent insert plus an atomic conversation update. The unique per-conversation message key prevents duplicate persisted messages. Do not interpret Socket.IO acknowledgements or emissions as exactly-once network delivery.

Conversation history is the durable recovery mechanism. On connect/reconnect the widget re-authorizes its conversation and fetches the most recent 100 persisted messages through the join acknowledgement; dashboard clients can use the `after` ISO timestamp cursor or the paginated HTTP history endpoint. Disconnected recipients therefore recover stored messages instead of relying on a volatile Socket.IO queue. Clients should deduplicate by persisted message ID and retry sends with the original `clientMessageId`.

Typing events are never persisted and are rate limited. Message, connection, and general event traffic have limits and a 64 KiB maximum Socket.IO packet size. Presence is calculated from all connected agent sockets in a workspace room, so one tab disconnecting does not mark another tab offline.

## Scaling and deployment

`REDIS_URL` enables the Socket.IO Redis adapter and shared Redis-backed HTTP and Socket.IO rate limits. Production startup requires Redis; if the socket rate limiter becomes unavailable, socket event processing fails closed. Development/tests may omit Redis and use per-process/in-memory limits. Use a MongoDB replica set or sharded cluster in production to enable transactions. Redis adapter/rate-limit deployment does not create exactly-once delivery; use stored message history for recovery.

The API sets heartbeat interval/timeout, connection timeout, payload limits, structured socket logs, and closes Socket.IO/Redis/MongoDB cleanly on `SIGINT` or `SIGTERM`.
