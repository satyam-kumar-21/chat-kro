import { createServer, type Server as HttpServer } from "node:http";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import {
  Conversation,
  EmailVerificationToken,
  IdempotencyRecord,
  Invitation,
  Message,
  Notification,
  PasswordResetToken,
  Session,
  SubscriptionUsage,
  User,
  Visitor,
  Website,
  Workspace,
  WorkspaceMember,
  CannedReply,
  AuditLog
} from "../models/index.js";
import { createRefreshSession } from "../services/identity-service.js";
import { hashOpaqueToken } from "../services/token-service.js";
import { createVisitorSessionToken } from "../services/widget-service.js";
import { closeRealtimeInfrastructure, createRealtimeServer } from "./realtime.js";

const models = [
  AuditLog,
  CannedReply,
  Conversation,
  EmailVerificationToken,
  IdempotencyRecord,
  Invitation,
  Message,
  Notification,
  PasswordResetToken,
  Session,
  SubscriptionUsage,
  User,
  Visitor,
  Website,
  Workspace,
  WorkspaceMember
];

let mongo: MongoMemoryServer | undefined;
let httpServer: HttpServer;
let realtime: Awaited<ReturnType<typeof createRealtimeServer>>;
let endpoint = "";
let ownerId = "";
let ownerSession = "";
let workspaceId = "";
let otherWorkspaceId = "";
let websiteId = "";
let visitorId = "";
let conversationId = "";
let visitorToken = "";
const visitorOrigin = "https://socket-site.example.test";

async function connectAgent(sessionToken = ownerSession): Promise<ClientSocket> {
  const client = createClient(endpoint, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: {
      Origin: env.WEB_ORIGIN,
      Cookie: `relay_session=${encodeURIComponent(sessionToken)}`
    }
  });
  await waitForConnect(client);
  return client;
}

async function connectVisitor(token = visitorToken, origin = visitorOrigin): Promise<ClientSocket> {
  const client = createClient(endpoint, {
    auth: { visitorToken: token },
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Origin: origin }
  });
  await waitForConnect(client);
  return client;
}

function waitForConnect(client: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out")), 5_000);
    client.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function emitAck<T>(client: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    client.timeout(5_000).emit(event, payload, (timeoutError: Error | null, result: T) => {
      if (timeoutError) reject(timeoutError);
      else resolve(result);
    });
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(models.map((model) => model.syncIndexes()));
  httpServer = createServer();
  realtime = await createRealtimeServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Socket test server did not start");
  endpoint = `http://127.0.0.1:${address.port}`;
}, 300_000);

afterAll(async () => {
  await new Promise<void>((resolve) => realtime.close(() => resolve()));
  await closeRealtimeInfrastructure();
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all([
    AuditLog.deleteMany({}),
    CannedReply.deleteMany({}),
    Conversation.deleteMany({}),
    EmailVerificationToken.deleteMany({}),
    IdempotencyRecord.deleteMany({}),
    Invitation.deleteMany({}),
    Message.deleteMany({}),
    Notification.deleteMany({}),
    PasswordResetToken.deleteMany({}),
    Session.deleteMany({}),
    SubscriptionUsage.deleteMany({}),
    User.deleteMany({}),
    Visitor.deleteMany({}),
    Website.deleteMany({}),
    Workspace.deleteMany({}),
    WorkspaceMember.deleteMany({})
  ]);
  const owner = await User.create({
    name: "Socket owner",
    email: "socket-owner@example.test",
    passwordHash: "test-password-hash",
    accountStatus: "active"
  });
  ownerId = owner._id.toString();
  const otherOwner = await User.create({
    name: "Other owner",
    email: "socket-other@example.test",
    passwordHash: "test-password-hash",
    accountStatus: "active"
  });
  const [workspace, otherWorkspace] = await Workspace.create([
    { name: "Socket workspace", slug: "socket-workspace", ownerUserId: owner._id },
    { name: "Other workspace", slug: "other-socket-workspace", ownerUserId: otherOwner._id }
  ]);
  workspaceId = workspace._id.toString();
  otherWorkspaceId = otherWorkspace._id.toString();
  await WorkspaceMember.create([
    { workspaceId: workspace._id, userId: owner._id, role: "owner", status: "active" },
    { workspaceId: otherWorkspace._id, userId: otherOwner._id, role: "owner", status: "active" }
  ]);
  const [website] = await Website.create([
    {
      workspaceId: workspace._id,
      name: "Socket website",
      domain: "socket-site.example.test",
      allowedOrigins: [visitorOrigin]
    },
    {
      workspaceId: otherWorkspace._id,
      name: "Other website",
      domain: "other-socket-site.example.test",
      allowedOrigins: ["https://other-socket-site.example.test"]
    }
  ]);
  websiteId = website._id.toString();
  const visitor = await Visitor.create({
    workspaceId: workspace._id,
    websiteId: website._id,
    visitorId: "v".repeat(64)
  });
  visitorId = visitor._id.toString();
  const conversation = await Conversation.create({
    workspaceId: workspace._id,
    websiteId: website._id,
    visitorId: visitor._id
  });
  conversationId = conversation._id.toString();
  const session = await createRefreshSession({
    userId: ownerId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });
  ownerSession = session.refreshToken;
  visitorToken = createVisitorSessionToken({
    visitor: visitorId,
    website: websiteId,
    workspace: workspaceId
  });
});

describe("Socket.IO messaging engine", () => {
  it("persists and delivers messages in both directions with idempotent retries and read receipts", async () => {
    const agent = await connectAgent();
    const visitor = await connectVisitor();
    const joinedAgent = await emitAck<{ ok: boolean }>(agent, "conversation:join", {
      workspaceId,
      conversationId
    });
    const joinedVisitor = await emitAck<{ ok: boolean }>(visitor, "conversation:join", { conversationId });
    expect(joinedAgent).toMatchObject({ ok: true });
    expect(joinedVisitor).toMatchObject({ ok: true });

    const agentMessageEvent = new Promise<unknown>((resolve) => agent.once("conversation:message", resolve));
    const visitorInput = { clientMessageId: "visitor-once-1", body: "Hello team" };
    const [firstAck, duplicateAck] = await Promise.all([
      emitAck<{ ok: boolean; data?: { message: { id: string } } }>(
        visitor,
        "conversation:message",
        visitorInput
      ),
      emitAck<{ ok: boolean; data?: { message: { id: string } } }>(
        visitor,
        "conversation:message",
        visitorInput
      )
    ]);
    expect(firstAck).toMatchObject({ ok: true });
    expect(duplicateAck.data?.message.id).toBe(firstAck.data?.message.id);
    const reusedKeyAck = await emitAck<{ ok: boolean; error?: { code: string } }>(
      visitor,
      "conversation:message",
      { clientMessageId: visitorInput.clientMessageId, body: "A different message" }
    );
    expect(reusedKeyAck).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_KEY_REUSED" }
    });
    await expect(agentMessageEvent).resolves.toMatchObject({ body: "Hello team" });
    expect(await Message.countDocuments({ conversationId })).toBe(1);
    expect((await Conversation.findById(conversationId))?.agentUnreadCount).toBe(1);

    const visitorMessageEvent = new Promise<unknown>((resolve) => visitor.once("conversation:message", resolve));
    const agentAck = await emitAck<{ ok: boolean }>(agent, "message:send", {
      workspaceId,
      conversationId,
      clientMessageId: "agent-once-1",
      body: "How can I help?"
    });
    expect(agentAck).toMatchObject({ ok: true });
    await expect(visitorMessageEvent).resolves.toMatchObject({ body: "How can I help?" });
    expect((await Conversation.findById(conversationId))?.visitorUnreadCount).toBe(1);

    const visitorRead = await emitAck<{ ok: boolean }>(visitor, "conversation:read", {});
    expect(visitorRead).toMatchObject({ ok: true });
    expect((await Conversation.findById(conversationId))?.visitorUnreadCount).toBe(0);
    agent.disconnect();
    visitor.disconnect();
  });

  it("rejects cross-workspace conversation joins and invalid visitor origins", async () => {
    const agent = await connectAgent();
    const otherConversation = await Conversation.create({
      workspaceId: otherWorkspaceId,
      websiteId: new Types.ObjectId(),
      visitorId: new Types.ObjectId()
    });
    const crossWorkspace = await emitAck<{ ok: boolean; error?: { code: string } }>(
      agent,
      "conversation:join",
      { workspaceId: otherWorkspaceId, conversationId: otherConversation._id.toString() }
    );
    expect(crossWorkspace).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    agent.disconnect();

    const visitorClient = await connectVisitor();
    const visitorCrossWorkspace = await emitAck<{ ok: boolean; error?: { code: string } }>(
      visitorClient,
      "conversation:join",
      { conversationId: otherConversation._id.toString() }
    );
    expect(visitorCrossWorkspace).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" }
    });
    visitorClient.disconnect();

    const visitor = createClient(endpoint, {
      auth: { visitorToken },
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: "https://attacker.example.test" }
    });
    const connectionError = await new Promise<Error>((resolve) => {
      visitor.once("connect_error", resolve);
    });
    expect(connectionError).toBeInstanceOf(Error);
    visitor.disconnect();
  });

  it("recovers persisted messages after a disconnected recipient reconnects", async () => {
    const visitor = await connectVisitor();
    await emitAck(visitor, "conversation:join", { conversationId });
    const ack = await emitAck<{ ok: boolean }>(visitor, "conversation:message", {
      clientMessageId: "offline-delivery-1",
      body: "Saved while the agent was disconnected"
    });
    expect(ack).toMatchObject({ ok: true });
    visitor.disconnect();

    const agent = await connectAgent();
    const joined = await emitAck<{
      ok: boolean;
      data?: { messages: Array<{ body: string }> };
    }>(agent, "conversation:join", { workspaceId, conversationId });
    expect(joined.data?.messages).toEqual([
      expect.objectContaining({ body: "Saved while the agent was disconnected" })
    ]);
    agent.disconnect();
  });

  it("supports ephemeral typing, authorized assignment, resolution, and reopening", async () => {
    const supportAgent = await User.create({
      name: "Support agent",
      email: "support-agent@example.test",
      passwordHash: "test-password-hash",
      accountStatus: "active"
    });
    await WorkspaceMember.create({
      workspaceId,
      userId: supportAgent._id,
      role: "agent",
      status: "active"
    });
    const agentSession = await createRefreshSession({
      userId: supportAgent._id.toString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    const owner = await connectAgent();
    const agent = await connectAgent(agentSession.refreshToken);
    const visitor = await connectVisitor();
    await emitAck(owner, "conversation:join", { workspaceId, conversationId });
    await emitAck(agent, "conversation:join", { workspaceId, conversationId });
    await emitAck(visitor, "conversation:join", { conversationId });

    const typing = new Promise<{ senderType: string; isTyping: boolean }>((resolve) => {
      agent.once("conversation:typing", resolve);
    });
    const typingAck = await emitAck<{ ok: boolean }>(visitor, "conversation:typing", { isTyping: true });
    expect(typingAck).toMatchObject({ ok: true });
    await expect(typing).resolves.toEqual({ senderType: "visitor", isTyping: true });

    const resolvedEvent = new Promise<{ status: string }>((resolve) => {
      visitor.once("conversation:resolved", resolve);
    });
    const resolveAck = await emitAck<{ ok: boolean }>(owner, "conversation:update", {
      workspaceId,
      conversationId,
      status: "resolved"
    });
    expect(resolveAck).toMatchObject({ ok: true });
    await expect(resolvedEvent).resolves.toEqual({ status: "resolved" });
    const blockedMessage = await emitAck<{ ok: boolean; error?: { code: string } }>(
      visitor,
      "conversation:message",
      { clientMessageId: "resolved-chat-message", body: "Must not reopen it" }
    );
    expect(blockedMessage).toMatchObject({
      ok: false,
      error: { code: "CONVERSATION_RESOLVED" }
    });

    const reopenAck = await emitAck<{ ok: boolean }>(owner, "conversation:update", {
      workspaceId,
      conversationId,
      status: "open"
    });
    expect(reopenAck).toMatchObject({ ok: true });
    const assignmentAck = await emitAck<{ ok: boolean }>(owner, "conversation:assign", {
      workspaceId,
      conversationId,
      assignedAgentId: supportAgent._id.toString()
    });
    expect(assignmentAck).toMatchObject({ ok: true });
    expect((await Conversation.findById(conversationId))?.assignedAgentId?.toString())
      .toBe(supportAgent._id.toString());

    const secondVisitor = await Visitor.create({
      workspaceId,
      websiteId,
      visitorId: "x".repeat(64)
    });
    const secondVisitorToken = createVisitorSessionToken({
      visitor: secondVisitor._id.toString(),
      website: websiteId,
      workspace: workspaceId
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const newVisitorSocket = await connectVisitor(secondVisitorToken);
    const opened = await emitAck<{
      ok: boolean;
      data?: { created: boolean; conversation: { assignedAgentId: string | null } };
    }>(newVisitorSocket, "conversation:open", {});
    expect(opened).toMatchObject({
      ok: true,
      data: {
        created: true,
        conversation: { assignedAgentId: supportAgent._id.toString() }
      }
    });

    owner.disconnect();
    agent.disconnect();
    visitor.disconnect();
    newVisitorSocket.disconnect();
  });

  it("keeps presence online while another authenticated browser session remains connected", async () => {
    const firstTab = await connectAgent();
    const secondTab = await connectAgent();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const visitor = createClient(endpoint, {
      auth: { visitorToken },
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: visitorOrigin }
    });
    const initialPresence = new Promise<{ online: boolean }>((resolve) => {
      visitor.once("agent:presence", resolve);
    });
    await waitForConnect(visitor);
    await expect(initialPresence).resolves.toEqual({ online: true });

    const nextPresence = new Promise<{ online: boolean }>((resolve) => {
      visitor.once("agent:presence", resolve);
    });
    firstTab.disconnect();
    await expect(nextPresence).resolves.toEqual({ online: true });

    secondTab.disconnect();
    visitor.disconnect();
  });

  it("revalidates revoked sessions and validates every payload", async () => {
    const agent = await connectAgent();
    const invalidPayload = await emitAck<{ ok: boolean; error?: { code: string } }>(
      agent,
      "inbox:join",
      { workspaceId: "not-an-object-id" }
    );
    expect(invalidPayload).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    await Session.updateOne(
      { refreshTokenHash: hashOpaqueToken(ownerSession) },
      { $set: { revokedAt: new Date() } }
    );
    const revokedAction = await emitAck<{ ok: boolean; error?: { code: string } }>(
      agent,
      "inbox:join",
      { workspaceId }
    );
    expect(revokedAction).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    for (let index = 0; index < 118; index += 1) {
      await emitAck(agent, "inbox:join", { workspaceId: "not-an-object-id" });
    }
    const rateLimited = await emitAck<{ ok: boolean; error?: { code: string } }>(
      agent,
      "inbox:join",
      { workspaceId: "not-an-object-id" }
    );
    expect(rateLimited).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
    agent.disconnect();
  });
});
