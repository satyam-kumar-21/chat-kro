# Production deployment runbook

This is a deployment plan, not a record of a deployment. The application has not been deployed or verified against external production infrastructure.

## Topology

1. **Dashboard:** deploy `apps/dashboard` as a Next.js application on Vercel. Configure `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WIDGET_API_URL`, and `NEXT_PUBLIC_WIDGET_SCRIPT_URL` for the production HTTPS API and widget asset. Those values are public; do not place credentials there. Set `WEB_ORIGIN` on the API to the exact dashboard origin.
2. **API and Socket.IO:** deploy `apps/api` on a persistent Node.js runtime (VPS, ECS, or equivalent long-running container), not a short-lived serverless function. Build the workspace from the monorepo root and start with `npm run start --workspace @live-chat/api`. Keep port 4000 private behind a TLS reverse proxy or load balancer. Configure WebSocket upgrade and long-lived connection support.
3. **MongoDB:** use MongoDB Atlas or a private managed MongoDB deployment with TLS, private networking/IP restrictions, least-privilege credentials, automated backups, point-in-time recovery where available, and periodically tested restores. Use a replica set/sharded cluster to enable message/workspace transactions.
4. **Redis:** set `REDIS_URL` to a private, authenticated TLS Redis service for shared HTTP/socket rate limits and cross-instance Socket.IO rooms. Production API startup fails without Redis.
5. **Email:** configure a transactional SMTP relay (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) and validate domain SPF, DKIM, and DMARC. Development-only one-time URLs are not returned in production.
6. **Attachments:** no attachment endpoint exists yet. When implemented, use private object storage (for example S3) with short-lived signed URLs, server-enforced size/type policy, malware scanning, and authorization checks. Do not store public credentials in the widget.

## Environment variables

Copy the API settings from the root `.env.example` into the API runtime environment. Configure the dashboard variables in Vercel (or locally in `apps/dashboard/.env.local`, based on `apps/dashboard/.env.example`).

| Variable | Where | Production requirement |
|---|---|---|
| `NODE_ENV` | API | `production` |
| `API_HOST`, `API_PORT` | API | Bind the configured internal interface/port |
| `MONGODB_URI` | API | TLS-enabled private/managed replica-set URI; store as a secret |
| `REDIS_URL` | API | Private TLS Redis URL; required by production startup |
| `WEB_ORIGIN` | API | Exact HTTPS dashboard origin, no path |
| `WIDGET_SESSION_SECRET` | API | Unique random secret, 32+ characters; never share with frontend |
| `WIDGET_DEV_MODE` | API | `false` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | API | Production transactional email values; password stored as a secret |
| `NEXT_PUBLIC_API_URL` | Dashboard | HTTPS API origin |
| `NEXT_PUBLIC_WIDGET_API_URL` | Dashboard | HTTPS API origin |
| `NEXT_PUBLIC_WIDGET_SCRIPT_URL` | Dashboard | HTTPS static widget bundle URL |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Local seed only | Leave unset in production; never seed a production administrator this way |

Never deploy the development values in `.env.example`; rotate secrets after suspected exposure.

## DNS, TLS, and reverse proxy

Create DNS records for the dashboard, API, and static widget host. Issue and automatically renew TLS certificates for each hostname. Dashboard uses HTTPS; browsers then use WSS to the API. Configure the API proxy with HTTP/1.1 WebSocket upgrade headers, correct forwarding headers, request body limits, and a generous connection timeout. Preserve the `Origin` header for API origin checks. Do not enable permissive credentialed CORS.

Example Nginx location for Socket.IO and API traffic:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Restrict direct access to the API port. Set trust-proxy behavior carefully if rate limiting relies on client IP; do not blindly trust user-supplied forwarding headers.

## Build and release order

1. Provision MongoDB, Redis, DNS/TLS, SMTP, and secrets. Test connectivity from the API runtime.
2. Install the committed dependency graph with `npm ci`; run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` from the repository root.
3. Back up production data. Review existing records for any new unique-index collisions.
4. Deploy API code and initialize indexes with `npm run db:indexes --workspace @live-chat/api`. API startup also creates missing schema indexes; it does not drop indexes.
5. Start the persistent API service and verify `GET /health/live`, `GET /health/ready`, email delivery, dashboard login, widget initialization, and a two-client Socket.IO flow.
6. Deploy the dashboard with the exact public API/widget URLs and `WEB_ORIGIN`; validate browser CSP and credentialed API CORS.
7. Publish `apps/widget/dist/widget.js` to the configured HTTPS static URL with immutable/versioned cache policy. Test the copied installation code against a configured website origin.
8. Monitor health, errors, Redis/MongoDB connections, rate limits, delivery bounces, and resource consumption.

## Health, logs, backups, and rollback

- Liveness: `GET /health/live`; readiness: `GET /health/ready` (MongoDB must be connected).
- Forward structured API logs to a managed log service with access controls and retention. Scrub secrets, cookies, tokens, visitor message text, and sensitive personal data; rotate local logs if used.
- Alert on failed readiness, repeated 5xx, Redis loss, MongoDB connection pressure, disk/storage growth, elevated auth failures, and email delivery failure.
- Back up MongoDB automatically and test restore procedures. Redis is operational state; configure persistence/HA according to the provider and expected rate-limit/socket behavior.
- For rollback, redeploy the previous compatible API/dashboard/widget artifacts. Since index creation is additive, keep newly created indexes unless a separately reviewed migration requires removal. Back up before data migrations and use forward-fix plans for schema changes; do not drop production data or indexes during an application rollback.
- Shut down gracefully with `SIGTERM`; the API closes Socket.IO, Redis, and MongoDB connections.
