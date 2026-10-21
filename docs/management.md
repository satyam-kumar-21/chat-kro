# Website, team, analytics, and plan management

All endpoints below require an authenticated dashboard session. State-changing requests also require the session's CSRF token. Workspace IDs and child resource IDs are checked against the authenticated user's membership on the server.

## Websites

- `GET /workspaces/:workspaceId/websites` lists workspace websites and safe widget settings.
- `POST /workspaces/:workspaceId/websites` creates a website. The server generates its random public widget ID.
- `GET /workspaces/:workspaceId/websites/:websiteId` and `PATCH /workspaces/:workspaceId/websites/:websiteId` read and update a workspace-owned website.
- `POST /workspaces/:workspaceId/websites/:websiteId/rotate-widget-id` replaces the ID immediately. The prior ID stops resolving; update every installed snippet after rotation.

Only owners and admins can create, update, or rotate websites. Allowed origins must be exact HTTP(S) origins. A public widget ID is a configuration lookup key, never an agent credential.

## Team and canned replies

- `GET /workspaces/:workspaceId/members` lists members and their roles/status.
- `PATCH /workspaces/:workspaceId/members/:memberId/role` changes a permitted role.
- `PATCH /workspaces/:workspaceId/members/:memberId/status` activates or suspends a member.
- `GET /workspaces/:workspaceId/invitations` lists pending invitations, including expired invitations that can be resent.
- `POST /workspaces/:workspaceId/invitations` creates a hashed, seven-day invitation token. `POST /workspaces/:workspaceId/invitations/:invitationId/resend` replaces it; `DELETE` revokes it.
- `POST /auth/accept-invitation` accepts the token only for a verified active user with the invited email.
- `GET`, `POST`, `PATCH`, and `DELETE /workspaces/:workspaceId/canned-replies` list/search and manage workspace-shared replies. Creation/editing/deletion requires owner, admin, or supervisor membership.

An admin cannot grant the admin role or manage an admin; only owners can grant admin. Owner memberships cannot be edited through member controls. Active-member and website plan quotas are reserved atomically by backend services.

## Workspace and notification settings

- `GET` and `PATCH /workspaces/:workspaceId` read and update workspace name, IANA timezone, language, and configured data-retention preference. Only owners/admins can access these settings.
- `GET /auth/preferences` and CSRF-protected `PATCH /auth/preferences` persist per-user sound and desktop-notification preferences. The browser asks for notification permission only after the user enables the option.

The retention value is a saved policy preference only: automated retention/deletion jobs are not configured. Message attachments/file upload are not implemented, so `fileStorageBytes` is a configured quota but is not yet consumed by upload operations.

## Analytics definitions

`GET /workspaces/:workspaceId/analytics?from=<ISO>&to=<ISO>` accepts a chronological range of at most one year (UTC; `to` is exclusive).

- Conversation totals and status counts include conversations created within the selected range.
- Per-website and per-agent counts group those conversations by their website and current assignment; unassigned conversations have their own group.
- First response time is the elapsed time between the first visitor message and the first agent message at or after it. Conversations without a qualifying response and negative/invalid intervals are excluded; the response includes the sample count.
- Resolution time is `closedAt - createdAt` for conversations currently marked resolved with a valid nonnegative interval; other conversations are excluded and the sample count is returned.
- Message volume counts persisted, non-deleted messages created in the selected range and reports visitor/agent subtotals by UTC day.

These are operational metrics, not billing statements. Assignment and status are current persisted values; historical assignment/status attribution is not reconstructed.

## Plans and usage

`GET /workspaces/:workspaceId/usage` and `/plans` are restricted to owners and admins. The API owns the plan-to-limit mapping and performs atomic counter reservations before website creation, invitation acceptance, conversation creation, and message persistence. Limits currently live in `apps/api/src/services/usage-service.ts`; no client request can set a plan or subscription as paid. No payment provider or payment webhook is configured.

Usage updates are compensated when the corresponding resource write fails. As with other multi-document writes outside MongoDB transactions, a process crash between a reservation and its compensation can require operational reconciliation. Monthly conversation/message counters roll over at the start of the UTC calendar month.
