"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { widgetApiUrl, widgetScriptUrl } from "@/lib/widget-install";

function WidgetDemoContent() {
  const router = useRouter();
  const search = useSearchParams();
  const initialId = search.get("widgetId") ?? "";
  const [widgetId, setWidgetId] = useState(initialId);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initialId) return;
    const url = widgetScriptUrl();
    if (!url) {
      setError("Set NEXT_PUBLIC_WIDGET_SCRIPT_URL to your deployed widget bundle URL.");
      return;
    }
    if (!/^[A-Za-z0-9_-]{32}$/.test(initialId)) {
      setError("Enter a valid public widget ID.");
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = url;
    script.dataset.widgetId = initialId;
    script.dataset.apiUrl = widgetApiUrl();
    script.onload = () => setLoaded(true);
    script.onerror = () => setError("Widget script failed to load.");
    document.head.append(script);
    return () => script.remove();
  }, [initialId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = widgetId.trim();
    if (!/^[A-Za-z0-9_-]{32}$/.test(value)) {
      setError("Enter a valid public widget ID from a website in your workspace.");
      return;
    }
    router.push(`/widget-demo?widgetId=${encodeURIComponent(value)}`);
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-10">
    <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <Link href="/" className="text-sm font-semibold text-blue-700">Relay Chat</Link>
      <h1 className="mt-5 text-2xl font-semibold">Website widget demo</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Enter a website’s public widget ID to load the real widget and test the server-backed conversation flow. The ID is public site configuration, never an agent credential.</p>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
        <label className="sr-only" htmlFor="demo-widget-id">Public widget ID</label>
        <input id="demo-widget-id" value={widgetId} onChange={(event) => setWidgetId(event.target.value)} maxLength={64} className="min-h-11 flex-1 rounded-md border border-slate-300 px-3 font-mono text-sm" placeholder="Public widget ID" />
        <button className="min-h-11 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700">Load widget</button>
      </form>
      {error ? <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {loaded && !error ? <p role="status" className="mt-4 text-sm text-green-700">Widget script loaded. Use the launcher at the bottom-right or bottom-left.</p> : null}
      <p className="mt-5 text-xs text-slate-500">To test from localhost, configure <code>WIDGET_DEV_MODE=true</code> for a non-production API and add the local origin to the website allowlist.</p>
    </div>
  </main>;
}

export default function WidgetDemoPage() {
  return <Suspense fallback={<main className="p-8 text-sm text-slate-600">Loading demo…</main>}><WidgetDemoContent /></Suspense>;
}
