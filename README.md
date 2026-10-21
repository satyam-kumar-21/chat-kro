# Live Chat SaaS

An original, multi-tenant live chat SaaS foundation organized as an npm-workspaces monorepo.

## Requirements

- Node.js 20.19 or later
- npm 10 or later
- MongoDB for API readiness and database-backed development

## Setup

1. Install dependencies from the repository root:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and adjust the local MongoDB connection if needed.
3. Start MongoDB.
4. Start the API and dashboard:

   ```sh
   npm run dev
   ```

The dashboard is served at `http://localhost:3000`. The API listens at `http://localhost:4000` by default. `GET /health/live` reports process liveness; `GET /health/ready` reports whether MongoDB is connected.

## Authentication and onboarding

Visit `/signup` to register. With SMTP configured, email verification and password-reset links are delivered using the configured sender. Without SMTP, development responses include one-time links for local testing. After verifying the email, sign in at `/login` or `/loginlive`; an account without a workspace is guided through workspace and first-website setup. The dashboard uses an opaque, HTTP-only session cookie, double-submit CSRF tokens for state-changing authenticated requests, rotating refresh credentials, and server-side session revocation on logout or password reset. Do not use development links in a production environment.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env` for email delivery. Production deployments must use HTTPS so session and CSRF cookies are marked secure, and must set `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` to the deployment origins. Set `NEXT_PUBLIC_WIDGET_SCRIPT_URL` and `NEXT_PUBLIC_WIDGET_API_URL` to the deployed widget bundle and API URLs to generate copyable website installation snippets.

The auth flow and workspace onboarding are backed by the API. Workspace creation writes the workspace, owner membership, usage record, and audit entry in one transaction when MongoDB transactions are supported, with a compensating fallback for standalone local MongoDB. Website settings provide an embeddable widget installation snippet and appearance editor. Follow [docs/widget-installation.md](./docs/widget-installation.md) to build, deploy, or run the widget locally.

To create a local owner, workspace, and website, set `SEED_ADMIN_EMAIL` and a unique `SEED_ADMIN_PASSWORD` (12 or more characters) in `.env`, then run `npm run db:seed --workspace @live-chat/api`. The seed is safe to rerun for the same local owner.

To work on the independent widget package, run `npm run dev:widget` in a separate terminal. `apps/widget/dist/widget.js` is the production IIFE bundle produced by `npm run build`. Common checks are available as `npm run build`, `npm run lint`, `npm run typecheck`, and `npm test`.

## Workspace layout

- `apps/dashboard`: Next.js App Router application
- `apps/api`: Express API, MongoDB connection, logging, health endpoints, and tests
- `apps/widget`: Vite-built TypeScript widget bundle
- `packages/shared`: shared runtime validation schemas and TypeScript types
- `packages/config`: shared TypeScript configuration
- `infra`: local infrastructure examples
- `docs`: architecture and implementation notes

Workspace services require an authenticated actor ID and then verify active account status and membership before tenant-scoped operations. Passwords use Argon2id. Session and one-time token hashes are excluded from ordinary queries and JSON serialization; refresh tokens are opaque and rotated atomically with reuse detection. Cookie settings, CSRF validation, fixed-origin dashboard CORS, per-website widget CORS/origin validation, and route-specific rate-limit middleware are in the API security modules. Visitor widget sessions are separately signed and scoped to a website and visitor; a public widget ID or visitor ID is not dashboard authentication.

The widget initializes through public API routes, persists visitor conversations and messages, and connects to the API Socket.IO server for live messages, typing, read receipts, and conversation status. Agent access remains cookie-authenticated and tenant-scoped. Production requires `REDIS_URL` for shared HTTP/socket rate limits and the Socket.IO Redis adapter. Use a MongoDB replica set or sharded cluster to enable transaction-backed message persistence. See [docs/socket-protocol.md](./docs/socket-protocol.md) for event names, payloads, acknowledgement formats, authorization, and reconnect recovery.
