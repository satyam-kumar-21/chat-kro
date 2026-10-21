# Database schema and index initialization

MongoDB is accessed only by the Express API through Mongoose. Models are defined under `apps/api/src/models`; all tenant-owned records include `workspaceId`, and tenant services derive that scope from an authenticated membership or a signed visitor session. External IDs are validated before queries; callers cannot set workspace ownership, agent sender identity, roles, or usage plan fields through generic request bodies.

## Collections

| Collection | Purpose and key fields |
|---|---|
| `users` | Account name/email, Argon2id password hash (excluded by default), verification/avatar/status, login timestamp, notification preferences |
| `sessions` | User reference, current/previous refresh-token hashes, expiry/revocation, limited request metadata |
| `emailverificationtokens`, `passwordresettokens` | Single-use, hashed token, expiry, use timestamp; TTL expiry indexes |
| `workspaces` | Name, unique slug, owner, plan/subscription state, timezone/language/retention preference |
| `workspacemembers` | Workspace/user references, owner/admin/supervisor/agent role, active/invited/suspended state |
| `websites` | Workspace, name/domain, exact allowed origins, random unique 32-character public widget ID, public appearance/schedule settings, active/disabled state |
| `visitors` | Workspace/website scope, random visitor key, optional visitor-provided profile, first/last seen, limited page/referrer and device metadata, consent and custom attributes |
| `conversations` | Workspace/website/visitor scope, assignment, open/pending/resolved status, priority/tags, latest message summary, unread counts, resolution timestamp |
| `messages` | Workspace/conversation scope, sender type/server-derived sender, text body, attachments metadata, per-conversation idempotency ID, creation/edit/delete timestamps |
| `cannedreplies` | Workspace, shared title/shortcut/body, creator |
| `invitations` | Workspace/email/role, unique token hash, expiry, acceptance, inviter |
| `notifications` | Workspace/user, safe payload, read timestamp |
| `auditlogs` | Workspace/actor/action/resource and limited, allowlisted change metadata |
| `subscriptionusages` | One workspace counter record, website/member totals, monthly conversation/message counters, storage bytes, UTC period start |
| `idempotencyrecords` | Workspace-scoped request key/resource/status and TTL expiry for supported idempotent flows |
| `internalnotes` | Workspace/conversation/author and text; never part of visitor message history |

## Indexes

Schema-defined indexes enforce uniqueness and support tenant-scoped lookups: unique user email, workspace slug, membership pair, widget ID, website/visitor pair, workspace/canned-reply shortcut, workspace/pending invitation email, workspace usage row, per-conversation client message ID, and workspace idempotency key. Compound indexes cover member lookup by user/status, website listing, conversation inbox/status/assignment/unread activity, visitor recency, message timeline, notifications, audit timeline, and internal-note timeline. Session and one-time-token expiry indexes use MongoDB TTL cleanup.

`npm run db:indexes --workspace @live-chat/api` connects to the configured database, calls `createIndexes()` for registered schemas, and exits. API startup also creates missing indexes before listening. This is additive index initialization; it does not drop indexes. Before introducing a new unique constraint on an existing production collection, inspect and resolve duplicate data, back up the database, then deploy the code/index change. Use a replica set or sharded cluster for MongoDB transactions.

No attachment binary store or automated personal-data retention worker is configured. Visitor erasure is an authenticated, audited service operation; workspace retention days are a saved policy preference and do not yet cause automatic deletion.
