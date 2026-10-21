# Security model and audit checklist

## Authentication and sessions

- Passwords are Argon2id hashes and are never returned in API responses.
- Dashboard authentication uses opaque HTTP-only cookies; only refresh-token hashes are stored. Refresh rotation has reuse detection and session revocation; logout and password reset revoke sessions.
- Session and CSRF cookies are `SameSite=Strict`; secure cookies are enabled in production. Authenticated state changes require the CSRF cookie/header pair.
- Verification, password reset, and invitation tokens are single-use, expiring, randomly generated, and stored as hashes. Registration/reset responses avoid account enumeration. Email is required to accept an invitation.
- `loginlive` uses the same server authentication and workspace membership checks; the widget ID is not an agent credential.

## Tenant boundaries and public widget

- Every dashboard service authorizes the authenticated user and checks active workspace membership; sensitive routes further restrict roles.
- Socket.IO agent identity comes from the server session. Visitor sockets require a signed visitor session bound to a website, visitor, workspace, and origin. The server validates room joins and each privileged action; room names are not authorization.
- Public widget IDs select public configuration only. Widget Origin allowlists reduce browser cross-origin abuse but are not identity proof. Visitor sessions provide authorization for visitor conversation access.
- Widget content is rendered as text. Input schemas are strict, mutable fields are whitelisted, user search strings are escaped before regex construction, and database IDs are validated. Text fields are sanitized as defense in depth.
- Public widget CORS is separated from fixed-origin dashboard CORS. Localhost bypass is only enabled with `WIDGET_DEV_MODE=true` outside production.

## Abuse, headers, secrets, and operations

- Registration, login, verification, password reset, widget initialization, and message submissions have rate limits. Socket events have per-actor rate limits and bounded packet size. Production requires Redis for shared rate limiting and Socket.IO scaling.
- The API emits no-sniff, frame-denial, referrer, permissions, and production HSTS headers. Dashboard responses set a CSP restricting scripts/connections to the app, configured API, and configured widget script origin, with inline allowances for Next.js runtime compatibility.
- Secrets are read from environment variables. Production rejects the known development widget secret and requires Redis. Never put secrets in `NEXT_PUBLIC_*` variables.
- Errors returned to clients use stable generic messages; unexpected errors are logged server-side. Avoid logging request bodies, cookies, tokens, or message content.
- Administrative changes write workspace-scoped audit records with allowlisted metadata. Visitor personal-data erasure is owner/admin-authorized and audited.
- MongoDB indexes are initialized additively at API startup; production should use authenticated/private Atlas networking, TLS, least-privilege database users, backups, and restore tests.

## Known control gaps and audit scope

- File upload and object storage endpoints are not implemented. No upload is accepted; do not expose an upload route until it validates type/size, scans content, uses private object storage, and authorizes each download.
- Workspace retention days are stored but automated deletion scheduling is not implemented. Apply an operational/legal retention policy before production use.
- No payment provider is connected; client-side state cannot activate a paid plan.
- Current automated tests cover API auth/onboarding, widget isolation, tenant authorization, Socket.IO behavior, usage limits, message idempotency, and frontend widget bootstrap. They do not constitute a full browser-based, multi-device E2E security certification.
- A repository security-review agent inspected the application and reported no exploitable vulnerabilities in its review. This is not a substitute for external penetration testing, dependency monitoring, or infrastructure review.

Run `npm audit` against the committed lockfile before release and review advisories for the precise deployed dependency graph. A clean audit does not verify runtime configuration or infrastructure.
