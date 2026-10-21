import { io, type Socket } from "socket.io-client";

export const widgetPackageVersion = "0.2.0";

type WidgetConfig = {
  accentColor: string;
  welcomeMessage: string;
  position: "bottom-right" | "bottom-left";
  title: string;
  subtitle: string;
  launcherLabel: string;
  launcherIcon: "chat" | "message";
  logoUrl?: string | null;
  theme: "light" | "dark";
  onlineText: string;
  offlineText: string;
  greeting: string;
  collectName: boolean;
  collectEmail: boolean;
  offlineContactForm: boolean;
  availableBySchedule: boolean;
};

type ChatMessage = {
  id?: string;
  clientMessageId: string;
  senderType: "visitor" | "agent" | "system";
  body: string;
  createdAt: string;
  status: "sending" | "sent" | "failed";
};

type InitResponse = {
  visitorToken: string;
  website: { name: string };
  config: WidgetConfig;
};

type ConversationResponse = {
  conversationId: string;
  status: "open" | "pending" | "resolved";
  messages: Omit<ChatMessage, "status">[];
};

type SocketAck<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const mountedScripts = new WeakSet<HTMLScriptElement>();
const styleText = `
:host{all:initial;position:fixed;z-index:2147483000;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;font-size:14px;line-height:1.45}
:host([data-position="bottom-left"]){left:20px;right:auto}
:host([data-position="bottom-right"]){right:20px;left:auto}
.launcher{position:fixed;bottom:20px;right:20px;display:flex;align-items:center;gap:10px;border:0;border-radius:999px;padding:12px 18px;background:var(--accent);color:#fff;font:inherit;font-size:14px;font-weight:600;box-shadow:0 4px 18px #0f172a26;cursor:pointer;min-height:52px}
:host([data-position="bottom-left"]) .launcher{left:20px;right:auto}
.launcher:hover{filter:brightness(.96)}.launcher:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}
.launcher-icon{width:21px;height:21px;display:grid;place-items:center}
.panel{position:fixed;bottom:86px;right:20px;width:min(380px,calc(100vw - 32px));height:min(620px,calc(100dvh - 112px));display:flex;flex-direction:column;overflow:hidden;border:1px solid #cbd5e1;border-radius:16px;background:var(--surface);color:var(--text);box-shadow:0 14px 44px #0f172a30}
:host([data-position="bottom-left"]) .panel{left:20px;right:auto}
.panel[hidden]{display:none}
.dark{--surface:#111827;--text:#f8fafc;--muted:#a8b3c4;--line:#334155;--surface-muted:#1f2937;--agent:#1e3a5f}
.light{--surface:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--surface-muted:#f1f5f9;--agent:#eff6ff}
.header{display:flex;align-items:center;gap:11px;background:var(--accent);color:#fff;padding:15px 16px}
.logo{width:38px;height:38px;flex:0 0 38px;object-fit:cover;border-radius:50%;background:#ffffff33}
.brand{min-width:0;flex:1}.title{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.subtitle{font-size:12px;opacity:.88}
.actions{display:flex;gap:4px}.icon-button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
.icon-button:hover{background:#ffffff24}
.availability{display:flex;align-items:center;gap:7px;padding:10px 16px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)}
.dot{width:7px;height:7px;border-radius:50%;background:#22c55e}.dot.offline{background:#94a3b8}
.history{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:11px;overscroll-behavior:contain}
.greeting{max-width:90%;padding:11px 13px;border-radius:4px 14px 14px;background:var(--surface-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.message{max-width:88%;padding:10px 12px;border-radius:14px;background:var(--surface-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.message.visitor{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:4px}
.message.agent,.message.system{align-self:flex-start;border-bottom-left-radius:4px}
.time{display:block;margin-top:4px;font-size:10px;opacity:.7}
.delivery{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:10px;opacity:.85}.retry{border:0;padding:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}
.typing{color:var(--muted);font-size:12px;min-height:17px;padding:0 16px 7px}
.contact-fields{display:flex;gap:8px;padding:10px 12px 0}.contact-fields[hidden]{display:none}
.contact-fields input{min-width:0;flex:1;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);padding:8px;font:inherit;font-size:12px}
.composer{display:flex;align-items:flex-end;gap:8px;padding:12px;border-top:1px solid var(--line)}
.composer textarea{flex:1;min-height:42px;max-height:120px;resize:vertical;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);padding:10px;font:inherit;font-size:14px}
.composer textarea::placeholder{color:var(--muted)}
.send{height:42px;min-width:64px;border:0;border-radius:9px;padding:0 12px;background:var(--accent);color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer}.send:disabled{opacity:.55;cursor:wait}
.unread-badge{display:grid;place-items:center;min-width:19px;height:19px;padding:0 4px;border-radius:999px;background:#dc2626;color:#fff;font-size:11px}
.error{display:none;color:#b91c1c;padding:0 13px 8px;font-size:12px}.error[data-visible="true"]{display:block}
.status{position:absolute;left:-9999px}
@media(max-width:560px){.panel{position:fixed;inset:0;width:100vw;height:100dvh;max-height:none;border:0;border-radius:0}.launcher{bottom:14px;right:14px}:host([data-position="bottom-left"]) .launcher{left:14px}.header{padding-top:max(15px,env(safe-area-inset-top))}.composer{padding-bottom:max(12px,env(safe-area-inset-bottom))}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
`;

function createElement<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function icon(kind: "chat" | "message"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "21");
  svg.setAttribute("height", "21");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    kind === "chat"
      ? "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"
      : "M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"
  );
  svg.append(path);
  return svg;
}

function randomVisitorId(): string {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function visitorId(widgetId: string): string {
  const key = `relay-chat-visitor:${widgetId}`;
  try {
    const cached = window.localStorage.getItem(key);
    if (cached && /^[a-f\d]{64}$/.test(cached)) return cached;
    const created = randomVisitorId();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return randomVisitorId();
  }
}

function apiUrlFromScript(script: HTMLScriptElement): string {
  const configured = script.dataset.apiUrl?.trim();
  if (configured) return new URL(configured).origin;
  try {
    const scriptOrigin = new URL(script.src).origin;
    if (new URL(script.src).hostname === "localhost" || new URL(script.src).hostname === "127.0.0.1") {
      return "http://localhost:4000";
    }
    return scriptOrigin;
  } catch {
    return "http://localhost:4000";
  }
}

function makeClientMessageId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${randomVisitorId().slice(0, 24)}`;
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function addMessage(history: HTMLElement, message: ChatMessage, onRetry: (message: ChatMessage) => void) {
  const node = createElement("div", `message ${message.senderType}`);
  node.dataset.messageId = message.id ?? message.clientMessageId;
  const body = createElement("div", undefined, message.body);
  node.append(body);
  if (message.createdAt) node.append(createElement("time", "time", timestamp(message.createdAt)));
  if (message.senderType === "visitor") {
    const delivery = createElement("div", "delivery");
    if (message.status === "failed") {
      delivery.append(document.createTextNode("Not sent · "));
      const retry = createElement("button", "retry", "Retry");
      retry.type = "button";
      retry.setAttribute("aria-label", "Retry sending message");
      retry.addEventListener("click", () => onRetry(message));
      delivery.append(retry);
    } else {
      delivery.textContent = message.status === "sending" ? "Sending…" : "Sent";
    }
    node.append(delivery);
  }
  history.append(node);
}

async function bootstrap(script: HTMLScriptElement): Promise<void> {
  const widgetId = script.dataset.widgetId?.trim();
  if (!widgetId || !/^[A-Za-z0-9_-]{32}$/.test(widgetId) || mountedScripts.has(script)) return;
  mountedScripts.add(script);
  const apiUrl = apiUrlFromScript(script);
  const storedVisitorId = visitorId(widgetId);
  const currentPageUrl = `${window.location.origin}${window.location.pathname}`;
  const initResponse = await fetch(`${apiUrl}/widget/init`, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "X-Public-Widget-Id": widgetId
    },
    body: JSON.stringify({
      widgetId,
      visitorId: storedVisitorId,
      currentPageUrl,
      ...(document.referrer ? { referrer: new URL(document.referrer).origin } : {})
    })
  });
  if (!initResponse.ok) throw new Error("This chat widget could not be initialized.");
  const initialized = (await initResponse.json()) as InitResponse;
  const config = initialized.config;
  const host = document.createElement("div");
  host.dataset.position = config.position === "bottom-left" ? "bottom-left" : "bottom-right";
  host.style.setProperty("--accent", /^#[\da-f]{6}$/i.test(config.accentColor) ? config.accentColor : "#2564e5");
  const shadow = host.attachShadow({ mode: "open" });
  const style = createElement("style");
  style.textContent = styleText;
  shadow.append(style);

  const launcher = createElement("button", "launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-label", config.launcherLabel || "Open chat");
  const launcherIcon = createElement("span", "launcher-icon");
  launcherIcon.append(icon(config.launcherIcon === "message" ? "message" : "chat"));
  const launcherText = createElement("span", undefined, config.launcherLabel || "Chat");
  const unreadBadge = createElement("span", "unread-badge", "");
  unreadBadge.hidden = true;
  unreadBadge.setAttribute("aria-hidden", "true");
  launcher.append(launcherIcon, launcherText, unreadBadge);

  const panel = createElement("section", `panel ${config.theme === "dark" ? "dark" : "light"}`);
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", config.title || initialized.website.name);
  const header = createElement("header", "header");
  if (config.logoUrl) {
    const logo = createElement("img", "logo");
    logo.src = config.logoUrl;
    logo.alt = "";
    logo.referrerPolicy = "no-referrer";
    header.append(logo);
  } else {
    const logo = createElement("div", "logo");
    logo.setAttribute("aria-hidden", "true");
    logo.append(icon("chat"));
    header.append(logo);
  }
  const brand = createElement("div", "brand");
  brand.append(
    createElement("div", "title", config.title || initialized.website.name),
    createElement("div", "subtitle", config.subtitle || "")
  );
  const actions = createElement("div", "actions");
  const minimize = createElement("button", "icon-button", "−");
  minimize.type = "button";
  minimize.setAttribute("aria-label", "Minimize chat");
  const close = createElement("button", "icon-button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close chat");
  actions.append(minimize, close);
  header.append(brand, actions);
  const availability = createElement("div", "availability");
  const availabilityDot = createElement("span", "dot offline");
  const availabilityLabel = createElement("span", undefined, config.offlineText || "Connecting…");
  availability.append(availabilityDot, availabilityLabel);
  const history = createElement("div", "history");
  history.setAttribute("aria-label", "Conversation messages");
  history.setAttribute("aria-live", "polite");
  const greeting = createElement("div", "greeting", config.greeting || config.welcomeMessage);
  history.append(greeting);
  const typing = createElement("div", "typing");
  typing.setAttribute("aria-live", "polite");
  const contactFields = createElement("div", "contact-fields");
  const nameInput = createElement("input");
  nameInput.type = "text";
  nameInput.name = "name";
  nameInput.autocomplete = "name";
  nameInput.maxLength = 120;
  nameInput.placeholder = "Your name";
  nameInput.setAttribute("aria-label", "Your name");
  const emailInput = createElement("input");
  emailInput.type = "email";
  emailInput.name = "email";
  emailInput.autocomplete = "email";
  emailInput.maxLength = 254;
  emailInput.placeholder = "Email address";
  emailInput.setAttribute("aria-label", "Email address");
  if (config.collectName || config.offlineContactForm) contactFields.append(nameInput);
  if (config.collectEmail || config.offlineContactForm) contactFields.append(emailInput);
  contactFields.hidden = contactFields.childElementCount === 0;
  const composer = createElement("form", "composer");
  const textarea = createElement("textarea");
  textarea.setAttribute("aria-label", "Type a message");
  textarea.placeholder = config.welcomeMessage || "Write your message…";
  textarea.maxLength = 10_000;
  const sendButton = createElement("button", "send", "Send");
  sendButton.type = "submit";
  composer.append(textarea, sendButton);
  const errorMessage = createElement("div", "error");
  errorMessage.setAttribute("role", "alert");
  const liveStatus = createElement("div", "status");
  liveStatus.setAttribute("aria-live", "polite");
  panel.append(header, availability, history, typing, contactFields, errorMessage, composer, liveStatus);
  shadow.append(launcher, panel);
  document.body.append(host);

  let socket: Socket | undefined;
  let conversationId = "";
  let isOpen = false;
  let unread = 0;
  let profileSaved = false;
  const messages = new Map<string, ChatMessage>();
  const visitorToken = initialized.visitorToken;
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${visitorToken}`,
    "X-Public-Widget-Id": widgetId
  });
  const showError = (message: string) => {
    errorMessage.textContent = message;
    errorMessage.dataset.visible = "true";
  };
  const clearError = () => {
    errorMessage.textContent = "";
    errorMessage.dataset.visible = "false";
  };
  const scrollToBottom = () => { history.scrollTop = history.scrollHeight; };
  const onRetry = (message: ChatMessage) => void sendMessage(message.body, message.clientMessageId);

  function displayMessage(incoming: Omit<ChatMessage, "status"> | ChatMessage) {
    const key = incoming.id || incoming.clientMessageId;
    if (messages.has(key)) return;
    if (incoming.clientMessageId && messages.has(incoming.clientMessageId)) {
      const old = messages.get(incoming.clientMessageId);
      if (old) {
        old.id = incoming.id;
        old.status = "sent";
        const currentNode = history.querySelector(`[data-message-id="${CSS.escape(incoming.clientMessageId)}"]`);
        if (currentNode) currentNode.remove();
      }
    }
    const message: ChatMessage = {
      ...incoming,
      clientMessageId: incoming.clientMessageId || incoming.id || makeClientMessageId(),
      status: "status" in incoming ? incoming.status : "sent"
    };
    messages.set(key, message);
    messages.set(message.clientMessageId, message);
    addMessage(history, message, onRetry);
    if (!isOpen && message.senderType === "agent") {
      unread += 1;
      unreadBadge.textContent = unread > 9 ? "9+" : String(unread);
      unreadBadge.hidden = false;
      launcher.setAttribute("aria-label", `${config.launcherLabel || "Open chat"}, ${unread} unread messages`);
      liveStatus.textContent = `${unread} unread message${unread === 1 ? "" : "s"}`;
    }
    scrollToBottom();
  }

  async function saveProfile() {
    if (profileSaved || (!nameInput.value.trim() && !emailInput.value.trim())) return;
    const body: Record<string, string> = {};
    if (nameInput.value.trim()) body.name = nameInput.value.trim();
    if (emailInput.value.trim()) body.email = emailInput.value.trim();
    const response = await fetch(`${apiUrl}/widget/profile`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error("Could not save contact details.");
    profileSaved = true;
  }

  async function openConversation() {
    const response = await fetch(`${apiUrl}/widget/conversation`, {
      method: "POST",
      headers: headers()
    });
    if (!response.ok) throw new Error("Unable to open this conversation. Please try again.");
    const result = (await response.json()) as ConversationResponse;
    conversationId = result.conversationId;
    history.replaceChildren();
    messages.clear();
    if (result.messages.length) {
      for (const message of result.messages) displayMessage({ ...message, status: "sent" });
    } else {
      history.append(createElement("div", "greeting", config.greeting || config.welcomeMessage));
    }
    if (result.status === "resolved") {
      availabilityLabel.textContent = config.offlineText;
    }
    socket = io(apiUrl, {
      auth: { visitorToken },
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
      timeout: 10_000
    });
    socket.on("connect", () => {
      availabilityDot.classList.remove("offline");
      availabilityLabel.textContent = config.availableBySchedule ? "Connected" : config.offlineText;
      socket?.timeout(8000).emit(
        "conversation:join",
        { conversationId },
        (timeoutError: Error | null, ack: SocketAck<{
          messages: Omit<ChatMessage, "status">[];
        }>) => {
          if (timeoutError) {
            showError("Unable to restore your conversation. Please reconnect.");
            return;
          }
          if (!ack.ok) {
            showError(ack.error.message);
            return;
          }
          for (const message of ack.data?.messages ?? []) displayMessage(message);
          socket?.emit("conversation:read", {}, (readAck: SocketAck) => {
            if (!readAck.ok) showError(readAck.error.message);
          });
        }
      );
    });
    socket.on("disconnect", () => {
      availabilityDot.classList.add("offline");
      availabilityLabel.textContent = config.offlineText || "Reconnecting…";
    });
    socket.on("connect_error", () => {
      availabilityDot.classList.add("offline");
      availabilityLabel.textContent = config.offlineText || "Reconnecting…";
    });
    socket.on("agent:presence", (presence: { online: boolean }) => {
      const online = Boolean(presence.online && config.availableBySchedule);
      availabilityDot.classList.toggle("offline", !online);
      availabilityLabel.textContent = online ? (config.onlineText || "We are online") : (config.offlineText || "Leave us a message");
    });
    socket.on("conversation:message", (message: Omit<ChatMessage, "status">) => displayMessage(message));
    socket.on("conversation:typing", (event: { senderType: string; isTyping: boolean }) => {
      typing.textContent = event.senderType === "agent" && event.isTyping ? "Agent is typing…" : "";
    });
    socket.on("conversation:resolved", () => {
      availabilityLabel.textContent = config.offlineText || "This conversation is closed";
      textarea.disabled = true;
      sendButton.disabled = true;
    });
    clearError();
    scrollToBottom();
  }

  async function sendMessage(body: string, clientMessageId = makeClientMessageId()) {
    const clean = body.trim();
    if (!clean || !conversationId || clean.length > 10_000) return;
    clearError();
    const existing = messages.get(clientMessageId);
    const optimistic: ChatMessage = existing ?? {
      clientMessageId,
      senderType: "visitor",
      body: clean,
      createdAt: new Date().toISOString(),
      status: "sending"
    };
    if (!existing) displayMessage(optimistic);
    else {
      existing.status = "sending";
      existing.body = clean;
      const oldNode = history.querySelector(`[data-message-id="${CSS.escape(clientMessageId)}"]`);
      oldNode?.remove();
      addMessage(history, optimistic, onRetry);
      messages.set(clientMessageId, optimistic);
    }
    try {
      await saveProfile();
      let resultMessage: Omit<ChatMessage, "status">;
      if (socket?.connected) {
        resultMessage = await new Promise<Omit<ChatMessage, "status">>((resolve, reject) => {
          socket?.timeout(8000).emit(
            "conversation:message",
            { clientMessageId, body: clean },
            (timeoutError: Error | null, ack: SocketAck<{ message: Omit<ChatMessage, "status"> }>) => {
              if (timeoutError) {
                reject(timeoutError);
                return;
              }
              if (!ack.ok) {
                reject(new Error(ack.error.message));
                return;
              }
              if (!ack.data?.message) {
                reject(new Error("Message acknowledgement was empty."));
                return;
              }
              resolve(ack.data.message);
            }
          );
        });
      } else {
        const response = await fetch(`${apiUrl}/widget/${conversationId}/messages`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ clientMessageId, body: clean })
        });
        const result = (await response.json()) as { message?: Omit<ChatMessage, "status">; error?: { message?: string } };
        if (!response.ok || !result.message) throw new Error(result.error?.message || "Message could not be sent.");
        resultMessage = result.message;
      }
      const existingNode = history.querySelector(`[data-message-id="${CSS.escape(clientMessageId)}"]`);
      existingNode?.remove();
      displayMessage({ ...resultMessage, status: "sent" });
    } catch (error) {
      optimistic.status = "failed";
      messages.set(clientMessageId, optimistic);
      const existingNode = history.querySelector(`[data-message-id="${CSS.escape(clientMessageId)}"]`);
      existingNode?.remove();
      addMessage(history, optimistic, onRetry);
      showError(error instanceof Error ? error.message : "Message could not be sent. Please retry.");
      scrollToBottom();
    }
  }

  async function setOpen(open: boolean) {
    isOpen = open;
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      unread = 0;
      unreadBadge.hidden = true;
      unreadBadge.textContent = "";
      launcher.setAttribute("aria-label", config.launcherLabel || "Open chat");
      launcher.focus();
      try {
        if (!conversationId) await openConversation();
        await saveProfile();
        textarea.focus();
      } catch (error) {
        showError(error instanceof Error ? error.message : "Unable to connect to chat.");
      }
    } else {
      launcher.focus();
    }
  }

  launcher.addEventListener("click", () => void setOpen(panel.hidden));
  close.addEventListener("click", () => void setOpen(false));
  minimize.addEventListener("click", () => void setOpen(false));
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = textarea.value;
    if (!body.trim()) return;
    textarea.value = "";
    void sendMessage(body);
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  let typingTimeout: number | undefined;
  textarea.addEventListener("input", () => {
    socket?.emit("conversation:typing", { isTyping: true });
    if (typingTimeout) window.clearTimeout(typingTimeout);
    typingTimeout = window.setTimeout(() => socket?.emit("conversation:typing", { isTyping: false }), 1200);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) void setOpen(false);
  });
}

function start() {
  const script = document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : document.querySelector<HTMLScriptElement>("script[data-widget-id]:not([data-relay-loaded])");
  if (!script || mountedScripts.has(script)) return;
  script.dataset.relayLoaded = "true";
  void bootstrap(script).catch((error: unknown) => {
    console.error("[Relay Chat] Widget initialization failed.", error);
  });
}

if (typeof document !== "undefined") {
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
