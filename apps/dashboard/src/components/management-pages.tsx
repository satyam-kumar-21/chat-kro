"use client";

import Link from "next/link";
import { io } from "socket.io-client";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest, type AuthMeResponse } from "@/lib/api";

type WorkspaceContext = { id: string; role: string };
type Member = { id: string; userId: string | null; name: string; email: string; role: string; status: string };
type Invitation = { id: string; email: string; role: string; expiresAt: string; createdAt: string };
type Reply = { id: string; title: string; shortcut: string; body: string };
type Website = { id: string; name: string; domain: string; status: string; publicWidgetId: string };
type Usage = {
  plan: string;
  subscriptionStatus: string;
  limits: Record<string, number>;
  usage: Record<string, number | string>;
};
const fieldClass = "min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm";
const primaryButton = "min-h-9 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

function useWorkspaceContext() {
  const [context, setContext] = useState<WorkspaceContext>({ id: "", role: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const select = async (requestedId?: string) => {
      try {
        const auth = await apiRequest<AuthMeResponse>("/auth/me");
        if (!active) return;
        const savedId = requestedId ?? window.localStorage.getItem("relay-chat-workspace") ?? undefined;
        const selected = auth.workspaces.find((item) => item.workspace?.id === savedId) ?? auth.workspaces[0];
        if (!selected?.workspace) {
          setError("Create or select a workspace to continue.");
          return;
        }
        setContext({ id: selected.workspace.id, role: selected.role });
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) return;
        setError(cause instanceof Error ? cause.message : "Unable to load workspace.");
      }
    };
    void select();
    const onWorkspaceChange = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === "string") void select(id);
    };
    window.addEventListener("relay-workspace-change", onWorkspaceChange);
    return () => {
      active = false;
      window.removeEventListener("relay-workspace-change", onWorkspaceChange);
    };
  }, []);
  return { ...context, error };
}

function Notice({ error, status }: { error?: string; status?: string }) {
  if (error) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (status) return <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{status}</p>;
  return null;
}

export function WebsiteListPage() {
  const { id, error: contextError } = useWorkspaceContext();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!id) return;
    void apiRequest<{ websites: Website[] }>(`/workspaces/${id}/websites`)
      .then((result) => setWebsites(result.websites))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load websites."))
      .finally(() => setLoading(false));
  }, [id]);
  return <section>
    <div className="mb-5 flex items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Websites and widgets</h1><p className="mt-1 text-sm text-slate-600">Manage installation, access origins, and widget appearance.</p></div><Link href="/dashboard/websites/new" className={primaryButton}>Add website</Link></div>
    <Notice error={contextError || error} />
    {loading ? <p role="status" className="mt-4 text-sm text-slate-500">Loading websites…</p> : websites.length ? <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">{websites.map((website) => <li key={website.id}><Link href={`/dashboard/websites/${website.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-slate-50"><span><span className="block text-sm font-medium">{website.name}</span><span className="mt-1 block text-xs text-slate-500">{website.domain} · {website.status}</span></span><span className="font-mono text-xs text-slate-500">{website.publicWidgetId}</span></Link></li>)}</ul> : <p className="mt-4 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">No websites yet. Add a website to configure its widget.</p>}
  </section>;
}

export function TeamManagementPage() {
  const { id, role, error: contextError } = useWorkspaceContext();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [onlineAgents, setOnlineAgents] = useState<Set<string>>(new Set());
  const canManage = role === "owner" || role === "admin";
  async function refresh() {
    if (!id) return;
    const [memberResult, inviteResult] = await Promise.all([
      apiRequest<{ members: Member[] }>(`/workspaces/${id}/members`),
      canManage ? apiRequest<{ invitations: Invitation[] }>(`/workspaces/${id}/invitations`) : Promise.resolve({ invitations: [] })
    ]);
    setMembers(memberResult.members);
    setInvitations(inviteResult.invitations);
  }
  useEffect(() => {
    if (!id) return;
    void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load team."));
  }, [id, role]);
  useEffect(() => {
    if (!id) return;
    const socket = io(apiUrl, { withCredentials: true, reconnection: true, reconnectionAttempts: Infinity });
    socket.on("connect", () => {
      socket.emit("inbox:join", { workspaceId: id }, (ack: { ok: boolean; data?: { onlineAgentIds?: string[] } }) => {
        if (ack.ok) setOnlineAgents(new Set(ack.data?.onlineAgentIds ?? []));
      });
    });
    socket.on("workspace:agent-presence", (presence: { userId: string; online: boolean }) => {
      setOnlineAgents((current) => {
        const next = new Set(current);
        if (presence.online) next.add(presence.userId);
        else next.delete(presence.userId);
        return next;
      });
    });
    return () => { socket.disconnect(); };
  }, [id]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await apiRequest<{ message: string; developmentInvitationUrl?: string }>(
        `/workspaces/${id}/invitations`,
        { method: "POST", body: JSON.stringify({ email: String(form.get("email")).trim(), role: String(form.get("role")) }) }
      );
      setInviteUrl(result.developmentInvitationUrl ?? "");
      setStatus(result.message);
      formElement.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to invite member.");
    } finally {
      setBusy(false);
    }
  }
  async function updateMember(member: Member, patch: "role" | "status", value: string) {
    if (!id) return;
    setError("");
    try {
      await apiRequest(`/workspaces/${id}/members/${member.id}/${patch}`, {
        method: "PATCH",
        body: JSON.stringify({ [patch]: value })
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update member.");
    }
  }
  async function invitationAction(invitation: Invitation, action: "resend" | "revoke") {
    if (!id) return;
    setError("");
    setInviteUrl("");
    try {
      if (action === "revoke") {
        if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
        await apiRequest(`/workspaces/${id}/invitations/${invitation.id}`, { method: "DELETE" });
      } else {
        const result = await apiRequest<{ developmentInvitationUrl?: string }>(
          `/workspaces/${id}/invitations/${invitation.id}/resend`, { method: "POST", body: "{}" }
        );
        setInviteUrl(result.developmentInvitationUrl ?? "");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update invitation.");
    }
  }
  return <section>
    <h1 className="text-xl font-semibold">Team</h1><p className="mt-1 text-sm text-slate-600">Invite teammates and manage workspace roles. Owners cannot be removed or demoted through member controls.</p>
    <div className="mt-4 space-y-2"><Notice error={contextError || error} status={status} />{inviteUrl ? <p className="break-all rounded border border-blue-200 bg-blue-50 p-3 text-xs"><span className="font-medium">Development invitation link:</span> <a className="text-blue-700 underline" href={inviteUrl}>{inviteUrl}</a></p> : null}</div>
    {canManage ? <form onSubmit={(event) => void invite(event)} className="mt-5 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_180px_auto]"><label className="text-xs font-medium text-slate-600">Email<input name="email" type="email" required maxLength={254} className={`${fieldClass} mt-1`} placeholder="agent@example.com" /></label><label className="text-xs font-medium text-slate-600">Role<select name="role" className={`${fieldClass} mt-1`}><option value="agent">Agent</option><option value="supervisor">Supervisor</option>{role === "owner" ? <option value="admin">Admin</option> : null}</select></label><button disabled={busy || !id} className={`${primaryButton} self-end`}>{busy ? "Sending…" : "Invite member"}</button></form> : <p className="mt-4 rounded border border-slate-200 bg-white p-3 text-xs text-slate-500">Only workspace owners and admins can invite or manage members.</p>}
    <h2 className="mt-6 text-sm font-semibold">Members</h2>
    <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">    {members.map((member) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><p className="text-sm font-medium">{member.name || member.email}</p><p className="text-xs text-slate-500">{member.email} · {member.status}{member.status === "active" ? <span className={`ml-2 ${member.userId && onlineAgents.has(member.userId) ? "text-green-700" : "text-slate-400"}`}>● {member.userId && onlineAgents.has(member.userId) ? "Online" : "Offline"}</span> : null}</p></div><div className="flex items-center gap-2">{member.role === "owner" ? <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">Owner</span> : canManage ? <><label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.email}</label><select id={`role-${member.id}`} value={member.role} onChange={(event) => void updateMember(member, "role", event.target.value)} className="min-h-8 rounded border border-slate-300 px-2 text-xs"><option value="agent">Agent</option><option value="supervisor">Supervisor</option>{role === "owner" ? <option value="admin">Admin</option> : null}</select><button type="button" onClick={() => void updateMember(member, "status", member.status === "active" ? "suspended" : "active")} className="rounded border border-slate-300 px-2 py-1.5 text-xs">{member.status === "active" ? "Deactivate" : "Activate"}</button></> : <span className="text-xs capitalize text-slate-600">{member.role}</span>}</div></div>)}</div>
    {canManage && invitations.length ? <><h2 className="mt-6 text-sm font-semibold">Pending invitations</h2><div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">{invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><p className="text-sm font-medium">{invitation.email}</p><p className="text-xs text-slate-500">{invitation.role} · {Date.parse(invitation.expiresAt) < Date.now() ? "Expired" : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}</p></div><div className="flex gap-2"><button type="button" onClick={() => void invitationAction(invitation, "resend")} className="rounded border border-slate-300 px-2 py-1.5 text-xs">Resend</button><button type="button" onClick={() => void invitationAction(invitation, "revoke")} className="rounded border border-red-200 px-2 py-1.5 text-xs text-red-700">Revoke</button></div></div>)}</div></> : null}
  </section>;
}

export function CannedReplyManagementPage() {
  const { id, role, error: contextError } = useWorkspaceContext();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = ["owner", "admin", "supervisor"].includes(role);
  async function refresh(query = search) {
    if (!id) return;
    const result = await apiRequest<{ replies: Reply[] }>(`/workspaces/${id}/canned-replies?search=${encodeURIComponent(query)}`);
    setReplies(result.replies);
  }
  useEffect(() => {
    if (id) void refresh("").catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load replies."));
  }, [id]);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (id) void refresh(search).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Search failed.")); }, 250);
    return () => window.clearTimeout(timer);
  }, [search, id]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    const form = new FormData(event.currentTarget);
    const data = { title: String(form.get("title")).trim(), shortcut: String(form.get("shortcut")).trim(), body: String(form.get("body")).trim() };
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/workspaces/${id}/canned-replies${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(data)
      });
      setEditing(null);
      setStatus(editing ? "Canned reply updated." : "Canned reply created.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save canned reply.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(reply: Reply) {
    if (!id || !window.confirm(`Delete canned reply “${reply.title}”?`)) return;
    try {
      await apiRequest(`/workspaces/${id}/canned-replies/${reply.id}`, { method: "DELETE" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete reply.");
    }
  }
  return <section><h1 className="text-xl font-semibold">Canned replies</h1><p className="mt-1 text-sm text-slate-600">Shared replies are available to workspace agents in the inbox.</p><div className="mt-4 space-y-2"><Notice error={contextError || error} status={status} /></div>
    <label className="mt-4 block max-w-md text-xs font-medium text-slate-600">Search replies<input value={search} onChange={(event) => setSearch(event.target.value)} className={`${fieldClass} mt-1`} placeholder="Search title, shortcut, or text" /></label>
    {canManage ? <form key={editing?.id ?? "new"} onSubmit={(event) => void save(event)} className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"><label className="text-xs font-medium">Title<input name="title" required maxLength={120} defaultValue={editing?.title ?? ""} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-medium">Shortcut<input name="shortcut" required maxLength={50} pattern="[a-zA-Z0-9_-]+" defaultValue={editing?.shortcut ?? ""} className={`${fieldClass} mt-1`} placeholder="welcome" /></label><label className="text-xs font-medium sm:col-span-2">Reply text<textarea name="body" required maxLength={10000} rows={3} defaultValue={editing?.body ?? ""} className={`${fieldClass} mt-1 py-2`} /></label><div className="flex gap-2"><button disabled={busy} className={primaryButton}>{busy ? "Saving…" : editing ? "Update reply" : "Create reply"}</button>{editing ? <button type="button" onClick={() => setEditing(null)} className="rounded border px-3 text-xs">Cancel</button> : null}</div></form> : null}
    <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">{replies.map((reply) => <article key={reply.id} className="flex flex-wrap items-start justify-between gap-3 p-4"><div className="min-w-0"><h2 className="text-sm font-medium">{reply.title} <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">/{reply.shortcut}</code></h2><p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{reply.body}</p></div>{canManage ? <div className="flex gap-2"><button type="button" onClick={() => setEditing(reply)} className="rounded border border-slate-300 px-2 py-1.5 text-xs">Edit</button><button type="button" onClick={() => void remove(reply)} className="rounded border border-red-200 px-2 py-1.5 text-xs text-red-700">Delete</button></div> : null}</article>)}</div>
    {!replies.length ? <p className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">No matching replies.</p> : null}
  </section>;
}

type Analytics = {
  range: { from: string; to: string };
  totals: { conversations: number; open: number; pending: number; resolved: number; messages: number };
  firstResponseTime: { averageSeconds: number | null; sampleSize: number };
  resolutionTime: { averageSeconds: number | null; sampleSize: number };
  byWebsite: { websiteId: string; name: string; domain: string; conversations: number }[];
  byAgent: { agentId: string | null; name: string; conversations: number }[];
  messageVolume: { date: string; messages: number; visitorMessages: number; agentMessages: number }[];
};
export function AnalyticsPage() {
  const { id, error: contextError } = useWorkspaceContext();
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!id) return;
    const start = new Date(`${from}T00:00:00.000Z`).toISOString();
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    setLoading(true);
    void apiRequest<Analytics>(`/workspaces/${id}/analytics?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end.toISOString())}`)
      .then(setData).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load analytics."))
      .finally(() => setLoading(false));
  }, [id, from, to]);
  const duration = (seconds: number | null) => seconds === null ? "Not enough data" :
    seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} hr` : seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} sec`;
  return <section><h1 className="text-xl font-semibold">Analytics</h1><p className="mt-1 text-sm text-slate-600">Metrics are calculated from persisted conversations and messages.</p><div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"><label className="text-xs">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={`${fieldClass} mt-1`} /></label><span role="status" className="text-xs text-slate-500">{loading ? "Updating…" : "UTC date range"}</span></div><Notice error={contextError || error} />
    {data ? <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["Conversations", data.totals.conversations], ["Open", data.totals.open], ["Pending", data.totals.pending], ["Resolved", data.totals.resolved], ["Messages", data.totals.messages]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Average first response</p><p className="mt-2 text-xl font-semibold">{duration(data.firstResponseTime.averageSeconds)}</p><p className="mt-1 text-[10px] text-slate-400">{data.firstResponseTime.sampleSize} complete visitor-to-agent samples</p></div><div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Average resolution time</p><p className="mt-2 text-xl font-semibold">{duration(data.resolutionTime.averageSeconds)}</p><p className="mt-1 text-[10px] text-slate-400">{data.resolutionTime.sampleSize} resolved conversations with valid timestamps</p></div></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><MetricList title="Conversations per website" rows={data.byWebsite.map((item) => [item.name, `${item.domain} · ${item.conversations}`])} /><MetricList title="Conversations per agent" rows={data.byAgent.map((item) => [item.name, String(item.conversations)])} /></div>
      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4"><h2 className="text-sm font-semibold">Message volume by UTC day</h2><div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="py-2">Date</th><th>All</th><th>Visitor</th><th>Agent</th></tr></thead><tbody>{data.messageVolume.map((item) => <tr key={item.date} className="border-t border-slate-100"><td className="py-2">{item.date}</td><td>{item.messages}</td><td>{item.visitorMessages}</td><td>{item.agentMessages}</td></tr>)}</tbody></table>{!data.messageVolume.length ? <p className="py-3 text-slate-500">No messages in this range.</p> : null}</div></section>
      <p className="mt-3 text-[10px] leading-5 text-slate-500">Conversation totals use creation time in range. First response is the first persisted agent message at or after the first visitor message; conversations without a response are excluded. Resolution time is resolved timestamp minus conversation creation; unresolved or invalid samples are excluded. Message volume counts non-deleted persisted messages by creation time.</p>
    </> : null}
  </section>;
}
function MetricList({ title, rows }: { title: string; rows: [string, string][] }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="text-sm font-semibold">{title}</h2>{rows.length ? <ul className="mt-2 divide-y divide-slate-100">{rows.map(([name, value]) => <li key={name} className="flex justify-between gap-2 py-2 text-xs"><span>{name}</span><span className="text-slate-500">{value}</span></li>)}</ul> : <p className="mt-3 text-xs text-slate-500">No records in this date range.</p>}</section>;
}

export function WorkspaceSettingsPage() {
  const { id, role, error: contextError } = useWorkspaceContext();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [language, setLanguage] = useState("en");
  const [retention, setRetention] = useState("365");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id || (role !== "owner" && role !== "admin")) return;
    void apiRequest<{ workspace: { name: string; settings?: { timezone?: string; defaultLanguage?: string; dataRetentionDays?: number } } }>(`/workspaces/${id}`)
      .then((result) => {
        setName(result.workspace.name);
        setTimezone(result.workspace.settings?.timezone ?? "UTC");
        setLanguage(result.workspace.settings?.defaultLanguage ?? "en");
        setRetention(String(result.workspace.settings?.dataRetentionDays ?? 365));
      }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load settings."));
  }, [id, role]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setStatus("");
    try {
      await apiRequest(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify({ name, timezone, defaultLanguage: language, dataRetentionDays: Number(retention) }) });
      setStatus("Workspace and retention settings saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save settings."); }
    finally { setBusy(false); }
  }
  return <section><h1 className="text-xl font-semibold">Workspace settings</h1><p className="mt-1 text-sm text-slate-600">Workspace profile, default timezone, and personal-data retention.</p><div className="mt-4"><Notice error={contextError || error} status={status} /></div>{role === "owner" || role === "admin" ? <form onSubmit={(event) => void save(event)} className="mt-4 max-w-2xl space-y-4 rounded-lg border border-slate-200 bg-white p-5"><label className="block text-sm font-medium">Workspace name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={`${fieldClass} mt-1`} /></label><label className="block text-sm font-medium">Default timezone<input required maxLength={100} value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Kolkata" className={`${fieldClass} mt-1`} /><span className="text-xs font-normal text-slate-500">Use an IANA timezone, for example Asia/Kolkata.</span></label><label className="block text-sm font-medium">Default language<input required minLength={2} maxLength={16} value={language} onChange={(event) => setLanguage(event.target.value)} className={`${fieldClass} mt-1`} /></label><label className="block text-sm font-medium">Data retention (days)<input type="number" required min={30} max={3650} value={retention} onChange={(event) => setRetention(event.target.value)} className={`${fieldClass} mt-1`} /><span className="text-xs font-normal text-slate-500">Retention preference is saved; automated deletion scheduling is not configured.</span></label><button disabled={busy} className={primaryButton}>{busy ? "Saving…" : "Save settings"}</button></form> : <p className="mt-4 text-sm text-slate-500">Workspace settings are available to owners and admins only.</p>}<NotificationPreferences /></section>;
}
function NotificationPreferences() {
  const [sound, setSound] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void apiRequest<{ preferences: { sound: boolean; desktop: boolean } }>("/auth/preferences")
      .then(({ preferences }) => {
        setSound(preferences.sound);
        setDesktop(preferences.desktop);
        window.localStorage.setItem("relay-inbox-sound", String(preferences.sound));
        window.localStorage.setItem("relay-inbox-notifications", String(preferences.desktop));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load notification preferences."));
  }, []);
  async function savePreferences(nextSound: boolean, nextDesktop: boolean) {
    setError("");
    try {
      const { preferences } = await apiRequest<{ preferences: { sound: boolean; desktop: boolean } }>(
        "/auth/preferences",
        { method: "PATCH", body: JSON.stringify({ sound: nextSound, desktop: nextDesktop }) }
      );
      setSound(preferences.sound);
      setDesktop(preferences.desktop);
      window.localStorage.setItem("relay-inbox-sound", String(preferences.sound));
      window.localStorage.setItem("relay-inbox-notifications", String(preferences.desktop));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save notification preferences.");
    }
  }
  async function changeDesktopPreference(enabled: boolean) {
    if (enabled) {
      if (!("Notification" in window)) {
        setError("Browser notifications are not supported in this browser.");
        return;
      }
      let permission: NotificationPermission;
      try {
        permission = Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      } catch {
        setError("Unable to request browser notification permission.");
        return;
      }
      if (permission !== "granted") {
        setError("Browser notification permission was not granted.");
        return;
      }
    }
    await savePreferences(sound, enabled);
  }
  return <section className="mt-5 max-w-2xl rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-sm font-semibold">Notification preferences</h2><div className="mt-2"><Notice error={error} /></div><div className="mt-3 space-y-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={sound} onChange={(event) => void savePreferences(event.target.checked, desktop)} />Play a sound for new visitor messages</label><label className="flex items-center gap-2"><input type="checkbox" checked={desktop} onChange={(event) => void changeDesktopPreference(event.target.checked)} />Show browser notifications (permission requested only after enabling)</label></div></section>;
}

export function BillingUsagePage() {
  const { id, role, error: contextError } = useWorkspaceContext();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (id && (role === "owner" || role === "admin")) void apiRequest<Usage>(`/workspaces/${id}/usage`)
      .then(setUsage).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load usage."));
  }, [id, role]);
  return <section><h1 className="text-xl font-semibold">Plan and usage</h1><p className="mt-1 text-sm text-slate-600">Usage limits are enforced by backend services; payment status cannot be changed from this dashboard.</p><div className="mt-4"><Notice error={contextError || error} /></div>{role !== "owner" && role !== "admin" ? <p className="mt-4 rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">Billing information is available to workspace owners and admins.</p> : null}{usage ? <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-5"><p className="text-lg font-semibold capitalize">{usage.plan} plan</p><p className="text-xs text-slate-500">Subscription status: {usage.subscriptionStatus} · monthly usage period starts {new Date(String(usage.usage.periodStart)).toLocaleDateString()}</p><div className="mt-4 divide-y divide-slate-100">{Object.entries(usage.limits).map(([metric, limit]) => <div key={metric} className="flex justify-between py-3 text-sm"><span className="capitalize">{metric.replace(/([A-Z])/g, " $1").replace("Bytes", "storage (bytes)")}</span><span>{Number(usage.usage[metric] ?? 0).toLocaleString()} / {limit.toLocaleString()}</span></div>)}</div><p className="mt-3 text-xs text-slate-500">Plan tiers are defined in the API configuration. No payment provider is connected.</p></div> : null}</section>;
}

export function ProfileSettingsPage() {
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void apiRequest<AuthMeResponse>("/auth/me").then((auth) => {
      setName(auth.user.name); setEmail(auth.user.email); setAvatarUrl(auth.user.avatarUrl ?? "");
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load profile."));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setStatus("");
    try {
      await apiRequest("/auth/profile", { method: "PATCH", body: JSON.stringify({ name, avatarUrl: avatarUrl || null }) });
      setStatus("Profile saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save profile."); }
    finally { setBusy(false); }
  }
  return <section><h1 className="text-xl font-semibold">Profile</h1><p className="mt-1 text-sm text-slate-600">Update your personal account details.</p><div className="mt-4"><Notice error={error} status={status} /></div><form onSubmit={(event) => void save(event)} className="mt-4 max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-5"><label className="block text-sm font-medium">Name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={`${fieldClass} mt-1`} /></label><label className="block text-sm font-medium">Email<input readOnly value={email} className={`${fieldClass} mt-1 bg-slate-50`} /></label><label className="block text-sm font-medium">Avatar URL<input type="url" maxLength={2048} value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} className={`${fieldClass} mt-1`} /></label><button disabled={busy} className={primaryButton}>{busy ? "Saving…" : "Save profile"}</button></form></section>;
}
