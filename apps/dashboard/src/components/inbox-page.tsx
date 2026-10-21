"use client";

import { io, type Socket } from "socket.io-client";
import {
  Bell, ChevronDown, ChevronLeft, CircleDot, Headphones,
  Search, Send, Volume2, VolumeX
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest, type AuthMeResponse } from "@/lib/api";

type InboxVisitor = {
  displayName: string | null;
  email: string | null;
  phone: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  currentPageUrl: string | null;
  referrer: string | null;
  browser: string | null;
  operatingSystem: string | null;
  country?: string | null;
  customAttributes?: Record<string, unknown>;
};
type InboxWebsite = { name: string; domain: string };
type InboxConversation = {
  id: string;
  visitorId: string;
  assignedAgentId: string | null;
  tags: string[];
  status: "open" | "pending" | "resolved";
  priority: "low" | "normal" | "high" | "urgent";
  subject: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  visitorUnreadCount: number;
  agentUnreadCount: number;
  visitor?: InboxVisitor | null;
  website?: InboxWebsite | null;
};
type InboxMessage = {
  id?: string;
  clientMessageId?: string;
  senderType: "visitor" | "agent" | "system";
  body: string;
  createdAt: string;
  status?: "sending" | "sent" | "failed";
};
type MemberOption = { userId: string | null; name: string; email: string; role: string; status: string };
type CannedReply = { id: string; title: string; shortcut: string; body: string };
type InternalNote = { id: string; body: string; createdAt: string; author: string };
type Filter = "all" | "unassigned" | "mine" | "open" | "pending" | "resolved" | "unread";
type SocketAck<T = unknown> = { ok: true; data?: T } | { ok: false; error?: { message?: string } };

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

function mergeMessages(current: InboxMessage[], incoming: InboxMessage[]): InboxMessage[] {
  const merged = new Map<string, InboxMessage>();
  for (const message of current) {
    merged.set(message.id ?? message.clientMessageId ?? `${message.createdAt}:${message.body}`, message);
  }
  for (const message of incoming) {
    const matching = message.clientMessageId
      ? [...merged.entries()].find(([, item]) => item.clientMessageId === message.clientMessageId)?.[0]
      : undefined;
    const key = matching ?? message.id ?? message.clientMessageId ?? `${message.createdAt}:${message.body}`;
    merged.set(key, { ...merged.get(key), ...message, status: "sent" });
  }
  return [...merged.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function formatTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function visitorLabel(visitor?: InboxVisitor | null): string {
  return visitor?.displayName?.trim() || visitor?.email || "Website visitor";
}

function safePath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "Open visitor page";
  }
}

export function InboxPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [role, setRole] = useState("");
  const [workspaceRoles, setWorkspaceRoles] = useState<Record<string, string>>({});
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [cannedReplies, setCannedReplies] = useState<CannedReply[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [agentFilter, setAgentFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [conversationReady, setConversationReady] = useState(false);
  const [socketStatus, setSocketStatus] = useState("Connecting…");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [typing, setTyping] = useState(false);
  const [visitorOnline, setVisitorOnline] = useState(false);
  const [visitorRead, setVisitorRead] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "thread" | "details">("list");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showCannedReplies, setShowCannedReplies] = useState(false);
  const [priorConversations, setPriorConversations] = useState<InboxConversation[]>([]);
  const [visitorDetails, setVisitorDetails] = useState<InboxVisitor | null>(null);
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"visitor" | "notes">("visitor");
  const [tagDraft, setTagDraft] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const selectedRef = useRef("");
  const refreshRef = useRef<() => void>(() => undefined);
  const cursorRef = useRef("");
  const historyRef = useRef<HTMLDivElement>(null);
  const visitorTypingTimeoutRef = useRef<number | undefined>(undefined);
  const agentTypingTimeoutRef = useRef<number | undefined>(undefined);
  const agentIsTypingRef = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  const notificationsEnabledRef = useRef(notificationsEnabled);

  selectedRef.current = selectedId;
  soundEnabledRef.current = soundEnabled;
  notificationsEnabledRef.current = notificationsEnabled;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "31" });
    if (filter === "unassigned") params.set("assignment", "unassigned");
    if (filter === "mine") params.set("assignment", "mine");
    if (filter === "unread") params.set("unread", "true");
    if (agentFilter === "__unassigned") params.set("assignment", "unassigned");
    else if (agentFilter) params.set("assignedAgentId", agentFilter);
    if (filter === "open" || filter === "pending" || filter === "resolved") params.set("status", filter);
    if (search) params.set("search", search);
    return params.toString();
  }, [agentFilter, filter, search]);

  const loadConversations = useCallback(async (append = false) => {
    if (!workspaceId) return;
    if (append && !cursorRef.current) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(query);
      if (append) params.set("before", cursorRef.current);
      const result = await apiRequest<{ conversations: InboxConversation[] }>(
        `/workspaces/${workspaceId}/conversations?${params.toString()}`
      );
      const page = result.conversations;
      setHasMore(page.length === 31);
      const visiblePage = append ? page : page.slice(0, 30);
      if (append) {
        setConversations((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...visiblePage.filter((item) => !seen.has(item.id))];
        });
      } else {
        setConversations(visiblePage);
        const nextCursor = visiblePage.length ? visiblePage[visiblePage.length - 1].lastMessageAt : "";
        cursorRef.current = nextCursor;
        setSelectedId((current) =>
          current && visiblePage.some((item) => item.id === current) ? current : visiblePage[0]?.id ?? ""
        );
      }
      if (append && visiblePage.length) {
        const nextCursor = visiblePage[visiblePage.length - 1].lastMessageAt;
        cursorRef.current = nextCursor;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load conversations.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [query, workspaceId]);

  refreshRef.current = () => { void loadConversations(); };

  const selectedVisitorId = conversations.find((item) => item.id === selectedId)?.visitorId;

  useEffect(() => {
    let active = true;
    void apiRequest<AuthMeResponse>("/auth/me").then((auth) => {
      if (!active) return;
      const saved = window.localStorage.getItem("relay-chat-workspace");
      const entry = auth.workspaces.find((item) => item.workspace?.id === saved) ?? auth.workspaces[0];
      if (!entry?.workspace?.id) {
        setError("Choose or create a workspace before opening the inbox.");
        setLoading(false);
        return;
      }
      setWorkspaceId(entry.workspace.id);
      setCurrentUserId(auth.user.id);
      setRole(entry.role);
      setWorkspaceRoles(Object.fromEntries(auth.workspaces.flatMap((item) =>
        item.workspace ? [[item.workspace.id, item.role]] : []
      )));
      setSoundEnabled(window.localStorage.getItem("relay-inbox-sound") === "true");
      setNotificationsEnabled(window.localStorage.getItem("relay-inbox-notifications") === "true");
    }).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) return;
      setError(cause instanceof Error ? cause.message : "Unable to load your account.");
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onWorkspaceChange = (event: Event) => {
      const nextWorkspaceId = (event as CustomEvent<string>).detail;
      if (typeof nextWorkspaceId !== "string") return;
      setWorkspaceId(nextWorkspaceId);
      setRole(workspaceRoles[nextWorkspaceId] ?? "");
    };
    window.addEventListener("relay-workspace-change", onWorkspaceChange);
    return () => window.removeEventListener("relay-workspace-change", onWorkspaceChange);
  }, [workspaceRoles]);

  useEffect(() => {
    if (!workspaceId) return;
    void loadConversations();
  }, [loadConversations, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void Promise.all([
      apiRequest<{ members: MemberOption[] }>(`/workspaces/${workspaceId}/members`),
      apiRequest<{ replies: CannedReply[] }>(`/workspaces/${workspaceId}/canned-replies`)
    ]).then(([memberResult, replyResult]) => {
      setMembers(memberResult.members.filter((member) => member.status === "active"));
      setCannedReplies(replyResult.replies);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Unable to load inbox tools.");
    });
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const socket = io(apiUrl, {
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setSocketStatus("Connected");
      socket.emit("inbox:join", { workspaceId }, (ack: SocketAck) => {
        if (!ack.ok) setError(ack.error?.message ?? "Unable to join the workspace inbox.");
      });
      refreshRef.current();
    });
    socket.on("disconnect", () => {
      setSocketStatus("Reconnecting…");
      setConversationReady(false);
    });
    socket.on("connect_error", () => setSocketStatus("Offline"));
    const upsert = (incoming: Partial<InboxConversation> & { id: string }) => {
      setConversations((current) => {
        const existing = current.find((item) => item.id === incoming.id);
        const merged = { ...existing, ...incoming } as InboxConversation;
        return [merged, ...current.filter((item) => item.id !== incoming.id)]
          .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
      });
    };
    socket.on("conversation:created", (item: InboxConversation) => { upsert(item); refreshRef.current(); });
    socket.on("conversation:updated", upsert);
    socket.on("conversation:assigned", upsert);
    socket.on("conversation:message", (message: InboxMessage & { conversationId?: string }) => {
      const id = message.conversationId ?? selectedRef.current;
      if (id === selectedRef.current) {
        setMessages((current) => mergeMessages(current, [message]));
        if (message.senderType === "visitor") setVisitorRead(false);
      } else if (message.senderType === "visitor") {
        if (soundEnabledRef.current) {
          try {
            const AudioContextClass = window.AudioContext;
            const audio = new AudioContextClass();
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.frequency.value = 660;
            gain.gain.value = 0.035;
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start();
            oscillator.stop(audio.currentTime + 0.12);
            oscillator.onended = () => void audio.close();
          } catch {
            setError("The notification sound could not be played by this browser.");
          }
        }
        if (notificationsEnabledRef.current && "Notification" in window && Notification.permission === "granted") {
          new Notification("New visitor message", { body: message.body.slice(0, 120) });
        }
      }
      refreshRef.current();
    });
    socket.on("unread:update", (unread: {
      conversationId: string; visitorUnreadCount: number; agentUnreadCount: number
    }) => {
      setConversations((current) => current.map((item) => item.id === unread.conversationId
        ? { ...item, visitorUnreadCount: unread.visitorUnreadCount, agentUnreadCount: unread.agentUnreadCount }
        : item));
    });
    socket.on("conversation:typing", (payload: { senderType: "visitor" | "agent"; isTyping: boolean }) => {
      if (payload.senderType !== "visitor") return;
      setTyping(payload.isTyping);
      if (visitorTypingTimeoutRef.current) window.clearTimeout(visitorTypingTimeoutRef.current);
      if (payload.isTyping) visitorTypingTimeoutRef.current = window.setTimeout(() => setTyping(false), 3000);
    });
    socket.on("conversation:read", (payload: { readerType: "visitor" | "agent" }) => {
      if (payload.readerType === "visitor") setVisitorRead(true);
    });
    socket.on("visitor:presence", (payload: { online: boolean }) => setVisitorOnline(payload.online));
    socket.on("conversation:resolved", () => {
      const id = selectedRef.current;
      setConversations((current) => current.map((item) => item.id === id ? { ...item, status: "resolved" } : item));
    });
    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [workspaceId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!workspaceId || !selectedId || !socket?.connected) {
      setConversationReady(false);
      setMessages([]);
      setVisitorDetails(null);
      setPriorConversations([]);
      setNotes([]);
      setDetailsTab("visitor");
      return;
    }
    let active = true;
    setConversationReady(false);
    setMessages([]);
    setVisitorDetails(null);
    setPriorConversations([]);
    socket.emit("conversation:join", { workspaceId, conversationId: selectedId },
      (ack: SocketAck<{ messages: InboxMessage[] }>) => {
        if (!active) return;
        if (!ack.ok) {
          setError(ack.error?.message ?? "Unable to open this conversation.");
          return;
        }
        setMessages(mergeMessages([], ack.data?.messages ?? []));
        setConversationReady(true);
        setError("");
        socket.emit("conversation:read", { workspaceId, conversationId: selectedId });
        socket.emit("visitor:details", { workspaceId, conversationId: selectedId },
          (detailsAck: SocketAck<InboxVisitor>) => {
            if (active && detailsAck.ok && detailsAck.data) setVisitorDetails(detailsAck.data);
          });
      });
    if (selectedVisitorId) {
      const params = new URLSearchParams({ visitorId: selectedVisitorId, limit: "20" });
      void apiRequest<{ conversations: InboxConversation[] }>(
        `/workspaces/${workspaceId}/conversations?${params.toString()}`
      ).then((result) => {
        if (active) setPriorConversations(result.conversations.filter((item) => item.id !== selectedId));
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load conversation history.");
      });
    }
    void apiRequest<{ notes: InternalNote[] }>(
      `/workspaces/${workspaceId}/conversations/${selectedId}/notes`
    ).then((result) => {
      if (active) setNotes(result.notes);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load internal notes.");
    });
    setMobileView("thread");
    return () => { active = false; };
  }, [selectedId, selectedVisitorId, socketStatus, workspaceId]);

  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [messages.length, selectedId]);

  const selected = conversations.find((item) => item.id === selectedId);
  const details = visitorDetails ?? selected?.visitor ?? null;
  const assignable = role === "owner" || role === "admin" || role === "supervisor";

  function updateConversation(changes: Record<string, unknown>) {
    const socket = socketRef.current;
    if (!socket?.connected || !workspaceId || !selectedId) return;
    socket.emit("conversation:update", { workspaceId, conversationId: selectedId, ...changes },
      (ack: SocketAck<{ conversation: InboxConversation }>) => {
        if (!ack.ok) setError(ack.error?.message ?? "Unable to update the conversation.");
        else if (ack.data?.conversation) {
          setConversations((current) => current.map((item) =>
            item.id === selectedId ? { ...item, ...ack.data?.conversation } : item
          ));
        }
      });
  }

  function assignConversation(agentId: string) {
    const socket = socketRef.current;
    if (!socket?.connected || !workspaceId || !selectedId) return;
    socket.emit("conversation:assign", {
      workspaceId,
      conversationId: selectedId,
      assignedAgentId: agentId || null
    }, (ack: SocketAck<{ conversation: InboxConversation }>) => {
      if (!ack.ok) setError(ack.error?.message ?? "Unable to reassign conversation.");
      else if (ack.data?.conversation) {
        setConversations((current) => current.map((item) =>
          item.id === selectedId ? { ...item, ...ack.data?.conversation } : item
        ));
      }
    });
  }

  function sendMessage(event?: FormEvent<HTMLFormElement>, retry?: InboxMessage) {
    event?.preventDefault();
    const body = (retry?.body ?? draft).trim();
    if (!body || !selected || !conversationReady) return;
    setAgentTyping(false);
    const clientMessageId = retry?.clientMessageId ?? crypto.randomUUID();
    const optimistic: InboxMessage = {
      id: retry?.id,
      clientMessageId,
      senderType: "agent",
      body,
      createdAt: retry?.createdAt ?? new Date().toISOString(),
      status: "sending"
    };
    setMessages((current) => mergeMessages(current, [optimistic]));
    setDraft("");
    const socket = socketRef.current;
    if (!socket?.connected) {
      setMessages((current) => current.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, status: "failed" } : item
      ));
      setError("The inbox is disconnected. Reconnect before retrying this message.");
      return;
    }

    socket.timeout(8_000).emit("message:send", {
      workspaceId, conversationId: selected.id, clientMessageId, body
    }, (timeoutError: Error | null, ack: SocketAck<{ message: InboxMessage }>) => {
      if (timeoutError || !ack.ok || !ack.data?.message) {
        const acknowledgementError = ack.ok ? undefined : ack.error?.message;
        setMessages((current) => current.map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, status: "failed" } : item
        ));
        setError(timeoutError ? "Message delivery timed out. Retry safely with the same message key." :
          acknowledgementError ?? "Unable to send this message.");
        return;
      }
      const deliveredMessage = ack.data.message;
      setMessages((current) => mergeMessages(current, [deliveredMessage]));
      setVisitorRead(false);
      setError("");
    });
  }

  async function submitInternalNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = noteDraft.trim();
    if (!body || !selected || noteBusy) return;
    setNoteBusy(true);
    try {
      const result = await apiRequest<{ note: InternalNote }>(
        `/workspaces/${workspaceId}/conversations/${selected.id}/notes`,
        { method: "POST", body: JSON.stringify({ body }) }
      );
      setNotes((current) => [...current, result.note]);
      setNoteDraft("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save internal note.");
    } finally {
      setNoteBusy(false);
    }
  }

  async function loadOlderMessages() {
    if (!selected || !messages.length) return;
    const before = messages[0].createdAt;
    try {
      const result = await apiRequest<{ messages: InboxMessage[] }>(
        `/workspaces/${workspaceId}/conversations/${selected.id}/messages?before=${encodeURIComponent(before)}&limit=50`
      );
      setMessages((current) => mergeMessages(result.messages, current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load older messages.");
    }
  }

  function toggleSound() {
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    window.localStorage.setItem("relay-inbox-sound", String(enabled));
  }

  function setAgentTyping(isTyping: boolean) {
    if (!selectedId || !workspaceId) return;
    if (isTyping) {
      if (!agentIsTypingRef.current) {
        socketRef.current?.emit("typing:set", { workspaceId, conversationId: selectedId, isTyping: true });
        agentIsTypingRef.current = true;
      }
      if (agentTypingTimeoutRef.current) window.clearTimeout(agentTypingTimeoutRef.current);
      agentTypingTimeoutRef.current = window.setTimeout(() => {
        socketRef.current?.emit("typing:set", { workspaceId, conversationId: selectedId, isTyping: false });
        agentIsTypingRef.current = false;
      }, 1200);
    } else if (agentIsTypingRef.current) {
      if (agentTypingTimeoutRef.current) window.clearTimeout(agentTypingTimeoutRef.current);
      socketRef.current?.emit("typing:set", { workspaceId, conversationId: selectedId, isTyping: false });
      agentIsTypingRef.current = false;
    }
  }

  async function toggleNotifications() {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      window.localStorage.setItem("relay-inbox-notifications", "false");
      return;
    }
    if (!("Notification" in window)) {
      setError("This browser does not support desktop notifications.");
      return;
    }
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") {
      setError("Desktop notification permission was not granted.");
      return;
    }
    setNotificationsEnabled(true);
    window.localStorage.setItem("relay-inbox-notifications", "true");
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" }, { id: "unassigned", label: "Unassigned" },
    { id: "mine", label: "My conversations" }, { id: "open", label: "Open" },
    { id: "pending", label: "Pending" }, { id: "resolved", label: "Resolved" },
    { id: "unread", label: "Unread" }
  ];

  return <section className="min-w-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Inbox</h1><p className="mt-1 text-sm text-slate-600">Live conversations · {conversations.length} loaded</p></div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className={`size-2 rounded-full ${socketStatus === "Connected" ? "bg-green-500" : "bg-amber-500"}`} />
        {socketStatus}
        <button type="button" onClick={toggleSound} aria-label={soundEnabled ? "Disable sound notifications" : "Enable sound notifications"} title="Sound notifications" className="ml-2 rounded p-2 hover:bg-slate-200">{soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        <button type="button" onClick={() => void toggleNotifications()} aria-label={notificationsEnabled ? "Disable desktop notifications" : "Enable desktop notifications"} title="Desktop notifications" className="rounded p-2 hover:bg-slate-200"><Bell size={17} /></button>
      </div>
    </div>
    {error ? <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    <div className="grid min-h-[min(720px,calc(100dvh-190px))] overflow-hidden rounded-lg border border-slate-200 bg-white lg:grid-cols-[270px_minmax(0,1fr)_270px]">
      <aside aria-label="Conversation list" className={`${mobileView === "list" ? "flex" : "hidden"} min-h-[560px] flex-col border-b border-slate-200 lg:flex lg:border-b-0 lg:border-r`}>
        <div className="border-b border-slate-200 p-3">
          <label className="sr-only" htmlFor="inbox-search">Search conversations</label>
          <div className="flex items-center gap-2 rounded-md border border-slate-300 px-2"><Search size={16} className="text-slate-400" /><input id="inbox-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search visitors or messages" className="min-h-9 min-w-0 flex-1 text-xs outline-none" /></div>
          <nav aria-label="Conversation filters" className="mt-3 grid grid-cols-2 gap-1">
            {filters.map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`min-h-8 rounded px-2 text-left text-xs ${filter === item.id ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}>{item.label}{item.id === "unread" ? <span className="ml-1 text-slate-400">{conversations.filter((conversation) => conversation.agentUnreadCount > 0).length || ""}</span> : null}</button>)}
          </nav>
          {["owner", "admin", "supervisor"].includes(role) ? <label className="mt-2 block text-[10px] font-medium text-slate-500">Assigned agent<select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="mt-1 min-h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"><option value="">Any agent</option><option value="__unassigned">Unassigned</option>{members.filter((member) => member.userId).map((member) => <option key={member.userId} value={member.userId!}>{member.name || member.email}</option>)}</select></label> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <p role="status" className="p-4 text-sm text-slate-500">Loading conversations…</p>
            : conversations.length === 0 ? <p className="p-4 text-sm text-slate-500">No conversations match this view.</p>
            : conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => { setSelectedId(conversation.id); setMobileView("thread"); setShowDetails(false); }} aria-current={selectedId === conversation.id ? "true" : undefined} className={`w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 ${selectedId === conversation.id ? "bg-blue-50" : ""}`}>
              <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{visitorLabel(conversation.visitor)}</span>{conversation.agentUnreadCount > 0 ? <span className="min-w-5 rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-[10px] text-white">{conversation.agentUnreadCount}</span> : null}</span>
              <span className="mt-1 block truncate text-xs text-slate-500">{conversation.lastMessagePreview || "No messages yet"}</span>
              <span className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400"><span className="truncate capitalize">{conversation.status} · {conversation.assignedAgentId ? "Assigned" : "Unassigned"}</span><time>{formatTime(conversation.lastMessageAt)}</time></span>
            </button>)}
          {hasMore ? <button type="button" onClick={() => void loadConversations(true)} disabled={loadingMore} className="w-full p-3 text-xs font-medium text-blue-700 disabled:opacity-50">{loadingMore ? "Loading…" : "Load older conversations"}</button> : null}
        </div>
      </aside>

      <div className={`${mobileView === "thread" ? "flex" : "hidden"} min-h-[560px] min-w-0 flex-col lg:flex`}>
        {selected ? <>
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" onClick={() => setMobileView("list")} aria-label="Back to conversations" className="rounded p-1 hover:bg-slate-100 lg:hidden"><ChevronLeft size={18} /></button>
              <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{selected.subject || visitorLabel(selected.visitor)}</h2><p className="text-xs capitalize text-slate-500">{selected.status} · {visitorOnline ? "Visitor online" : "Visitor"}</p></div>
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="conversation-status">Conversation status</label>
              <select id="conversation-status" value={selected.status} onChange={(event) => {
                const status = event.target.value;
                if (status === "resolved" && !window.confirm("Resolve this conversation? You can reopen it later.")) return;
                updateConversation({ status });
              }} className="min-h-8 rounded-md border border-slate-300 bg-white px-2 text-xs">
                <option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option>
              </select>
              <label className="sr-only" htmlFor="conversation-priority">Priority</label>
              <select id="conversation-priority" value={selected.priority} onChange={(event) => updateConversation({ priority: event.target.value })} className="min-h-8 rounded-md border border-slate-300 bg-white px-2 text-xs">
                {(["low", "normal", "high", "urgent"] as const).map((value) => <option key={value} value={value}>{value} priority</option>)}
              </select>
              <button type="button" onClick={() => { setShowDetails((value) => !value); setMobileView(showDetails ? "thread" : "details"); }} aria-expanded={showDetails} className="rounded-md border border-slate-300 px-2 py-2 text-xs lg:hidden">Details</button>
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs">
            <span className="text-slate-500">Assign</span>
            {assignable ? <select aria-label="Assign conversation" value={selected.assignedAgentId ?? ""} onChange={(event) => assignConversation(event.target.value)} className="min-h-8 max-w-44 rounded border border-slate-300 bg-white px-2 text-xs">
              <option value="">Unassigned</option>{members.filter((member) => member.userId && member.status === "active").map((member) => <option key={member.userId} value={member.userId!}>{member.name || member.email} ({member.role})</option>)}
            </select>             : <span className="font-medium">{selected.assignedAgentId === currentUserId ? "You" : members.find((member) => member.userId === selected.assignedAgentId)?.name ?? "Unassigned"}</span>}
            <div className="ml-auto flex items-center gap-1">
              {selected.tags.map((tag) => <button key={tag} type="button" title={`Remove ${tag}`} onClick={() => updateConversation({ tags: selected.tags.filter((value) => value !== tag) })} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{tag} ×</button>)}
              <form onSubmit={(event) => { event.preventDefault(); const tag = tagDraft.trim(); if (tag && !selected.tags.includes(tag)) updateConversation({ tags: [...selected.tags, tag] }); setTagDraft(""); }} className="flex items-center">
                <label htmlFor="inbox-add-tag" className="sr-only">Add conversation tag</label><input id="inbox-add-tag" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} maxLength={40} placeholder="+ tag" className="w-16 border-b border-dashed border-slate-300 py-1 text-[10px] outline-none" />
              </form>
            </div>
          </div>
          <div ref={historyRef} aria-live="polite" aria-label="Conversation messages" className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
            {messages.length >= 50 ? <button type="button" onClick={() => void loadOlderMessages()} className="mx-auto block text-xs text-blue-700 hover:underline">Load older messages</button> : null}
            {!conversationReady ? <p role="status" className="text-center text-xs text-slate-400">Loading conversation…</p>
              : messages.length ? messages.map((message) => <article key={message.id ?? message.clientMessageId} className={`max-w-[88%] rounded-lg p-3 text-sm ${message.senderType === "agent" ? "ml-auto bg-blue-600 text-white" : message.senderType === "system" ? "mx-auto bg-amber-50 text-slate-600" : "bg-slate-100 text-slate-900"}`}>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <div className="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-70"><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>{message.status === "sending" ? <span>Sending…</span> : null}{message.status === "failed" ? <button type="button" onClick={() => sendMessage(undefined, message)} className="underline">Retry</button> : null}{message.senderType === "agent" && message.status === "sent" ? <span>{visitorRead ? "Seen" : "Sent"}</span> : null}</div>
              </article>) : <p className="text-center text-sm text-slate-500">No messages yet. Send a reply to start the conversation.</p>}
            {typing ? <p className="text-xs text-slate-500" aria-live="polite">Visitor is typing…</p> : null}
          </div>
          <div className="border-t border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="relative">
                <button type="button" aria-expanded={showCannedReplies} onClick={() => setShowCannedReplies((value) => !value)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Canned replies <ChevronDown size={13} /></button>
                {showCannedReplies ? <div className="absolute bottom-8 left-0 z-10 max-h-56 w-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">{cannedReplies.length ? cannedReplies.map((reply) => <button key={reply.id} type="button" onClick={() => { setDraft((value) => `${value}${value ? "\n" : ""}${reply.body}`); setShowCannedReplies(false); }} className="block w-full rounded p-2 text-left hover:bg-slate-50"><span className="block text-xs font-medium">{reply.title}</span><span className="mt-1 block line-clamp-2 text-[10px] text-slate-500">{reply.body}</span></button>) : <p className="p-2 text-xs text-slate-500">No canned replies configured.</p>}</div> : null}
              </div>
              <span className="text-[10px] text-slate-400">Enter to send · Shift+Enter for new line</span>
            </div>
            <form onSubmit={(event) => sendMessage(event)} className="flex items-end gap-2">
              <label htmlFor="inbox-message" className="sr-only">Write a reply</label>
              <textarea id="inbox-message" value={draft} onChange={(event) => { setDraft(event.target.value); setAgentTyping(true); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }} maxLength={10_000} disabled={!conversationReady || selected.status === "resolved"} rows={2} placeholder={selected.status === "resolved" ? "Reopen the conversation to reply" : "Write a reply…"} className="min-h-12 flex-1 resize-y rounded-md border border-slate-300 p-2 text-sm disabled:bg-slate-100" />
              <button type="submit" disabled={!draft.trim() || !conversationReady || selected.status === "resolved"} aria-label="Send reply" className="flex min-h-10 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"><Send size={15} /><span className="hidden sm:inline">Send</span></button>
            </form>
            <p className="mt-1 text-right text-[10px] text-slate-400">{draft.length}/10000</p>
          </div>
        </> : <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500"><div><Headphones size={28} className="mx-auto mb-2 text-slate-300" /><p>Select a conversation to view and reply.</p></div></div>}
      </div>

      <aside aria-label="Visitor details" className={`${mobileView === "details" ? "block" : "hidden"} min-h-[560px] overflow-y-auto border-l border-slate-200 p-4 lg:block`}>
        {selected ? <>
          <div className="mb-4 flex items-center gap-2"><button type="button" onClick={() => setMobileView("thread")} aria-label="Back to conversation" className="rounded p-1 hover:bg-slate-100 lg:hidden"><ChevronLeft size={18} /></button><h3 className="text-sm font-semibold">Visitor details</h3></div>
          <div role="tablist" aria-label="Visitor tools" className="mb-4 flex border-b border-slate-200">
            <button type="button" role="tab" aria-selected={detailsTab === "visitor"} onClick={() => setDetailsTab("visitor")} className={`border-b-2 px-3 py-2 text-xs ${detailsTab === "visitor" ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-slate-500"}`}>Visitor</button>
            <button type="button" role="tab" aria-selected={detailsTab === "notes"} onClick={() => setDetailsTab("notes")} className={`border-b-2 px-3 py-2 text-xs ${detailsTab === "notes" ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-slate-500"}`}>Internal notes</button>
          </div>
          {detailsTab === "notes" ? <div>
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900">Internal only. Notes are saved to the dashboard and are never sent to the visitor.</p>
            <form onSubmit={(event) => void submitInternalNote(event)} className="space-y-2">
              <label htmlFor="internal-note" className="sr-only">Write an internal note</label>
              <textarea id="internal-note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={5000} rows={3} placeholder="Add a note for your team…" className="w-full resize-y rounded border border-slate-300 p-2 text-xs" />
              <button type="submit" disabled={!noteDraft.trim() || noteBusy} className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{noteBusy ? "Saving…" : "Add note"}</button>
            </form>
            <ul className="mt-4 space-y-3">{notes.map((note) => <li key={note.id} className="rounded border border-amber-100 bg-amber-50/50 p-2"><p className="whitespace-pre-wrap break-words text-xs text-slate-800">{note.body}</p><p className="mt-2 text-[10px] text-slate-500">{note.author} · {new Date(note.createdAt).toLocaleString()}</p></li>)}</ul>
            {!notes.length ? <p className="mt-4 text-xs text-slate-500">No internal notes yet.</p> : null}
          </div> : <>
          <div className="border-b border-slate-100 pb-4"><div className="flex size-10 items-center justify-center rounded-full bg-blue-50 font-semibold text-blue-700">{visitorLabel(details).slice(0, 1).toUpperCase()}</div><p className="mt-2 break-words text-sm font-medium">{visitorLabel(details)}</p><p className="break-all text-xs text-slate-500">{details?.email || "No email provided"}</p>{details?.phone ? <p className="mt-1 text-xs text-slate-500">{details.phone}</p> : null}</div>
          <dl className="space-y-3 border-b border-slate-100 py-4 text-xs">
            <div><dt className="text-slate-400">Website</dt><dd className="mt-0.5 break-words text-slate-700">{selected.website?.name ?? selected.website?.domain ?? "Website"}</dd></div>
            <div><dt className="text-slate-400">Current page</dt><dd className="mt-0.5 break-all text-blue-700">{details?.currentPageUrl ? <a href={details.currentPageUrl} target="_blank" rel="noreferrer">{safePath(details.currentPageUrl)}</a> : "Unknown"}</dd></div>
            {details?.referrer ? <div><dt className="text-slate-400">Referrer</dt><dd className="mt-0.5 break-all text-slate-700">{details.referrer}</dd></div> : null}
            <div><dt className="text-slate-400">First seen</dt><dd className="mt-0.5 text-slate-700">{details?.firstSeenAt ? new Date(details.firstSeenAt).toLocaleString() : "—"}</dd></div>
            <div><dt className="text-slate-400">Last seen</dt><dd className="mt-0.5 text-slate-700">{details?.lastSeenAt ? new Date(details.lastSeenAt).toLocaleString() : "—"}</dd></div>
            <div><dt className="text-slate-400">Browser / OS</dt><dd className="mt-0.5 text-slate-700">{[details?.browser, details?.operatingSystem].filter(Boolean).join(" · ") || "Unknown"}</dd></div>
          </dl>
          <div className="border-b border-slate-100 py-4"><h4 className="mb-2 text-xs font-semibold">Previous conversations</h4>{priorConversations.length ? <ul className="space-y-2">{priorConversations.map((conversation) => <li key={conversation.id}><button type="button" onClick={() => { setSelectedId(conversation.id); setMobileView("thread"); }} className="w-full text-left"><span className="block truncate text-xs text-slate-700">{conversation.lastMessagePreview || conversation.subject || "Conversation"}</span><span className="text-[10px] capitalize text-slate-400">{conversation.status} · {formatTime(conversation.lastMessageAt)}</span></button></li>)}</ul> : <p className="text-xs text-slate-500">No earlier conversations.</p>}</div>
          <div className="py-4"><h4 className="mb-2 text-xs font-semibold">Custom attributes</h4>{details?.customAttributes && Object.keys(details.customAttributes).length ? <dl className="space-y-2">{Object.entries(details.customAttributes).map(([key, value]) => <div key={key}><dt className="text-[10px] text-slate-400">{key}</dt><dd className="break-words text-xs text-slate-700">{String(value)}</dd></div>)}</dl> : <p className="text-xs text-slate-500">No custom attributes.</p>}</div>
          <div className="mb-2 flex items-center gap-1 text-xs text-slate-500"><CircleDot size={12} />{selected.priority} priority</div>
          </>}
        </> : <p className="text-sm text-slate-500">Select a conversation to see visitor details.</p>}
      </aside>
    </div>
  </section>;
}
