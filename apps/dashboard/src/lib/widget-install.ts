export function widgetScriptUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WIDGET_SCRIPT_URL?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "development"
    ? "http://localhost:5173/src/index.ts"
    : "";
}

export function widgetApiUrl(): string {
  return (process.env.NEXT_PUBLIC_WIDGET_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

export function widgetInstallSnippet(widgetId: string): string {
  const scriptUrl = widgetScriptUrl();
  if (!scriptUrl) return "Set NEXT_PUBLIC_WIDGET_SCRIPT_URL to your deployed widget.js URL to generate the installation code.";
  const script = JSON.stringify(scriptUrl).replace(/</g, "\\u003c");
  const api = JSON.stringify(widgetApiUrl()).replace(/</g, "\\u003c");
  const id = JSON.stringify(widgetId).replace(/</g, "\\u003c");
  return `<script>\n  (function () {\n    var w = window;\n    var d = document;\n    var s = d.createElement("script");\n    s.src = ${script};\n    s.async = true;\n    s.dataset.widgetId = ${id};\n    s.dataset.apiUrl = ${api};\n    d.head.appendChild(s);\n  })();\n</script>`;
}
