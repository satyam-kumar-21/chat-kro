import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
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
} from "../models/index.js";
import { updateMemberRole, listMembers } from "./member-service.js";
import { createAgentMessage, deleteAgentMessage, listMessages } from "./message-service.js";
import { getConversation, updateConversation } from "./conversation-service.js";
import { getWebsite, updateWebsite } from "./website-service.js";
import { reserveUsage } from "./usage-service.js";
import { createRefreshSession, registerUser } from "./identity-service.js";
import { acceptInvitation, createInvitation } from "./invitation-service.js";
import { eraseVisitorPersonalData } from "./privacy-service.js";
import { findOrCreateWidgetVisitor, getVisitor } from "./visitor-service.js";

const dbModels = [
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
let userA: InstanceType<typeof User>;
let userB: InstanceType<typeof User>;
let workspaceA: InstanceType<typeof Workspace>;
let workspaceB: InstanceType<typeof Workspace>;
let websiteA: InstanceType<typeof Website>;
let websiteB: InstanceType<typeof Website>;
let conversationA: InstanceType<typeof Conversation>;
let conversationB: InstanceType<typeof Conversation>;
let messageB: InstanceType<typeof Message>;
let memberB: InstanceType<typeof WorkspaceMember>;
let visitorA: InstanceType<typeof Visitor>;

const actorA = () => ({ userId: userA._id.toString() });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(dbModels.map((model) => model.syncIndexes()));
}, 300_000);

afterAll(async () => {
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
  userA = await User.create({
    name: "Workspace A owner",
    email: "owner-a@example.test",
    passwordHash: "test-hash",
    accountStatus: "active"
  });
  userB = await User.create({
    name: "Workspace B owner",
    email: "owner-b@example.test",
    passwordHash: "test-hash",
    accountStatus: "active"
  });
  workspaceA = await Workspace.create({
    name: "Workspace A",
    slug: "workspace-a",
    ownerUserId: userA._id
  });
  workspaceB = await Workspace.create({
    name: "Workspace B",
    slug: "workspace-b",
    ownerUserId: userB._id
  });
  await WorkspaceMember.create([
    {
      workspaceId: workspaceA._id,
      userId: userA._id,
      role: "owner",
      status: "active",
      joinedAt: new Date()
    },
    {
      workspaceId: workspaceB._id,
      userId: userB._id,
      role: "owner",
      status: "active",
      joinedAt: new Date()
    }
  ]);
  memberB = await WorkspaceMember.create({
    workspaceId: workspaceB._id,
    userId: new mongoose.Types.ObjectId(),
    role: "agent",
    status: "active"
  });
  websiteA = await Website.create({
    workspaceId: workspaceA._id,
    name: "A website",
    domain: "a.example.test",
    allowedOrigins: ["https://a.example.test"]
  });
  websiteB = await Website.create({
    workspaceId: workspaceB._id,
    name: "B website",
    domain: "b.example.test",
    allowedOrigins: ["https://b.example.test"]
  });
  visitorA = await Visitor.create({
    workspaceId: workspaceA._id,
    websiteId: websiteA._id,
    visitorId: "visitor-session-a-0001"
  });
  const visitorB = await Visitor.create({
    workspaceId: workspaceB._id,
    websiteId: websiteB._id,
    visitorId: "visitor-session-b-0001"
  });
  conversationA = await Conversation.create({
    workspaceId: workspaceA._id,
    websiteId: websiteA._id,
    visitorId: visitorA._id,
    status: "open"
  });
  conversationB = await Conversation.create({
    workspaceId: workspaceB._id,
    websiteId: websiteB._id,
    visitorId: visitorB._id,
    status: "pending"
  });
  messageB = await Message.create({
    workspaceId: workspaceB._id,
    conversationId: conversationB._id,
    senderType: "agent",
    senderId: userB._id,
    body: "Private workspace B message"
  });
});

describe("workspace tenant isolation", () => {
  it("generates non-sequential widget IDs even when a caller supplies an ID", async () => {
    const website = await Website.create({
      workspaceId: workspaceA._id,
      name: "Generated ID website",
      domain: "generated.example.test",
      publicWidgetId: "widget-0001",
      allowedOrigins: ["https://generated.example.test"]
    });
    expect(website.publicWidgetId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(website.publicWidgetId).not.toBe("widget-0001");
    expect(website.publicWidgetId).not.toBe(websiteA.publicWidgetId);
  });

  it("validates widget origin and minimizes visitor URL data before storing it", async () => {
    const visitorId = "f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5";
    const visitor = await findOrCreateWidgetVisitor(
      websiteA.publicWidgetId,
      "https://a.example.test",
      {
        visitorId,
        displayName: "Visitor",
        currentPageUrl: "https://a.example.test/pricing?email=private@example.test#top",
        referrer: "https://search.example.test/?token=private"
      }
    );
    if (!visitor) throw new Error("Widget visitor was not persisted");
    expect(visitor.currentPageUrl).toBe("https://a.example.test/pricing");
    expect(visitor.referrer).toBe("https://search.example.test/");

    await expect(
      findOrCreateWidgetVisitor(websiteA.publicWidgetId, "https://evil.example.test", {
        visitorId
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      findOrCreateWidgetVisitor(websiteA.publicWidgetId, "https://a.example.test", {
        visitorId,
        browserFingerprint: "must-not-be-collected"
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("restricts visitor records to the workspace and supports audited personal-data erasure", async () => {
    await expect(getVisitor(actorA(), workspaceB._id.toString(), visitorA._id.toString()))
      .rejects.toMatchObject({ statusCode: 404 });
    const visitorMessage = await Message.create({
      workspaceId: workspaceA._id,
      conversationId: conversationA._id,
      senderType: "visitor",
      senderId: visitorA._id,
      body: "My email is private@example.test"
    });
    await eraseVisitorPersonalData(actorA(), workspaceA._id.toString(), visitorA._id.toString());
    const erased = await Visitor.findById(visitorA._id);
    expect(erased?.displayName).toBeNull();
    expect(erased?.email).toBeNull();
    expect(erased?.customAttributes.size).toBe(0);
    const erasedMessage = await Message.findById(visitorMessage._id);
    expect(erasedMessage?.body).toBe("Message removed for privacy");
    expect(erasedMessage?.senderId).toBeNull();
    expect(await AuditLog.exists({ workspaceId: workspaceA._id, action: "visitor.personal_data_erased" }))
      .toBeTruthy();
  });

  it("prevents reading and changing another workspace's websites", async () => {
    await expect(getWebsite(actorA(), workspaceB._id.toString(), websiteB._id.toString()))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(getWebsite(actorA(), workspaceA._id.toString(), websiteB._id.toString()))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateWebsite(actorA(), workspaceB._id.toString(), websiteB._id.toString(), {
        name: "Hijacked"
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateWebsite(actorA(), workspaceA._id.toString(), websiteB._id.toString(), {
        name: "Hijacked"
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await Website.findById(websiteB._id))?.name).toBe("B website");
    expect((await getWebsite(actorA(), workspaceA._id.toString(), websiteA._id.toString())).name)
      .toBe("A website");
  });

  it("prevents reading and changing another workspace's conversations", async () => {
    await expect(getConversation(actorA(), workspaceB._id.toString(), conversationB._id.toString()))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(getConversation(actorA(), workspaceA._id.toString(), conversationB._id.toString()))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateConversation(actorA(), workspaceB._id.toString(), conversationB._id.toString(), {
        status: "resolved"
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await Conversation.findById(conversationB._id))?.status).toBe("pending");
  });

  it("prevents reading and modifying another workspace's messages", async () => {
    await expect(
      listMessages(actorA(), workspaceB._id.toString(), conversationB._id.toString())
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      listMessages(actorA(), workspaceA._id.toString(), conversationB._id.toString())
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      deleteAgentMessage(
        actorA(),
        workspaceB._id.toString(),
        conversationB._id.toString(),
        messageB._id.toString()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
    deleteAgentMessage(
      actorA(),
      workspaceA._id.toString(),
      conversationA._id.toString(),
      messageB._id.toString()
    )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await Message.findById(messageB._id))?.deletedAt).toBeNull();
  });

  it("prevents reading and changing another workspace's members", async () => {
    await expect(listMembers(actorA(), workspaceB._id.toString()))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateMemberRole(actorA(), workspaceA._id.toString(), memberB._id.toString(), "admin")
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateMemberRole(actorA(), workspaceB._id.toString(), memberB._id.toString(), "admin")
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await WorkspaceMember.findById(memberB._id))?.role).toBe("agent");
  });
});

describe("concurrent and idempotent writes", () => {
  it("accepts a workspace invitation once using the stored role and reserves member usage", async () => {
    const invitee = await User.create({
      name: "Invited operator",
      email: "invited@example.test",
      passwordHash: "test-hash",
      accountStatus: "active"
    });
    const created = await createInvitation(actorA(), workspaceA._id.toString(), {
      email: invitee.email,
      role: "agent"
    });
    const accepted = await acceptInvitation({ userId: invitee._id.toString() }, created.token);

    expect(accepted).toMatchObject({ workspaceId: workspaceA._id.toString(), role: "agent" });
    expect(
      await WorkspaceMember.exists({ workspaceId: workspaceA._id, userId: invitee._id, role: "agent" })
    ).toBeTruthy();
    await expect(
      acceptInvitation({ userId: invitee._id.toString() }, created.token)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await SubscriptionUsage.findOne({ workspaceId: workspaceA._id }))?.members).toBe(2);
  });

  it("never serializes password or refresh-token hashes", async () => {
    const registered = await registerUser({
      name: "New operator",
      email: "new-operator@example.test",
      password: "secure-password-with-more-than-12",
      acceptedTerms: true
    });
    expect(registered).not.toHaveProperty("passwordHash");

    const user = await User.findOne({ email: "new-operator@example.test" }).select("+passwordHash");
    if (!user) throw new Error("Registration did not persist a user");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(user)).not.toContain("passwordHash");

    const session = await createRefreshSession({
      userId: user._id.toString(),
      expiresAt: new Date(Date.now() + 60_000)
    });
    const storedSession = await Session.findById(session.session.id);
    expect(JSON.stringify(storedSession)).not.toContain("refreshTokenHash");
  });

  it("never lets concurrent usage reservations exceed the free plan quota", async () => {
    await Workspace.updateOne({ _id: workspaceA._id }, { $set: { plan: "free" } });
    await SubscriptionUsage.create({
      workspaceId: workspaceA._id,
      websites: 0,
      members: 1,
      monthlyConversations: 99,
      monthlyMessages: 0,
      periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    });
    const reservations = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        reserveUsage(actorA(), workspaceA._id.toString(), "monthlyConversations")
      )
    );
    expect(reservations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await SubscriptionUsage.findOne({ workspaceId: workspaceA._id }))?.monthlyConversations)
      .toBe(100);
  });

  it("stores only one message and increments unread count once on duplicate client retries", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        createAgentMessage(actorA(), workspaceA._id.toString(), conversationA._id.toString(), {
          clientMessageId: "retry-0001",
          body: "<img src=x onerror=alert(1)>Hello from agent"
        })
      )
    );
    expect(new Set(attempts.map((message) => message._id.toString())).size).toBe(1);
    expect(attempts[0]?.body).toBe("Hello from agent");
    expect(await Message.countDocuments({ conversationId: conversationA._id })).toBe(1);
    expect((await Conversation.findById(conversationA._id))?.visitorUnreadCount).toBe(1);
  });
});
