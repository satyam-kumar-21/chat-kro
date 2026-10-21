"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, LoaderCircle, MessagesSquare } from "lucide-react";
import { ApiError, apiRequest, type AuthMeResponse } from "@/lib/api";
import { widgetInstallSnippet } from "@/lib/widget-install";

type WebsiteResult = {
  id: string;
  name: string;
  domain: string;
  publicWidgetId: string;
};

export function OnboardingWizard() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [step, setStep] = useState<"workspace" | "website" | "install">("workspace");
  const [website, setWebsite] = useState<WebsiteResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void apiRequest<AuthMeResponse>("/auth/me")
      .then(async (result) => {
        setAuth(result);
        if (result.workspaces.length > 0) {
          const active = result.workspaces[0];
          if (active?.workspace) {
            setWorkspaceId(active.workspace.id);
            const progress = await apiRequest<{
              completed: boolean;
              websites: WebsiteResult[];
            }>(`/workspaces/${active.workspace.id}/onboarding`);
            const firstSite = progress.websites[0];
            if (firstSite) {
              setWebsite(firstSite);
              setStep("install");
            } else {
              setStep("website");
            }
          }
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
        else setError(cause instanceof Error ? cause.message : "Unable to load onboarding.");
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name || name.length > 120) {
      setError("Workspace name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ workspace: { id: string } }>("/workspaces", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      setWorkspaceId(result.workspace.id);
      setStep("website");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function createWebsite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const domain = String(form.get("domain") ?? "").trim().toLowerCase();
    let origin = "";
    try {
      const normalized = domain.includes("://") ? new URL(domain) : new URL(`https://${domain}`);
      if (!["http:", "https:"].includes(normalized.protocol)) throw new Error();
      origin = normalized.origin;
    } catch {
      setError("Enter a valid website domain, such as example.com.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ website: WebsiteResult }>(
        `/workspaces/${workspaceId}/websites`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            domain: new URL(origin).host,
            allowedOrigins: [origin]
          })
        }
      );
      setWebsite(result.website);
      setStep("install");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add website.");
    } finally {
      setBusy(false);
    }
  }

  const installSnippet = website ? widgetInstallSnippet(website.publicWidgetId) : "";

  async function copyInstallSnippet() {
    try {
      await navigator.clipboard.writeText(installSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard access is unavailable. Select and copy the installation snippet.");
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-slate-600"><LoaderCircle className="mr-2 animate-spin" size={18} />Loading your account…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white"><MessagesSquare size={18} /></span>
          Relay Chat
        </Link>
        <section className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="mb-7 flex gap-2 text-xs font-medium text-slate-500" aria-label="Setup progress">
            <span className={step === "workspace" ? "text-blue-700" : "text-slate-500"}>1. Workspace</span>
            <span aria-hidden="true">/</span>
            <span className={step === "website" ? "text-blue-700" : "text-slate-500"}>2. Website</span>
            <span aria-hidden="true">/</span>
            <span className={step === "install" ? "text-blue-700" : "text-slate-500"}>3. Install</span>
          </div>
          {error ? <p role="alert" className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
          {step === "workspace" ? (
            <>
              <h1 className="text-2xl font-semibold text-slate-950">Create your workspace</h1>
              <p className="mt-2 text-sm text-slate-600">This is your team’s home for websites and conversations.</p>
              <form className="mt-6 space-y-4" onSubmit={createWorkspace}>
                <label className="block text-sm font-medium text-slate-700">Workspace name<input name="name" required minLength={1} maxLength={120} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
                <button disabled={busy} className="min-h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Creating…" : "Create workspace"}</button>
              </form>
            </>
          ) : null}
          {step === "website" ? (
            <>
              <h1 className="text-2xl font-semibold text-slate-950">Add your first website</h1>
              <p className="mt-2 text-sm text-slate-600">Set the origin where your chat widget is allowed to run.</p>
              <form className="mt-6 space-y-4" onSubmit={createWebsite}>
                <label className="block text-sm font-medium text-slate-700">Website name<input name="name" required minLength={1} maxLength={120} placeholder="Main website" className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
                <label className="block text-sm font-medium text-slate-700">Website domain<input name="domain" type="text" required maxLength={253} placeholder="example.com" className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" /><span className="mt-1 block text-xs font-normal text-slate-500">The exact https origin is allowlisted automatically.</span></label>
                <button disabled={busy} className="min-h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Adding website…" : "Add website"}</button>
              </form>
            </>
          ) : null}
          {step === "install" && website ? (
            <>
              <div className="flex size-10 items-center justify-center rounded-full bg-green-50 text-green-700"><Check size={20} /></div>
              <h1 className="mt-4 text-2xl font-semibold text-slate-950">Your website is ready</h1>
              <p className="mt-2 text-sm text-slate-600">Widget ID for <strong>{website.domain}</strong>. This public ID identifies the site and is not an agent login credential.</p>
              <div className="mt-5">
                <label htmlFor="widget-id" className="text-sm font-medium text-slate-700">Public widget ID</label>
                <input id="widget-id" readOnly value={website.publicWidgetId} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-slate-50 px-3 font-mono text-sm text-slate-700" />
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between"><label htmlFor="install-snippet" className="text-sm font-medium text-slate-700">Installation instructions</label><button type="button" disabled={!installSnippet.startsWith("<script>")} onClick={() => void copyInstallSnippet()} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"><Copy size={14} />{copied ? "Copied" : "Copy"}</button></div>
                <textarea id="install-snippet" readOnly rows={8} value={installSnippet} className="w-full resize-none rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-700" />
                <p className="mt-2 text-xs leading-5 text-amber-800">The website and public ID are saved now. The snippet is generated once widget bundle delivery is configured for this dashboard deployment.</p>
              </div>
              <button onClick={() => router.replace("/dashboard")} className="mt-6 min-h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Continue to dashboard</button>
            </>
          ) : null}
        </section>
        <p className="mt-4 text-center text-xs text-slate-500">Signed in as {auth?.user.email}</p>
      </div>
    </main>
  );
}
