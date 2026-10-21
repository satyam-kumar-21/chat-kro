# HTTP API reference

Base URL is the API origin. JSON request bodies are schema-validated. Dashboard endpoints use the `relay_session` cookie; write operations require `X-CSRF-Token` matching the `relay_csrf` cookie. Widget endpoints use the public widget ID for configuration selection plus the signed `Authorization: Bearer <visitorToken>` credential for visitor operations; the public ID alone cannot access a conversation.

Errors use `{ "error": { "code": "…", "message": "…" } }`. Unexpected server errors return a generic `INTERNAL_ERROR`. See route schemas in `apps/api/src/routes` and [socket-events.md](./socket-events.md).

## Health

| Method/path | Access | Purpose |
|---|---|---|
| `GET /health/live` | Public | Process liveness |
| `GET /health/ready` | Public | Dependency readiness |

## Authentication

| Method/path | Access | Purpose |
|---|---|---|
| `GET /auth/csrf` | Public | Issue CSRF cookie/token |
| `POST /auth/register` | Public, rate limited | Register; terms acceptance required |
| `POST /auth/verify-email` | Public, rate limited | Consume one-time verification token |
| `POST /auth/resend-verification` | Public, rate limited | Request verification resend |
| `POST /auth/login` | Public, rate limited | Create authenticated cookie session |
| `POST /auth/refresh` | Cookie + CSRF | Rotate refresh credential |
| `POST /auth/logout` | Auth + CSRF | Revoke current session |
| `POST /auth/password-reset` | Public, rate limited | Enumeration-resistant reset request |
| `POST /auth/reset-password` | Public, rate limited | Consume one-time reset token |
| `POST /auth/accept-invitation` | Auth + CSRF | Accept matching-email workspace invitation |
| `GET /auth/me` | Auth | Current user, session, memberships |
| `PATCH /auth/profile` | Auth + CSRF | Update own name/avatar |
| `GET /auth/preferences` | Auth | Read notification preferences |
| `PATCH /auth/preferences` | Auth + CSRF | Update notification preferences |
| `GET /auth/sessions` | Auth | List current user's sessions |
| `DELETE /auth/sessions/:sessionId` | Auth + CSRF | Revoke own session |

## Workspaces

All routes below require authentication and active membership unless a stricter role is specified. Write methods also require CSRF.

| Method/path | Additional role | Purpose |
|---|---|---|
| `GET /workspaces` | Member | List current user's workspaces |
| `POST /workspaces` | Authenticated user | Create workspace and owner membership |
| `GET /workspaces/:workspaceId` | Owner/admin | Read workspace settings |
| `PATCH /workspaces/:workspaceId` | Owner/admin | Update name/timezone/language/retention preference |
| `GET /workspaces/:workspaceId/usage` | Owner/admin | Read plan usage |
| `GET /workspaces/:workspaceId/plans` | Owner/admin | Read configured limits |
| `GET /workspaces/:workspaceId/analytics` | Member | Persisted-data metrics; optional ISO `from`/`to` (max one year) |
| `GET/POST /workspaces/:workspaceId/websites` | Read: member; write: owner/admin | List or create a website |
| `GET/PATCH /workspaces/:workspaceId/websites/:websiteId` | Read: member; write: owner/admin | Read/update website |
| `POST /workspaces/:workspaceId/websites/:websiteId/rotate-widget-id` | Owner/admin | Invalidate previous widget ID |
| `GET /workspaces/:workspaceId/members` | Member | List workspace members |
| `PATCH /workspaces/:workspaceId/members/:memberId/role` | Owner/admin | Update permitted role |
| `PATCH /workspaces/:workspaceId/members/:memberId/status` | Owner/admin | Activate/suspend member |
| `GET/POST /workspaces/:workspaceId/invitations` | Read/write: owner/admin | List/create invitations |
| `POST /workspaces/:workspaceId/invitations/:invitationId/resend` | Owner/admin | Replace invitation token and resend |
| `DELETE /workspaces/:workspaceId/invitations/:invitationId` | Owner/admin | Revoke invitation |
| `GET /workspaces/:workspaceId/conversations` | Member | Paginated/filterable inbox list |
| `PATCH /workspaces/:workspaceId/conversations/:conversationId` | Authorized member | Update status/priority/tags/subject |
| `GET/POST /workspaces/:workspaceId/conversations/:conversationId/messages` | Authorized member | Read/send messages |
| `POST /workspaces/:workspaceId/conversations/:conversationId/read` | Authorized member | Mark agent messages read |
| `GET/POST /workspaces/:workspaceId/conversations/:conversationId/notes` | Authorized member | Read/create internal notes |
| `GET /workspaces/:workspaceId/contacts` | Member | Search/list visitor contacts |
| `GET/POST /workspaces/:workspaceId/canned-replies` | Read: member; write: owner/admin/supervisor | List/search/create replies |
| `PATCH/DELETE /workspaces/:workspaceId/canned-replies/:replyId` | Owner/admin/supervisor | Update/delete reply |
| `GET /workspaces/:workspaceId/notifications` | Member | Read caller's notifications |
| `GET /workspaces/:workspaceId/onboarding` | Member | Read onboarding completion state |

## Public widget

| Method/path | Purpose |
|---|---|
| `POST /widget/init` | Validate widget/origin, return public config and signed visitor session |
| `POST /widget/conversation` | Create or recover authorized visitor conversation |
| `PATCH /widget/profile` | Update visitor profile only when collection is enabled |
| `GET /widget/:conversationId/messages` | Read authorized visitor message history |
| `POST /widget/:conversationId/messages` | Persist/idempotently submit visitor message |

Message body length and request rate are bounded. Responses omit workspace secrets and internal notes. No file upload route is currently available.
