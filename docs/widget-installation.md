# Website chat widget installation

Relay Chat's widget is a standalone JavaScript bundle. A customer website does not need React, Next.js, or an npm dependency.

## Production setup

1. Build the bundle from the repository root:

   ```sh
   npm run build --workspace @live-chat/widget
   ```

   The output is `apps/widget/dist/widget.js`. Publish it at a stable HTTPS URL accessible to customer websites, such as `https://static.example.com/widget.js`.

2. Configure the dashboard and API:

   - Set `NEXT_PUBLIC_WIDGET_SCRIPT_URL` to the public bundle URL.
   - Set `NEXT_PUBLIC_WIDGET_API_URL` to the public API origin (for example, `https://api.example.com`).
   - Set `NEXT_PUBLIC_API_URL` and `WEB_ORIGIN` to the dashboard's deployment API and origin as documented in the root README.
   - Set `WIDGET_SESSION_SECRET` to a unique random secret of at least 32 characters. This secret is API-only; do not put it in the dashboard or widget environment.
   - Keep `WIDGET_DEV_MODE=false` in production.

3. In the dashboard, create a website and configure its exact allowed origin, including scheme and non-default port where applicable (for example, `https://shop.example.com`). Configure its appearance, then copy the generated snippet from the website settings page.

4. Add the snippet before the closing `</body>` tag on the allowed website:

   ```html
   <script>
     (function () {
       var d = document;
       var s = d.createElement("script");
       s.src = "https://static.example.com/widget.js";
       s.async = true;
       s.dataset.widgetId = "PUBLIC_WIDGET_ID";
       s.dataset.apiUrl = "https://api.example.com";
       d.head.appendChild(s);
     })();
   </script>
   ```

   Use the dashboard-generated snippet for the actual widget ID and configured URLs. Do not share a widget ID across websites.

## CMS and website builders

The supported integration is a normal custom HTML/script embed. Add the generated snippet to a site-wide footer/body code-injection area, or use the CMS's official custom HTML block when it is rendered on every page. Some platforms strip scripts from page content or restrict them to paid plans; in those cases, use the platform's supported site-wide header/footer code-injection feature. A platform-specific plugin is not required or included.

## Content Security Policy

If the host website enforces CSP, allow the deployed widget bundle host in `script-src`, the API origin and its WebSocket/Secure WebSocket endpoint in `connect-src`, and the configured logo host in `img-src` if a logo is used. The widget injects its isolated Shadow DOM stylesheet, so review the site's `style-src` policy and browser console for blocked styles. Do not weaken a site's policy globally; scope any required allowances to the widget's origins and validate them in the target browser.

Use HTTPS for the host page, widget bundle, and API to avoid mixed-content blocking. The widget sends its website origin for server-side allowlist checks, but the `Origin` header is not treated as strong authentication. Visitor API and socket operations additionally require a signed, expiring visitor session.

## Local development preview

1. Start MongoDB and configure `.env` using `.env.example`.
2. Set `WIDGET_DEV_MODE=true` in the API environment. This only permits localhost origins outside production; never enable it in production.
3. Start the API/dashboard with `npm run dev`, and start Vite in another terminal with `npm run dev:widget`.
4. Create a website in the dashboard. Open `http://localhost:5173/?widgetId=YOUR_PUBLIC_WIDGET_ID` to load the Vite preview against the local API. For testing an installation on another local page, configure the dashboard's local script URL and API URL, then add its generated snippet to that page.

The development preview requires a real website record and public widget ID. Browser storage may be unavailable in private or restricted contexts; the widget falls back to an in-memory visitor identifier for that page session.

## Scope and limitations

The widget currently supports text conversations, visitor profile fields enabled in website settings, appearance customization, availability schedule display, and real-time message/presence events supported by the API. File attachment upload/storage and a complete agent inbox interface are not implemented. The automated widget UI test uses a DOM test environment; API tests cover origin, visitor-token, and cross-website conversation/message isolation. They do not substitute for validating a deployment on external customer domains.
