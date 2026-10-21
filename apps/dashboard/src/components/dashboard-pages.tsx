"use client";

import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest, type AuthMeResponse } from "@/lib/api";
import { widgetInstallSnippet } from "@/lib/widget-install";
import { InboxPage } from "@/components/inbox-page";
import {
  AnalyticsPage, BillingUsagePage, CannedReplyManagementPage, ProfileSettingsPage,
  TeamManagementPage, WebsiteListPage, WorkspaceSettingsPage
} from "@/components/management-pages";

type RecordValue = Record<string, unknown>;
type Website = { id: string; name: string; domain: string; publicWidgetId: string; status?: string };
type InboxConversation = {
  id: string;
  status: "open" | "pending" | "resolved";
  priority: string;
  subject: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  visitorUnreadCount: number;
  agentUnreadCount: number;
};
type InboxMessage = {
  id?: string;
  clientMessageId?: string;
  senderType: "visitor" | "agent" | "system";
  body: string;
  createdAt: string;
  status?: "sending" | "sent" | "failed";
};

const titleFor = (section: string) => ({
  inbox: "Inbox",
  contacts: "Contacts",
  websites: "Websites and widgets",
  team: "Team",
  "canned-replies": "Canned replies",
  analytics: "Analytics",
  settings: "Workspace settings",
  billing: "Billing",
  profile: "Profile"
}[section] ?? "Dashboard");

function PageState({ message, error = false }: { message: string; error?: boolean }) {
  return <p role={error ? "alert" : "status"} className={`rounded-md border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600"}`}>{message}</p>;
}

function DataList({ records, emptyMessage }: { records: RecordValue[]; emptyMessage: string }) {
  if (!records.length) return <PageState message={emptyMessage} />;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {records.map((record, index) => {
        const main = String(record.name ?? record.title ?? record.displayName ?? record.subject ?? record.email ?? record.id ?? `Item ${index + 1}`);
        const sub = [record.domain, record.email, record.status, record.role]
          .filter((value): value is string => typeof value === "string" && value !== main)
          .join(" · ");
        return <div key={String(record.id ?? index)} className="border-b border-slate-100 px-4 py-3 last:border-0"><div className="text-sm font-medium text-slate-900">{main}</div>{sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}</div>;
      })}
    </div>
  );
}

export function DashboardOverview() {
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [websiteCount, setWebsiteCount] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiRequest<AuthMeResponse>("/auth/me").then(async (auth) => {
      const saved = window.localStorage.getItem("relay-chat-workspace");
      const entry = auth.workspaces.find((item) => item.workspace?.id === saved) ?? auth.workspaces[0];
      const id = entry?.workspace?.id;
      if (!id) return;
      setHasWorkspace(true);
      const [conversations, websites] = await Promise.all([
        apiRequest<{ conversations: unknown[] }>(`/workspaces/${id}/conversations?status=open&limit=100`),
        apiRequest<{ websites: unknown[] }>(`/workspaces/${id}/websites`)
      ]);
      setConversationCount(conversations.conversations.length);
      setWebsiteCount(websites.websites.length);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load dashboard."));
  }, []);

  return <section>
    <h1 className="text-xl font-semibold">Overview</h1>
    <p className="mt-1 text-sm text-slate-600">A current view of the workspace from your account data.</p>
    {error ? <div className="mt-5"><PageState message={error} error /></div> : null}
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      {[["Open conversations (up to 100)", conversationCount], ["Websites", websiteCount]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-5"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold">{value === null ? "—" : value}</div></div>)}
    </div>
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/dashboard/inbox" className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">Open inbox</Link>
      {hasWorkspace ? <Link href="/dashboard/websites/new" className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50">Add website</Link> : null}
    </div>
  </section>;
}

export function DashboardDataPage({ section, itemId }: { section: string; itemId?: string }) {
  const [workspaceId, setWorkspaceId] = useState("");
  const [records, setRecords] = useState<RecordValue[]>([]);
  const [details, setDetails] = useState<RecordValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiRequest<AuthMeResponse>("/auth/me").then(async (auth) => {
      if (section === "profile") {
        setDetails(auth.user as unknown as RecordValue);
        return;
      }
      const saved = window.localStorage.getItem("relay-chat-workspace");
      const entry = auth.workspaces.find((item) => item.workspace?.id === saved) ?? auth.workspaces[0];
      const id = entry?.workspace?.id;
      if (!id) return;
      setWorkspaceId(id);
      if (["analytics", "team", "canned-replies", "profile"].includes(section)) return;
      if (section === "billing") {
        if (entry.role !== "owner" && entry.role !== "admin") {
          throw new ApiError("You do not have permission to view billing.", 403);
        }
        const result = await apiRequest<{ workspace: RecordValue }>(`/workspaces/${id}`);
        setDetails(result.workspace);
        return;
      }
      if (section === "settings") {
        if (entry.role !== "owner" && entry.role !== "admin") {
          throw new ApiError("You do not have permission to view workspace settings.", 403);
        }
        const result = await apiRequest<{ workspace: RecordValue }>(`/workspaces/${id}`);
        setDetails(result.workspace);
        return;
      }
      if (section === "websites" && itemId && itemId !== "new") {
        const result = await apiRequest<{ website: RecordValue }>(`/workspaces/${id}/websites/${itemId}`);
        setDetails(result.website);
        return;
      }
      const routes: Record<string, string> = {
        contacts: "contacts?limit=50",
        websites: "websites",
        team: "members",
        "canned-replies": "canned-replies"
      };
      const suffix = routes[section];
      if (suffix && !(section === "websites" && itemId === "new")) {
        const response = await apiRequest<Record<string, RecordValue[]>>(`/workspaces/${id}/${suffix}`);
        const key = Object.keys(response)[0];
        if (key) setRecords(response[key] ?? []);
      }
    }).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) return;
      setError(cause instanceof Error ? cause.message : "Unable to load this page.");
    }).finally(() => setLoading(false));
  }, [itemId, section]);

  if (section === "websites" && itemId === "new") {
    return <WebsiteCreatePage />;
  }
  if (section === "inbox") return <InboxPage />;
  if (section === "websites" && !itemId) return <WebsiteListPage />;
  if (section === "team") return <TeamManagementPage />;
  if (section === "canned-replies") return <CannedReplyManagementPage />;
  if (section === "analytics") return <AnalyticsPage />;
  if (section === "settings") return <WorkspaceSettingsPage />;
  if (section === "billing") return <BillingUsagePage />;
  if (section === "profile") return <ProfileSettingsPage />;

  const title = titleFor(section);
  return <section>
    <div className="mb-5"><h1 className="text-xl font-semibold">{title}</h1><p className="mt-1 text-sm text-slate-600">Workspace data and actions available to your role.</p></div>
    {loading ? <PageState message="Loading…" /> : error ? <PageState message={error} error /> : null}
    {!loading && !error ? section === "analytics"
      ? <PageState message="Analytics reporting is not available yet." />
      : section === "billing"
        ? <PageState message={`Current plan: ${String(details?.plan ?? "Not set")}. Subscription status: ${String(details?.subscriptionStatus ?? "Not set")}. Billing management will be available with the billing integration.`} />
        : section === "websites" && itemId
          ? details ? <WebsiteSettingsEditor website={details} workspaceId={workspaceId} /> : <PageState message="No website details are available." />
        : section === "settings" || section === "profile"
          ? details ? <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">{Object.entries(details).filter(([key, value]) => key !== "_id" && key !== "__v" && value !== undefined && (typeof value !== "object" || value === null)).map(([key, value]) => <div key={key}><dt className="text-xs capitalize text-slate-500">{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt><dd className="mt-1 break-all text-sm text-slate-900">{String(value ?? "—")}</dd></div>)}</dl> : <PageState message="No details are available." />
          : <DataList records={records} emptyMessage={`No ${title.toLowerCase()} to show yet.`} />
      : null}
    {section === "websites" && !itemId ? <Link href="/dashboard/websites/new" className="mt-4 inline-flex rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">Add website</Link> : null}
  </section>;
}

function mergeInboxMessages(current: InboxMessage[], incoming: InboxMessage[]): InboxMessage[] {
  const merged = new Map<string, InboxMessage>();
  for (const message of current) {
    merged.set(message.id ?? message.clientMessageId ?? `${message.createdAt}:${message.body}`, message);
  }
  for (const message of incoming) {
    const existingKey = message.clientMessageId &&
      [...merged.entries()].find(([, currentMessage]) => currentMessage.clientMessageId === message.clientMessageId)?.[0];
    const key = existingKey ?? message.id ?? message.clientMessageId ?? `${message.createdAt}:${message.body}`;
    merged.set(key, { ...merged.get(key), ...message, status: "sent" });
  }
  return [...merged.values()].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

export function RealtimeInboxPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [conversationReady, setConversationReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [socketStatus, setSocketStatus] = useState("Connecting…");
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    void apiRequest<AuthMeResponse>("/auth/me")
      .then((auth) => {
        const saved = window.localStorage.getItem("relay-chat-workspace");
        const entry = auth.workspaces.find((item) => item.workspace?.id === saved) ?? auth.workspaces[0];
        if (entry?.workspace?.id) setWorkspaceId(entry.workspace.id);
        else setError("Choose or create a workspace before opening the inbox.");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load your account."));
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setLoading(true);
    setError("");
    void apiRequest<{ conversations: InboxConversation[] }>(
      `/workspaces/${workspaceId}/conversations?limit=50`
    ).then((result) => {
      if (!active) return;
      setConversations(result.conversations);
      setSelectedId((current) =>
        current && result.conversations.some((item) => item.id === current)
          ? current
          : result.conversations[0]?.id ?? ""
      );
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load conversations.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const socket = io(
      (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, ""),
      { withCredentials: true, reconnection: true, reconnectionAttempts: Infinity }
    );
    socketRef.current = socket;
    const joinSelected = () => {
      if (!selectedId) {
        setConversationReady(false);
        setMessages([]);
        return;
      }
      setConversationReady(false);
      socket.emit(
        "conversation:join",
        { workspaceId, conversationId: selectedId },
        (ack: { ok: boolean; data?: { messages: InboxMessage[] }; error?: { message: string } }) => {
          if (!active) return;
          if (!ack.ok) {
            setConversationReady(false);
            setError(ack.error?.message ?? "Unable to open this conversation.");
            return;
          }
          setMessages((current) => mergeInboxMessages(current, ack.data?.messages ?? []));
          setConversationReady(true);
          socket.emit("conversation:read", { workspaceId, conversationId: selectedId });
        }
      );
    };
    socket.on("connect", () => {
      setSocketStatus("Connected");
      socket.emit(
        "inbox:join",
        { workspaceId },
        (ack: { ok: boolean; data?: { conversations: InboxConversation[] }; error?: { message: string } }) => {
          if (!active) return;
          if (!ack.ok) {
            setError(ack.error?.message ?? "Unable to join the workspace inbox.");
            return;
          }
          if (ack.data?.conversations) setConversations(ack.data.conversations);
        }
      );
      joinSelected();
    });
    socket.on("disconnect", () => {
      setSocketStatus("Reconnecting…");
      setConversationReady(false);
    });
    socket.on("connect_error", () => {
      setSocketStatus("Offline");
      setConversationReady(false);
    });
    const upsertConversation = (conversation: InboxConversation) => {
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id)
      ].sort((left, right) =>
        new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime()
      ));
    };
    socket.on("conversation:created", upsertConversation);
    socket.on("conversation:updated", upsertConversation);
    socket.on("conversation:assigned", upsertConversation);
    socket.on("conversation:message", (message: InboxMessage) => {
      if (selectedId) {
        setMessages((current) => mergeInboxMessages(current, [message]));
        setConversations((current) => current.map((item) =>
          item.id === selectedId
            ? { ...item, lastMessageAt: message.createdAt, lastMessagePreview: message.body }
            : item
        ));
      }
    });
    socket.on("unread:update", (unread: {
      conversationId: string;
      visitorUnreadCount: number;
      agentUnreadCount: number;
    }) => {
      setConversations((current) => current.map((item) =>
        item.id === unread.conversationId
          ? { ...item, visitorUnreadCount: unread.visitorUnreadCount, agentUnreadCount: unread.agentUnreadCount }
          : item
      ));
    });
    return () => {
      active = false;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [workspaceId, selectedId]);

  async function submitMessage(value: string = draft, retry?: InboxMessage) {
    const body = (retry?.body ?? value).trim();
    if (!body || !selectedId || !workspaceId || !conversationReady) return;
    const clientMessageId = retry?.clientMessageId ??
      (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const optimistic: InboxMessage = {
      id: retry?.id,
      clientMessageId,
      senderType: "agent",
      body,
      createdAt: retry?.createdAt ?? new Date().toISOString(),
      status: "sending"
    };
    setMessages((current) => mergeInboxMessages(current, [optimistic]));
    setDraft("");
    const socket = socketRef.current;
    if (!socket?.connected) {
      setMessages((current) => current.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, status: "failed" } : item
      ));
      setError("The inbox is disconnected. Reconnect before retrying the message.");
      return;
    }
    socket.timeout(8_000).emit(
      "message:send",
      { workspaceId, conversationId: selectedId, clientMessageId, body },
      (timeoutError: Error | null, ack: {
        ok: boolean;
        data?: { message: InboxMessage };
        error?: { message: string };
      }) => {
        const deliveredMessage = ack.data?.message;
        if (timeoutError || !ack.ok || !deliveredMessage) {
          setMessages((current) => current.map((item) =>
            item.clientMessageId === clientMessageId ? { ...item, status: "failed" } : item
          ));
          setError(timeoutError ? "Message delivery timed out. Retry with the same message key." :
            ack.error?.message ?? "Unable to send this message.");
          return;
        }
        setMessages((current) => mergeInboxMessages(current, [deliveredMessage]));
        setError("");
      }
    );
  }

  function updateStatus(status: "open" | "resolved") {
    if (!selectedId || !workspaceId || !socketRef.current?.connected) return;
    socketRef.current.emit("conversation:update", {
      workspaceId,
      conversationId: selectedId,
      status
    }, (ack: { ok: boolean; error?: { message: string } }) => {
      if (!ack.ok) setError(ack.error?.message ?? "Unable to update conversation status.");
    });
  }

  const selected = conversations.find((item) => item.id === selectedId);
  return <section>
    <div className="mb-5 flex items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Inbox</h1><p className="mt-1 text-sm text-slate-600">Live conversations for this workspace.</p></div>
      <p role="status" className="text-xs text-slate-500">{socketStatus}</p>
    </div>
    {error ? <div className="mb-4"><PageState message={error} error /></div> : null}
    {loading ? <PageState message="Loading conversations…" /> : conversations.length === 0
      ? <PageState message="No conversations yet. New visitor messages will appear here." />
      : <div className="grid min-h-[560px] overflow-hidden rounded-lg border border-slate-200 bg-white lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside aria-label="Conversations" className="max-h-[280px] overflow-y-auto border-b border-slate-200 lg:max-h-[640px] lg:border-b-0 lg:border-r">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => { setMessages([]); setConversationReady(false); setSelectedId(conversation.id); setError(""); }}
              className={`block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 ${selectedId === conversation.id ? "bg-blue-50" : ""}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{conversation.subject || `Conversation ${conversation.id.slice(-6)}`}</span>
                {conversation.agentUnreadCount > 0 ? <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] text-white">{conversation.agentUnreadCount}</span> : null}
              </span>
              <span className="mt-1 block truncate text-xs text-slate-500">{conversation.lastMessagePreview || "No messages yet"}</span>
              <span className="mt-1 block text-[10px] capitalize text-slate-400">{conversation.status}</span>
            </button>
          ))}
        </aside>
        <div className="flex min-h-[480px] min-w-0 flex-col">
          {selected ? <>
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{selected.subject || `Conversation ${selected.id.slice(-6)}`}</h2><p className="text-xs capitalize text-slate-500">{selected.status} · {selected.priority} priority</p></div>
              <button type="button" onClick={() => updateStatus(selected.status === "resolved" ? "open" : "resolved")} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50">{selected.status === "resolved" ? "Reopen" : "Resolve"}</button>
            </header>
            <div aria-live="polite" aria-label="Messages" className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length ? messages.map((message) => (
                <article key={message.id ?? message.clientMessageId} className={`max-w-[85%] rounded-lg p-3 text-sm ${message.senderType === "agent" ? "ml-auto bg-blue-600 text-white" : "bg-slate-100 text-slate-900"}`}>
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <time className="mt-1 block text-[10px] opacity-70">{new Date(message.createdAt).toLocaleTimeString()}</time>
                  {message.status === "failed" ? <button type="button" onClick={() => void submitMessage("", message)} className="mt-2 underline">Retry</button> : null}
                  {message.status === "sending" ? <span className="mt-1 block text-[10px]">Sending…</span> : null}
                </article>
              )) : <p className="text-sm text-slate-500">No messages in this conversation.</p>}
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void submitMessage(); }} className="flex items-end gap-2 border-t border-slate-200 p-3">
              <label htmlFor="inbox-reply" className="sr-only">Write a reply</label>
              <textarea id="inbox-reply" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={10_000} disabled={selected.status === "resolved"} rows={2} placeholder={selected.status === "resolved" ? "Reopen this conversation to reply" : "Write a reply…"} className="min-h-12 flex-1 resize-y rounded-md border border-slate-300 p-2 text-sm disabled:bg-slate-100" />
              <button disabled={!draft.trim() || !conversationReady || selected.status === "resolved"} className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">Send</button>
            </form>
          </> : <div className="grid flex-1 place-items-center p-6 text-sm text-slate-500">Select a conversation to read and reply.</div>}
        </div>
      </div>}
  </section>;
}

function WebsiteCreatePage() {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Website | null>(null);
  useEffect(() => {
    void apiRequest<AuthMeResponse>("/auth/me").then((auth) => {
      const saved = window.localStorage.getItem("relay-chat-workspace");
      const entry = auth.workspaces.find((item) => item.workspace?.id === saved) ?? auth.workspaces[0];
      if (entry?.workspace?.id) setWorkspaceId(entry.workspace.id);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load account."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const input = String(form.get("domain") ?? "").trim();
    let origin: string;
    try {
      const url = new URL(input.includes("://") ? input : `https://${input}`);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      origin = url.origin;
    } catch {
      setError("Enter a valid website domain.");
      return;
    }

    
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ website: Website }>(`/workspaces/${workspaceId}/websites`, {
        method: "POST",
        body: JSON.stringify({ name, domain: new URL(origin).host, allowedOrigins: [origin] })
      });
      setCreated(result.website);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add website.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="max-w-xl">
    <h1 className="text-xl font-semibold">Add a website</h1>
    <p className="mt-1 text-sm text-slate-600">Allowed origin is set to the exact website origin.</p>
    {error ? <div className="mt-4"><PageState message={error} error /></div> : null}
    {created ? <div className="mt-5 rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-semibold">Website created</h2><p className="mt-2 text-sm">{created.name} · {created.domain}</p><label className="mt-4 block text-xs font-medium text-slate-600">Public widget ID<input readOnly value={created.publicWidgetId} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs" /></label><label className="mt-4 block text-xs font-medium text-slate-600">Installation snippet<textarea readOnly rows={8} value={widgetInstallSnippet(created.publicWidgetId)} className="mt-1 w-full resize-none rounded-md border border-slate-300 bg-slate-50 p-2 font-mono" /></label><button onClick={() => router.push(`/dashboard/websites/${created.id}`)} className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">View website settings</button></div> : <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <label className="block text-sm font-medium">Website name<input name="name" required maxLength={120} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
      <label className="block text-sm font-medium">Domain<input name="domain" required maxLength={253} placeholder="example.com" className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
      <button disabled={busy || !workspaceId} className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{busy ? "Adding…" : "Add website"}</button>
    </form>}
  </section>;
}

function WebsiteSettingsEditor({ website, workspaceId }: { website: RecordValue; workspaceId: string }) {
      const settings = (website.widgetSettings && typeof website.widgetSettings === "object"
        ? website.widgetSettings
        : {}) as RecordValue;
      const [busy, setBusy] = useState(false);
      const [status, setStatus] = useState("");
      const [error, setError] = useState("");
      const [previewColor, setPreviewColor] = useState(typeof settings.accentColor === "string" ? settings.accentColor : "#2564E5");
      const [previewTitle, setPreviewTitle] = useState(typeof settings.title === "string" ? settings.title : "Chat with us");
      const [previewSubtitle, setPreviewSubtitle] = useState(typeof settings.subtitle === "string" ? settings.subtitle : "We usually reply shortly");
      const [previewGreeting, setPreviewGreeting] = useState(typeof settings.greeting === "string" ? settings.greeting : "Hi there! How can we help?");
      const [publicWidgetId, setPublicWidgetId] = useState(String(website.publicWidgetId ?? ""));
      const [websiteStatus, setWebsiteStatus] = useState(String(website.status ?? "active"));
      const [rotating, setRotating] = useState(false);
      const widgetId = publicWidgetId;
      const snippet = widgetInstallSnippet(widgetId);
      const [copied, setCopied] = useState(false);
      const schedule = Array.isArray(settings.availabilitySchedule)
        ? settings.availabilitySchedule as { day: number; start: string; end: string }[]
        : [];
      const activeDays = new Set(schedule.map((item) => item.day));
      const startTime = schedule[0]?.start ?? "09:00";
      const endTime = schedule[0]?.end ?? "17:00";

      async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        setStatus("");
        const form = new FormData(event.currentTarget);
        const days = form.getAll("days").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
        const start = String(form.get("start") ?? "09:00");
        const end = String(form.get("end") ?? "17:00");
        const timezone = String(form.get("timezone") ?? "UTC").trim();
        const nextSchedule = days.map((day) => ({ day, start, end }));
        const logoUrl = String(form.get("logoUrl") ?? "").trim();
        const config = {
          accentColor: String(form.get("accentColor") ?? "#2564E5"),
          position: String(form.get("position") ?? "bottom-right"),
          title: String(form.get("title") ?? "").trim(),
          subtitle: String(form.get("subtitle") ?? "").trim(),
          welcomeMessage: String(form.get("welcomeMessage") ?? "").trim(),
          greeting: String(form.get("greeting") ?? "").trim(),
          launcherLabel: String(form.get("launcherLabel") ?? "").trim(),
          launcherIcon: String(form.get("launcherIcon") ?? "chat"),
          logoUrl: logoUrl || null,
          theme: String(form.get("theme") ?? "light"),
          onlineText: String(form.get("onlineText") ?? "").trim(),
          offlineText: String(form.get("offlineText") ?? "").trim(),
          collectName: form.get("collectName") === "on",
          collectEmail: form.get("collectEmail") === "on",
          offlineContactForm: form.get("offlineContactForm") === "on",
          availabilityTimezone: timezone,
          availabilitySchedule: nextSchedule
        };
        try {
          const domainInput = String(form.get("domain") ?? "").trim();
          let domain = "";
          try {
            const domainUrl = new URL(domainInput.includes("://") ? domainInput : `https://${domainInput}`);
            if (!["http:", "https:"].includes(domainUrl.protocol)) throw new Error();
            domain = domainUrl.host.toLowerCase();
          } catch {
            throw new Error("Enter a valid website domain, such as example.com or http://localhost:3000.");
          }
          const allowedOrigins = String(form.get("allowedOrigins") ?? "")
            .split(/[\n,]/)
            .map((origin) => origin.trim())
            .filter(Boolean)
            .map((origin) => {
              const parsed = new URL(origin);
              if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) throw new Error();
              return origin;
            });
          if (!allowedOrigins.length) throw new Error("Add at least one exact http(s) allowed origin.");
          await apiRequest(`/workspaces/${workspaceId}/websites/${String(website.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: String(form.get("websiteName") ?? "").trim(),
              domain,
              allowedOrigins,
              widgetSettings: config
            })
          });
          setStatus("Website and widget settings saved.");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to save widget settings.");
        } finally {
          setBusy(false);
        }
      }

      async function copySnippet() {
        try {
          await navigator.clipboard.writeText(snippet);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setError("Clipboard unavailable. Select and copy the snippet below.");
        }
      }

      async function rotateId() {
        if (!window.confirm("Rotate this widget ID? The old ID stops working immediately. You must update the embed script on every installed website.")) return;
        setRotating(true);
        setError("");
        try {
          const result = await apiRequest<{ website: { publicWidgetId: string }; warning: string }>(
            `/workspaces/${workspaceId}/websites/${String(website.id)}/rotate-widget-id`,
            { method: "POST", body: "{}" }
          );
          setPublicWidgetId(result.website.publicWidgetId);
          setStatus(result.warning);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to rotate widget ID.");
        } finally {
          setRotating(false);
        }
      }

      async function toggleWebsiteStatus() {
        const next = websiteStatus === "active" ? "disabled" : "active";
        if (next === "disabled" && !window.confirm("Disable this widget? It will stop initializing on the website.")) return;
        try {
          await apiRequest(`/workspaces/${workspaceId}/websites/${String(website.id)}`, {
            method: "PATCH", body: JSON.stringify({ status: next })
          });
          setWebsiteStatus(next);
          setStatus(`Website widget ${next === "active" ? "enabled" : "disabled"}.`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to update website status.");
        }
      }

      return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <h1 className="text-xl font-semibold">{String(website.name)} widget</h1>
          <p className="mt-1 text-sm text-slate-600">{String(website.domain)} · Customize appearance and installation.</p>
          {error ? <div className="mt-4"><PageState message={error} error /></div> : null}
          {status ? <div className="mt-4"><PageState message={status} /></div> : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs">
            <span>Widget status: <strong className="capitalize">{websiteStatus}</strong></span>
            <div className="flex gap-2"><button type="button" onClick={() => void toggleWebsiteStatus()} className="rounded border border-slate-300 px-3 py-2 font-medium">{websiteStatus === "active" ? "Disable widget" : "Enable widget"}</button><button type="button" disabled={rotating} onClick={() => void rotateId()} className="rounded border border-amber-300 px-3 py-2 font-medium text-amber-800 disabled:opacity-50">{rotating ? "Rotating…" : "Rotate widget ID"}</button></div>
          </div>
          <form onSubmit={(event) => void save(event)} className="mt-5 space-y-5 rounded-lg border border-slate-200 bg-white p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">Website name<input name="websiteName" required maxLength={120} defaultValue={String(website.name)} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium">Website domain<input name="domain" required maxLength={253} defaultValue={String(website.domain)} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium sm:col-span-2">Allowed origins<textarea name="allowedOrigins" required rows={2} defaultValue={Array.isArray(website.allowedOrigins) ? (website.allowedOrigins as string[]).join("\n") : ""} placeholder="https://example.com" className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-xs" /><span className="text-xs font-normal text-slate-500">Enter exact origins (scheme and port included), one per line. For localhost use http://localhost:3000.</span></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">Brand color<input name="accentColor" type="color" value={previewColor} onChange={(event) => setPreviewColor(event.target.value)} className="mt-1 block h-10 w-full rounded border border-slate-300 p-1" /></label>
              <label className="block text-sm font-medium">Launcher position<select name="position" defaultValue={String(settings.position ?? "bottom-right")} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3"><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option></select></label>
              <label className="block text-sm font-medium">Widget title<input name="title" required maxLength={80} value={previewTitle} onChange={(event) => setPreviewTitle(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium">Subtitle<input name="subtitle" maxLength={120} value={previewSubtitle} onChange={(event) => setPreviewSubtitle(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium">Launcher label<input name="launcherLabel" maxLength={40} defaultValue={String(settings.launcherLabel ?? "Open chat")} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium">Launcher icon<select name="launcherIcon" defaultValue={String(settings.launcherIcon ?? "chat")} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3"><option value="chat">Chat bubble</option><option value="message">Message</option></select></label>
              <label className="block text-sm font-medium">Logo URL<input name="logoUrl" type="url" maxLength={2048} defaultValue={String(settings.logoUrl ?? "")} placeholder="https://example.com/logo.png" className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium">Theme<select name="theme" defaultValue={String(settings.theme ?? "light")} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3"><option value="light">Light</option><option value="dark">Dark</option></select></label>
              <label className="block text-sm font-medium sm:col-span-2">Welcome title/message<input name="welcomeMessage" maxLength={500} defaultValue={String(settings.welcomeMessage ?? "How can we help?")} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium sm:col-span-2">Greeting<input name="greeting" maxLength={500} value={previewGreeting} onChange={(event) => setPreviewGreeting(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium">Online status text<input name="onlineText" maxLength={80} defaultValue={String(settings.onlineText ?? "We are online")} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium">Offline status text<input name="offlineText" maxLength={80} defaultValue={String(settings.offlineText ?? "Leave us a message")} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
            </div>
            <fieldset className="rounded-md border border-slate-200 p-4">
              <legend className="px-1 text-sm font-medium">Business availability schedule</legend>
              <p className="mb-3 text-xs text-slate-500">A schedule with no selected days means availability is always on. Use 24-hour local time.</p>
              <div className="flex flex-wrap gap-3">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => <label key={day} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="days" value={index} defaultChecked={activeDays.has(index)} />{day}</label>)}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="text-xs">Opens<input name="start" type="time" defaultValue={startTime} className="mt-1 min-h-9 w-full rounded border border-slate-300 px-2" /></label>
                <label className="text-xs">Closes<input name="end" type="time" defaultValue={endTime} className="mt-1 min-h-9 w-full rounded border border-slate-300 px-2" /></label>
                <label className="text-xs">IANA timezone<input name="timezone" maxLength={100} defaultValue={String(settings.availabilityTimezone ?? "UTC")} placeholder="America/New_York" className="mt-1 min-h-9 w-full rounded border border-slate-300 px-2" /></label>
              </div>
            </fieldset>
            <fieldset className="flex flex-wrap gap-x-5 gap-y-3 rounded-md border border-slate-200 p-4">
              <legend className="px-1 text-sm font-medium">Contact collection</legend>
              <label className="flex items-center gap-2 text-sm"><input name="collectName" type="checkbox" defaultChecked={settings.collectName === true} />Ask visitor name</label>
              <label className="flex items-center gap-2 text-sm"><input name="collectEmail" type="checkbox" defaultChecked={settings.collectEmail === true} />Ask visitor email</label>
              <label className="flex items-center gap-2 text-sm"><input name="offlineContactForm" type="checkbox" defaultChecked={settings.offlineContactForm === true} />Show offline contact fields</label>
            </fieldset>
            <button disabled={busy} className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Saving…" : "Save widget settings"}</button>
          </form>
          <div className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Installation code</h2><button type="button" onClick={() => void copySnippet()} disabled={!snippet.startsWith("<script>")} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50">{copied ? "Copied" : "Copy"}</button></div>
            <label className="mt-3 block text-xs font-medium">Public widget ID<input readOnly value={widgetId} className="mt-1 min-h-9 w-full rounded border border-slate-300 bg-slate-50 px-2 font-mono" /></label>
            <textarea readOnly rows={8} value={snippet} aria-label="Widget installation code" className="mt-3 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs" />
            <p className="mt-2 text-xs leading-5 text-slate-500">Paste this code before the closing <code>&lt;/body&gt;</code> tag. Supported: any CMS or website that permits custom HTML/script tags. See docs/widget-installation.md in the repository for platform notes.</p>
          </div>
        </section>
        <aside aria-label="Widget preview" className="rounded-lg border border-slate-200 bg-slate-100 p-4">
          <h2 className="text-sm font-semibold">Widget preview</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div style={{ backgroundColor: previewColor }} className="p-4 text-white"><div className="font-semibold">{previewTitle}</div><div className="text-xs opacity-90">{previewSubtitle}</div></div>
            <div className="min-h-40 p-4"><div className="inline-block max-w-[90%] rounded-xl rounded-tl-sm bg-slate-100 p-3 text-sm text-slate-800">{previewGreeting}</div></div>
            <div className="border-t border-slate-200 p-3"><div className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-400">Write your message…</div></div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Preview uses saved settings after you save the form.</p>
          <Link href={`/widget-demo?widgetId=${encodeURIComponent(widgetId)}`} className="mt-4 inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50">Open functional demo</Link>
        </aside>
      </div>;
    }
