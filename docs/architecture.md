# Architecture

## Phase 1 foundation

The repository is an npm-workspaces monorepo. The dashboard, API, and embeddable widget are independently buildable applications; shared contracts live in `packages/shared`, while common TypeScript compiler settings live in `packages/config`.

The API is an Express application with separately maintained environment validation, MongoDB connection, logging, error handling, and health routes. The HTTP server starts only after MongoDB connects. `/health/live` measures process liveness; `/health/ready` returns `503` until the database is connected. Socket.IO is attached to the API HTTP server, with visitor and agent event handlers in separate modules.

The dashboard is a Next.js App Router application with public signup, login, agent login, email verification, password-reset, onboarding, and protected workspace pages. Its responsive dashboard shell loads the authenticated identity from the API and provides workspace selection and role-filtered navigation. The widget has a separate Vite library build and does not consume server credentials. Shared Zod schemas and TypeScript interfaces establish a common contract without coupling the browser applications to database models.

## Intended request and data boundaries

- The API is the only service that will access MongoDB.
- Dashboard and widget requests use separate HTTP interfaces; private credentials must remain on the API.
- Workspace ownership and membership must be established on authenticated server requests before tenant-scoped reads or writes.
- Public widget identifiers are not authentication credentials and must never authorize dashboard or agent actions.

## Tenant data and security foundation

Mongoose models live in `apps/api/src/models` and export users, workspaces, memberships, websites, visitors, conversations, messages, canned replies, invitations, notifications, audit records, subscription usage, sessions, one-time tokens, and idempotency records. Schemas are strict, timestamped where appropriate, and define named compound, uniqueness, and TTL indexes. Passwords use Argon2id; browser-issued widget IDs are generated from cryptographic random bytes and are identifiers, not authentication credentials.

Services in `apps/api/src/services` scope reads and writes to an authenticated user’s active workspace membership, validate IDs and inputs, whitelist mutable fields, derive agent sender identity from the actor, and audit administrative changes. Agents are restricted to unassigned or their own assigned conversations. Usage reservations use atomic conditional increments and month-boundary resets. Message client IDs are unique per conversation, making retried sends idempotent. Visitor erasure removes stored personal profile, location, device, and custom-attribute data while retaining conversation records for workspace history.

Authentication endpoints support registration with terms acceptance, single-use email verification, login, session refresh rotation and reuse detection, logout, current identity and workspace lookup, password reset, and current-session listing/revocation. Sessions use opaque random credentials in HTTP-only cookies, with only token hashes persisted. State-changing authenticated routes validate a double-submit CSRF cookie/header pair. Password reset revokes all active sessions. Authentication and reset responses avoid account enumeration; local development can return one-time action links when SMTP is not configured. Configure SMTP for real email delivery and use HTTPS in production.

Workspace onboarding creates workspace, owner membership, initial usage state, and audit record transactionally on replica-set MongoDB, with compensating cleanup for standalone development MongoDB. Website creation and widget configuration are tenant- and role-scoped. Owner/admin-only workspace detail access protects settings and billing metadata. Authenticated workspace APIs provide dashboard data.

The independent `apps/widget` Vite package builds an IIFE bundle for direct script-tag installation, with Shadow DOM styling and no host-page framework dependency. Widget initialization validates the public widget ID and requesting origin, returns only public settings, and issues an expiring signed visitor session bound to the visitor, website, and workspace. Conversation recovery, message history, profile collection, and message submission require that signed session and are scoped to its website/visitor. Socket.IO validates the visitor token before joining a conversation room; dashboard agents authenticate using the API session cookie and are checked for workspace membership and conversation access. Shared Zod socket contracts cover visitor and agent messages, conversation lifecycle, assignment, read receipts, typing, notifications, and presence. Message retries use conversation-scoped client IDs for idempotency; persisted history is the recovery path for disconnected recipients. The widget UI renders message bodies as text.

For local development, `WIDGET_DEV_MODE=true` permits localhost origins only when `NODE_ENV` is not production. It must remain disabled in production. `WIDGET_SESSION_SECRET` is an API-only secret and must be a unique value of at least 32 characters. The production bundle is `apps/widget/dist/widget.js`; deployment and CMS installation details are in [widget-installation.md](./widget-installation.md). Production API deployments require `REDIS_URL` for the Socket.IO Redis adapter and shared rate limiting, plus MongoDB replica-set/sharded-cluster support for message transactions. Protocol details, event payloads, acknowledgements, recovery behavior, and failure codes are in [socket-events.md](./socket-events.md) and [socket-protocol.md](./socket-protocol.md).

The management UI includes website configuration and widget-ID rotation, team/invitation controls, shared canned replies, workspace profile/settings, notification preferences, analytics, and plan usage reporting. Plan usage reservations are server-side and atomic. See [management.md](./management.md) for endpoints and calculation rules. Production headers include a dashboard CSP and API security headers. Missing capabilities are called out in [security.md](./security.md): attachment upload/object storage, automated retention jobs, payment processing, and full browser-based E2E coverage.

Index initialization is additive (`createIndexes`) during API startup and via `npm run db:indexes --workspace @live-chat/api`; it does not drop indexes. Use the deployment checklist in [deployment.md](./deployment.md). Production, external email delivery, Redis, and two-browser end-to-end behavior must be validated in their target environments before claiming deployment readiness.

`npm run db:seed --workspace @live-chat/api` creates an idempotent local owner/workspace/website using credentials from environment variables only. Tests use a pinned, ephemeral MongoDB binary and cover cross-workspace access, atomic usage caps, duplicate message retries, authentication and verification, CSRF enforcement, onboarding, refresh-token reuse detection, and logout revocation.
