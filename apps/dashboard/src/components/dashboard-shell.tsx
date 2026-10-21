"use client";

import Link from "next/link";
import { io } from "socket.io-client";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, Bell, Building2, CreditCard, DoorOpen, Globe2, LoaderCircle,
  MessagesSquare, Settings, Users, UserRound, UsersRound, Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest, clearCsrfToken, type AuthMeResponse, type WorkspaceItem } from "@/lib/api";

const navigation = [
  { label: "Inbox", href: "/dashboard/inbox", icon: MessagesSquare, roles: null },
  { label: "Contacts", href: "/dashboard/contacts", icon: Users, roles: null },
  { label: "Websites / Widgets", href: "/dashboard/websites", icon: Globe2, roles: null },
  { label: "Team", href: "/dashboard/team", icon: UsersRound, roles: ["owner", "admin", "supervisor"] },
  { label: "Canned replies", href: "/dashboard/canned-replies", icon: Zap, roles: null },
  { label: "Analytics", href: "/dashboard/analytics", icon: Activity, roles: null },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, roles: ["owner", "admin"] },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard, roles: ["owner", "admin"] },
  { label: "Profile", href: "/dashboard/profile", icon: UserRound, roles: null }
] as const;

type NotificationItem = { id: string; type: string; createdAt: string };

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("Connecting…");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    void apiRequest<AuthMeResponse>("/auth/me")
      .then((result) => {
        setAuth(result);
        const saved = window.localStorage.getItem("relay-chat-workspace");
        const matching = result.workspaces.find((item) => item.workspace?.id === saved);
        const chosen = matching ?? result.workspaces[0];
        if (chosen?.workspace) setWorkspaceId(chosen.workspace.id);
        else router.replace("/onboarding");
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
        else setError(cause instanceof Error ? cause.message : "Unable to load your account.");
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!auth) return;
    const socket = io(
      (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, ""),
      { withCredentials: true, reconnection: true, reconnectionAttempts: Infinity }
    );
    socket.on("connect", () => {
      setConnectionStatus("Connected");
      if (!workspaceId) return;
      socket.emit(
        "inbox:join",
        { workspaceId },
        (ack: { ok: boolean; error?: { message: string } }) => {
          if (!ack.ok) setError(ack.error?.message ?? "Unable to join the inbox.");
        }
      );
    });
    socket.on("disconnect", () => setConnectionStatus("Reconnecting…"));
    socket.on("connect_error", () => setConnectionStatus("Offline"));
    socket.on("notification:new", (notification: { id: string; type: string }) => {
      setNotifications((current) => [
        { id: notification.id, type: notification.type, createdAt: new Date().toISOString() },
        ...current.filter((item) => item.id !== notification.id)
      ].slice(0, 25));
    });
    return () => {
      socket.disconnect();
      setConnectionStatus("Connecting…");
    };
  }, [auth, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    window.localStorage.setItem("relay-chat-workspace", workspaceId);
    window.dispatchEvent(new CustomEvent("relay-workspace-change", { detail: workspaceId }));
    void apiRequest<{ notifications: NotificationItem[] }>(
      `/workspaces/${workspaceId}/notifications`
    ).then((result) => setNotifications(result.notifications)).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Unable to load notifications.");
    });
  }, [workspaceId]);

  const workspaceEntry = useMemo(
    () => auth?.workspaces.find((item) => item.workspace?.id === workspaceId),
    [auth, workspaceId]
  );
  const workspace = workspaceEntry?.workspace;
  const role = workspaceEntry?.role;
  const visibleNavigation = navigation.filter(
    (item) => !item.roles || (role && (item.roles as readonly string[]).includes(role))
  );

  async function logout() {
    setLoggingOut(true);
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      clearCsrfToken();
      window.localStorage.removeItem("relay-chat-workspace");
      router.replace("/login");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign out.");
      setLoggingOut(false);
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-slate-600"><LoaderCircle className="mr-2 animate-spin" size={18} />Loading dashboard…</main>;
  }
  if (error && !auth) {
    return <main className="mx-auto max-w-xl p-8"><p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p><Link href="/login" className="mt-4 inline-block text-sm text-blue-700 underline">Return to sign in</Link></main>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <Link href="/dashboard" className="flex h-16 items-center gap-2 border-b border-slate-200 px-5 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white"><MessagesSquare size={18} /></span>Relay Chat
        </Link>
        <div className="border-b border-slate-200 p-3">
          <label htmlFor="workspace-select" className="sr-only">Select workspace</label>
          <div className="mb-1 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500"><Building2 size={13} />Workspace</div>
          <select id="workspace-select" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="min-h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-medium">
            {(auth?.workspaces ?? []).map((item) => item.workspace ? <option key={item.workspace.id} value={item.workspace.id}>{item.workspace.name}</option> : null)}
          </select>
        </div>
        <nav aria-label="Dashboard" className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleNavigation.map(({ label, href, icon: Icon }) => {
            const active = pathname === href || (href !== "/dashboard/inbox" && pathname.startsWith(`${href}/`));
            return <Link key={href} href={href} className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm ${active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon size={17} />{label}</Link>;
          })}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <Link href="/loginlive" className="mb-2 flex min-h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"><DoorOpen size={15} />Agent login</Link>
          <button onClick={() => void logout()} disabled={loggingOut} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"><DoorOpen size={16} />{loggingOut ? "Signing out…" : "Sign out"}</button>
        </div>
      </aside>
      <div className="min-h-screen lg:pl-60">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{workspace?.name ?? "Workspace"}</div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><span className={`size-1.5 rounded-full ${connectionStatus === "Connected" ? "bg-green-500" : "bg-amber-500"}`} />{connectionStatus}</div>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="mobile-workspace-select" className="sr-only">Select workspace</label>
            <select id="mobile-workspace-select" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="max-w-36 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs md:max-w-48 lg:hidden">
              {(auth?.workspaces ?? []).map((item) => item.workspace ? <option key={item.workspace.id} value={item.workspace.id}>{item.workspace.name}</option> : null)}
            </select>
            <details className="relative">
              <summary aria-label={`Notifications (${notifications.length})`} className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"><Bell size={18} />{notifications.length > 0 ? <span className="absolute right-1 top-1 size-2 rounded-full bg-blue-600" /> : null}</summary>
              <div className="absolute right-0 top-11 z-20 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                <div className="mb-2 text-sm font-semibold">Notifications</div>
                {notifications.length ? <ul className="space-y-2">{notifications.map((item) => <li key={item.id} className="border-t border-slate-100 pt-2 text-xs text-slate-600">{item.type.replaceAll("_", " ")} <time className="block text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString()}</time></li>)}</ul> : <p className="py-3 text-xs text-slate-500">You’re all caught up.</p>}
              </div>
            </details>
            <div className="hidden max-w-44 truncate text-right sm:block"><div className="text-sm font-medium">{auth?.user.name}</div><div className="text-xs text-slate-500">{auth?.user.email}</div></div>
            <Link aria-label="Profile" href="/dashboard/profile" className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{auth?.user.name.charAt(0).toUpperCase()}</Link>
          </div>
        </header>
        <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          {visibleNavigation.map(({ label, href }) => (
            <Link key={href} href={href} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${pathname === href ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>
          ))}
        </nav>
        <main className="mx-auto max-w-7xl p-4 sm:p-6">
          {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export type { WorkspaceItem };
