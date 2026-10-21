"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api";
import { AuthCard } from "./auth-card";

const fieldClass =
  "mt-1 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
const labelClass = "block text-sm font-medium text-slate-700";
const buttonClass =
  "inline-flex min-h-10 w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

type FormStatus = { kind: "error" | "success" | "info"; message: string };

function StatusMessage({ status }: { status: FormStatus | null }) {
  if (!status) return null;
  const color =
    status.kind === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : status.kind === "success"
        ? "border-green-200 bg-green-50 text-green-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return <p role="status" className={`rounded-md border p-3 text-sm ${color}`}>{status.message}</p>;
}

export function SignupForm() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FormStatus | null>(null);
  const [verificationUrl, setVerificationUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const acceptedTerms = form.get("acceptedTerms") === "on";
    if (name.length < 1 || name.length > 120 || !email || password.length < 12 || password.length > 128 || !acceptedTerms) {
      setStatus({ kind: "error", message: "Enter a valid name and email, use at least 12 password characters, and accept both policies." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await apiRequest<{ message: string; developmentVerificationUrl?: string }>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({ name, email, password, acceptedTerms: true })
        }
      );
      setStatus({ kind: "success", message: result.message });
      setVerificationUrl(result.developmentVerificationUrl ?? "");
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Registration failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start a workspace for your customer conversations."
      footer={<span className="text-slate-600">Already have an account? <Link className="font-medium text-blue-700 hover:underline" href="/login">Log in</Link></span>}
    >
      <form className="space-y-4" onSubmit={submit}>
        <label className={labelClass}>Your name<input name="name" autoComplete="name" required maxLength={120} className={fieldClass} /></label>
        <label className={labelClass}>Work email<input name="email" type="email" autoComplete="email" required maxLength={254} className={fieldClass} /></label>
        <label className={labelClass}>Password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={fieldClass} /><span className="mt-1 block text-xs font-normal text-slate-500">Use at least 12 characters.</span></label>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input name="acceptedTerms" type="checkbox" required className="mt-1 accent-blue-600" />
          <span>I accept the <a href="/terms" className="text-blue-700 underline">Terms</a> and <a href="/privacy" className="text-blue-700 underline">Privacy Policy</a>.</span>
        </label>
        <StatusMessage status={status} />
        {verificationUrl ? <Link className="block break-all text-sm font-medium text-blue-700 underline" href={verificationUrl}>Verify your email (development)</Link> : null}
        <button className={buttonClass} disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
    </AuthCard>
  );
}

export function LoginForm({ live = false }: { live?: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FormStatus | null>(
    search.get("verified") === "1"
      ? { kind: "success", message: "Email verified. Sign in to continue." }
      : search.get("reset") === "1"
        ? { kind: "success", message: "Password reset. Sign in with your new password." }
        : null
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setBusy(true);
    setStatus(null);
    try {
      const result = await apiRequest<{ workspaces: { id: string; role: string }[] }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) }
      );
      if (result.workspaces.length === 0) {
        router.replace("/onboarding");
      } else if (live && result.workspaces.length > 1) {
        router.replace("/dashboard");
      } else {
        router.replace("/dashboard");
      }
      router.refresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to sign in."
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={live ? "Agent sign in" : "Welcome back"}
      description={live ? "Sign in with your Relay Chat agent account. A widget ID is never used to sign in." : "Sign in to manage your workspace and customer conversations."}
      footer={<span className="text-slate-600">New to Relay Chat? <Link className="font-medium text-blue-700 hover:underline" href="/signup">Create an account</Link></span>}
    >
      <form className="space-y-4" onSubmit={submit}>
        <label className={labelClass}>Email<input name="email" type="email" autoComplete="username" required maxLength={254} className={fieldClass} /></label>
        <label className={labelClass}>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} className={fieldClass} /></label>
        <div className="flex justify-end"><Link className="text-sm font-medium text-blue-700 hover:underline" href="/forgot-password">Forgot password?</Link></div>
        <StatusMessage status={status} />
        <button className={buttonClass} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FormStatus | null>(null);
  const [resetUrl, setResetUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string; developmentResetUrl?: string }>(
        "/auth/password-reset",
        { method: "POST", body: JSON.stringify({ email }) }
      );
      setStatus({ kind: "success", message: result.message });
      setResetUrl(result.developmentResetUrl ?? "");
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Reset your password" description="If there is an account for that email, we’ll send reset instructions." footer={<Link className="font-medium text-blue-700 hover:underline" href="/login">Back to login</Link>}>
      <form className="space-y-4" onSubmit={submit}>
        <label className={labelClass}>Email<input name="email" type="email" autoComplete="email" required maxLength={254} className={fieldClass} /></label>
        <StatusMessage status={status} />
        {resetUrl ? <Link href={resetUrl} className="block break-all text-sm text-blue-700 underline">Reset password (development)</Link> : null}
        <button className={buttonClass} disabled={busy}>{busy ? "Sending…" : "Send reset instructions"}</button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FormStatus | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const token = search.get("token") ?? "";
    if (password.length < 12 || password.length > 128 || !token) {
      setStatus({ kind: "error", message: "The reset link or password is invalid." });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      router.replace("/login?reset=1");
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Unable to reset password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" description="Use at least 12 characters. This will sign out your other active sessions." footer={<Link href="/login" className="font-medium text-blue-700 hover:underline">Back to login</Link>}>
      <form className="space-y-4" onSubmit={submit}>
        <label className={labelClass}>New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={fieldClass} /></label>
        <StatusMessage status={status} />
        <button className={buttonClass} disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmailForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState<FormStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const token = search.get("token") ?? "";

  async function verify() {
    setBusy(true);
    try {
      await apiRequest("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
      router.replace("/login?verified=1");
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Verification failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Verify your email" description="Confirm your email to activate your account and create a workspace." footer={<Link href="/login" className="font-medium text-blue-700 hover:underline">Go to login</Link>}>
      <div className="space-y-4">
        {!token ? <StatusMessage status={{ kind: "error", message: "Verification token is missing." }} /> : null}
        <StatusMessage status={status} />
        <button className={buttonClass} onClick={() => void verify()} disabled={busy || !token}>{busy ? "Verifying…" : "Verify email"}</button>
      </div>
    </AuthCard>
  );
}
