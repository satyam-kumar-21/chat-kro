// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const socket = {
  connected: true,
  handlers: new Map<string, (...args: unknown[]) => void>(),
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler);
    if (event === "connect") queueMicrotask(() => handler());
    return this;
  },
  emit(event: string, ...args: unknown[]) {
    const ack = args.at(-1);
    if (typeof ack === "function") {
      if (event === "conversation:message") {
        const data = args[0] as { clientMessageId: string; body: string };
        (ack as (error: null, result: unknown) => void)(null, {
          ok: true,
          data: {
            message: {
              id: "65a123456789012345678901",
              clientMessageId: data.clientMessageId,
              senderType: "visitor",
              body: data.body,
              createdAt: new Date().toISOString()
            }
          }
        });
      } else {
        (ack as (result: unknown) => void)({ ok: true, data: { joined: true } });
      }
    }
    return this;
  },
  timeout() {
    return this;
  },
  disconnect() {}
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => socket)
}));

describe("independent Shadow DOM widget", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.localStorage.clear();
    socket.handlers.clear();
    socket.connected = true;
    const script = document.createElement("script");
    script.dataset.widgetId = "Abcdefghijklmnopqrstuvwxyz123456";
    script.dataset.apiUrl = "https://api.example.test";
    document.head.append(script);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/widget/init")) {
        return {
          ok: true,
          json: async () => ({
            visitorToken: "signed.visitor.token",
            website: { name: "Test website" },
            config: {
              accentColor: "#2564E5",
              welcomeMessage: "Need help?",
              position: "bottom-right",
              title: "Test support",
              subtitle: "We reply soon",
              launcherLabel: "Open support",
              launcherIcon: "chat",
              theme: "light",
              onlineText: "Available",
              offlineText: "Offline",
              greeting: "Welcome visitor",
              collectName: false,
              collectEmail: false,
              offlineContactForm: false,
              availableBySchedule: true
            }
          })
        };
      }
      if (url.endsWith("/widget/conversation")) {
        return {
          ok: true,
          json: async () => ({ conversationId: "65b123456789012345678901", status: "open", messages: [] })
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders an isolated accessible panel and sends message text without parsing markup", async () => {
    await import("./index.js");
    await vi.waitFor(() => expect(document.body.querySelector("div")?.shadowRoot).toBeTruthy());

    const host = Array.from(document.body.querySelectorAll("div")).find((element) => element.shadowRoot);
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.querySelector("style")?.textContent).toContain(":host");
    const launcher = shadow?.querySelector<HTMLButtonElement>(".launcher");
    expect(launcher?.getAttribute("aria-label")).toBe("Open support");
    launcher?.click();

    const composer = shadow?.querySelector<HTMLFormElement>(".composer");
    const textarea = shadow?.querySelector<HTMLTextAreaElement>("textarea");
    expect(composer).toBeTruthy();
    if (!textarea || !composer) throw new Error("Widget composer did not render");
    await vi.waitFor(() => expect(shadow?.querySelector(".panel")?.hasAttribute("hidden")).toBe(false));
    await vi.waitFor(() => expect(socket.handlers.has("conversation:message")).toBe(true));
    textarea.value = "<img src=x onerror=alert(1)>hello";
    composer.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(shadow?.querySelector(".message.visitor")?.textContent).toContain("<img src=x onerror=alert(1)>hello");
      expect(shadow?.querySelector(".delivery")?.textContent).toContain("Sent");
    });
    expect(shadow?.querySelector(".message.visitor img")).toBeNull();
    expect(document.body.querySelector("img")).toBeNull();
    expect(shadow?.querySelector(".delivery")?.textContent).toContain("Sent");
    expect(document.body.children).toHaveLength(1);
  });
});
