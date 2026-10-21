import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
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
let firstWidgetId = "";
let secondWidgetId = "";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(models.map((model) => model.syncIndexes()));
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
  const user = await User.create({
    name: "Widget test owner",
    email: "widget-owner@example.test",
    passwordHash: "test-password-hash",
    accountStatus: "active"
  });
  const workspace = await Workspace.create({
    name: "Widget workspace",
    slug: "widget-workspace",
    ownerUserId: user._id
  });
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId: user._id,
    role: "owner",
    status: "active",
    joinedAt: new Date()
  });
  const [first, second] = await Website.create([
    {
      workspaceId: workspace._id,
      name: "First website",
      domain: "first.example.test",
      allowedOrigins: ["https://first.example.test"],
      widgetSettings: { title: "First Site Chat", greeting: "First welcome" }
    },
    {
      workspaceId: workspace._id,
      name: "Second website",
      domain: "second.example.test",
      allowedOrigins: ["https://second.example.test"],
      widgetSettings: { title: "Second Site Chat", greeting: "Second welcome" }
    }
  ]);
  firstWidgetId = first.publicWidgetId;
  secondWidgetId = second.publicWidgetId;
});

function originHeader(origin: string, widgetId: string) {
  return {
    Origin: origin,
    "X-Public-Widget-Id": widgetId
  };
}

async function createSession(widgetId: string, origin: string, visitorId: string) {
  const response = await request(app)
    .post("/widget/init")
    .set(originHeader(origin, widgetId))
    .send({ widgetId, visitorId, currentPageUrl: `${origin}/help` });
  expect(response.status).toBe(200);
  expect(response.body.config).toHaveProperty("accentColor");
  expect(response.body).not.toHaveProperty("workspaceId");
  const token = response.body.visitorToken as string;
  const conversation = await request(app)
    .post("/widget/conversation")
    .set(originHeader(origin, widgetId))
    .set("Authorization", `Bearer ${token}`)
    .send({});
  expect(conversation.status).toBe(200);
  return { token, conversationId: conversation.body.conversationId as string };
}

describe("public widget isolation", () => {
  it("serves separate site configurations and isolates visitor conversations and messages", async () => {
    const firstOrigin = "https://first.example.test";
    const secondOrigin = "https://second.example.test";
    const visitorOne = await createSession(firstWidgetId, firstOrigin, "a".repeat(64));
    const visitorTwo = await createSession(secondWidgetId, secondOrigin, "b".repeat(64));

    const firstConfig = await request(app)
      .post("/widget/init")
      .set(originHeader(firstOrigin, firstWidgetId))
      .send({ widgetId: firstWidgetId, visitorId: "a".repeat(64) });
    const secondConfig = await request(app)
      .post("/widget/init")
      .set(originHeader(secondOrigin, secondWidgetId))
      .send({ widgetId: secondWidgetId, visitorId: "b".repeat(64) });
    expect(firstConfig.body.config.title).toBe("First Site Chat");
    expect(secondConfig.body.config.title).toBe("Second Site Chat");
    expect(firstConfig.headers["access-control-allow-origin"]).toBe(firstOrigin);

    const sentOne = await request(app)
      .post(`/widget/${visitorOne.conversationId}/messages`)
      .set(originHeader(firstOrigin, firstWidgetId))
      .set("Authorization", `Bearer ${visitorOne.token}`)
      .send({ clientMessageId: "first-site-message-1", body: "First website private message" });
    expect(sentOne.status).toBe(201);
    const sentTwo = await request(app)
      .post(`/widget/${visitorTwo.conversationId}/messages`)
      .set(originHeader(secondOrigin, secondWidgetId))
      .set("Authorization", `Bearer ${visitorTwo.token}`)
      .send({ clientMessageId: "second-site-message-1", body: "Second website private message" });
    expect(sentTwo.status).toBe(201);

    const firstMessages = await request(app)
      .get(`/widget/${visitorOne.conversationId}/messages`)
      .set(originHeader(firstOrigin, firstWidgetId))
      .set("Authorization", `Bearer ${visitorOne.token}`);
    expect(firstMessages.body.messages.map((message: { body: string }) => message.body))
      .toEqual(["First website private message"]);

    const crossSiteRead = await request(app)
      .get(`/widget/${visitorTwo.conversationId}/messages`)
      .set(originHeader(firstOrigin, firstWidgetId))
      .set("Authorization", `Bearer ${visitorOne.token}`);
    expect(crossSiteRead.status).toBe(404);
    const crossSiteSend = await request(app)
      .post(`/widget/${visitorTwo.conversationId}/messages`)
      .set(originHeader(firstOrigin, firstWidgetId))
      .set("Authorization", `Bearer ${visitorOne.token}`)
      .send({ clientMessageId: "forged-message-1", body: "Must not cross sites" });
    expect(crossSiteSend.status).toBe(404);

    const wrongOrigin = await request(app)
      .post("/widget/init")
      .set(originHeader("https://attacker.example", firstWidgetId))
      .send({ widgetId: firstWidgetId, visitorId: "c".repeat(64) });
    expect(wrongOrigin.status).toBe(403);
    const unauthorizedJoin = await request(app)
      .post(`/widget/${visitorTwo.conversationId}/messages`)
      .set(originHeader(secondOrigin, secondWidgetId))
      .set("Authorization", `Bearer ${visitorOne.token}`)
      .send({ clientMessageId: "cross-token-message-1", body: "No authorization" });
    expect(unauthorizedJoin.status).toBe(403);
  });

  it("rejects tampered visitor tokens and requires server-issued visitor authorization", async () => {
    const session = await createSession(
      firstWidgetId,
      "https://first.example.test",
      "d".repeat(64)
    );
    const tampered = `${session.token.slice(0, -1)}${session.token.endsWith("a") ? "b" : "a"}`;
    const response = await request(app)
      .get(`/widget/${session.conversationId}/messages`)
      .set(originHeader("https://first.example.test", firstWidgetId))
      .set("Authorization", `Bearer ${tampered}`);
    expect(response.status).toBe(401);
    const missingToken = await request(app)
      .get(`/widget/${session.conversationId}/messages`)
      .set(originHeader("https://first.example.test", firstWidgetId));
    expect(missingToken.status).toBe(401);
  });
});
