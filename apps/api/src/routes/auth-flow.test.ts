import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import {
  AuditLog,
  Conversation,
  EmailVerificationToken,
  InternalNote,
  Message,
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
  Conversation,
  EmailVerificationToken,
  InternalNote,
  Message,
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

function cookieValue(cookies: string[], name: string): string {
  const value = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!value) throw new Error(`Expected ${name} cookie`);
  return value.split(";")[0]!;
}

function cookieToken(cookie: string): string {
  return decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
}

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
    Conversation.deleteMany({}),
    EmailVerificationToken.deleteMany({}),
    InternalNote.deleteMany({}),
    Message.deleteMany({}),
    PasswordResetToken.deleteMany({}),
    Session.deleteMany({}),
    SubscriptionUsage.deleteMany({}),
    User.deleteMany({}),
    Visitor.deleteMany({}),
    Website.deleteMany({}),
    Workspace.deleteMany({}),
    WorkspaceMember.deleteMany({})
  ]);
});

function responseCookies(response: request.Response): string[] {
  const cookies = response.headers["set-cookie"];
  return Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
}

async function registerAndVerify(email: string, password: string) {
  const registration = await request(app).post("/auth/register").send({
    name: "Test operator",
    email,
    password,
    acceptedTerms: true
  });
  expect(registration.status).toBe(202);
  const verificationUrl = registration.body.developmentVerificationUrl as string;
  expect(verificationUrl).toBeTruthy();
  const token = new URL(verificationUrl).searchParams.get("token");
  if (!token) throw new Error("Registration response did not include development verification token");
  const verified = await request(app).post("/auth/verify-email").send({ token });
  expect(verified.status).toBe(200);
  return token;
}

describe("authentication and onboarding", () => {
  it("registers, verifies, creates a workspace and website, and revokes a session on refresh-token reuse", async () => {
    const password = "secure-password-with-more-than-12";
    const verificationToken = await registerAndVerify("owner@example.test", password);
    expect((await request(app).post("/auth/verify-email").send({ token: verificationToken })).status).toBe(400);

    const login = await request(app).post("/auth/login").send({
      email: "owner@example.test",
      password
    });
    expect(login.status).toBe(200);
    const loginCookies = responseCookies(login);
    const originalSession = cookieValue(loginCookies, "relay_session");
    const originalCsrf = cookieValue(loginCookies, "relay_csrf");
    expect(loginCookies.some((cookie) => cookie.startsWith("relay_session=") && /httponly/i.test(cookie))).toBe(true);

    const me = await request(app).get("/auth/me").set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("owner@example.test");
    expect(me.body.user).not.toHaveProperty("passwordHash");

    const workspaceResponse = await request(app)
      .post("/workspaces")
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "))
      .set("X-CSRF-Token", cookieToken(originalCsrf))
      .send({ name: "Customer support" });
    expect(workspaceResponse.status).toBe(201);
    const workspaceId = workspaceResponse.body.workspace.id as string;

    const onboarding = await request(app)
      .get(`/workspaces/${workspaceId}/onboarding`)
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(onboarding.body).toMatchObject({ completed: false, websites: [] });

    const websiteResponse = await request(app)
      .post(`/workspaces/${workspaceId}/websites`)
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "))
      .set("X-CSRF-Token", cookieToken(originalCsrf))
      .send({
        name: "Main site",
        domain: "example.test",
        allowedOrigins: ["https://example.test"]
      });
    expect(websiteResponse.status).toBe(201);
    expect(websiteResponse.body.website.publicWidgetId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const visitor = await Visitor.create({
      workspaceId,
      websiteId: websiteResponse.body.website.id,
      visitorId: "v".repeat(64),
      displayName: "Inbox visitor",
      email: "visitor@example.test",
      currentPageUrl: "https://example.test/help"
    });
    const conversation = await Conversation.create({
      workspaceId,
      websiteId: websiteResponse.body.website.id,
      visitorId: visitor._id,
      lastMessagePreview: "Help needed"
    });
    const listResponse = await request(app)
      .get(`/workspaces/${workspaceId}/conversations?search=Inbox%20visitor&assignment=unassigned`)
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.conversations[0]).toMatchObject({
      id: conversation._id.toString(),
      visitor: { displayName: "Inbox visitor", email: "visitor@example.test" },
      website: { name: "Main site" },
      assignedAgentId: null
    });
    const noteResponse = await request(app)
      .post(`/workspaces/${workspaceId}/conversations/${conversation._id}/notes`)
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "))
      .set("X-CSRF-Token", cookieToken(originalCsrf))
      .send({ body: "Internal follow-up" });
    expect(noteResponse.status).toBe(201);
    expect(noteResponse.body.note).toMatchObject({ body: "Internal follow-up", author: "You" });
    const notesResponse = await request(app)
      .get(`/workspaces/${workspaceId}/conversations/${conversation._id}/notes`)
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(notesResponse.body.notes).toHaveLength(1);
    const completedOnboarding = await request(app)
      .get(`/workspaces/${workspaceId}/onboarding`)
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(completedOnboarding.body.completed).toBe(true);

    const secondWorkspace = await request(app)
      .post("/workspaces")
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "))
      .set("X-CSRF-Token", cookieToken(originalCsrf))
      .send({ name: "Sales support" });
    expect(secondWorkspace.status).toBe(201);
    const crossTenantNotes = await request(app)
      .get(`/workspaces/${secondWorkspace.body.workspace.id}/conversations/${conversation._id}/notes`)
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(crossTenantNotes.status).toBe(404);
    const updatedMe = await request(app)
      .get("/auth/me")
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(updatedMe.body.workspaces).toHaveLength(2);

    const rotated = await request(app)
      .post("/auth/refresh")
      .set("Cookie", loginCookies.map((item) => item.split(";")[0]!).join("; "))
      .set("X-CSRF-Token", cookieToken(originalCsrf));
    expect(rotated.status).toBe(200);
    const rotatedCookies = responseCookies(rotated);
    const newSession = cookieValue(rotatedCookies, "relay_session");
    const newCsrf = cookieValue(rotatedCookies, "relay_csrf");
    expect(newSession).not.toBe(originalSession);

    const reused = await request(app)
      .post("/auth/refresh")
      .set("Cookie", `${originalSession}; ${newCsrf}`)
      .set("X-CSRF-Token", cookieToken(newCsrf));
    expect(reused.status).toBe(401);
    const afterReuse = await request(app)
      .get("/auth/me")
      .set("Cookie", rotatedCookies.map((item) => item.split(";")[0]!).join("; "));
    expect(afterReuse.status).toBe(401);
  });

  it("rejects state-changing requests without CSRF and revokes the session on logout", async () => {
    const password = "secure-password-with-more-than-12";
    await registerAndVerify("logout@example.test", password);
    const login = await request(app).post("/auth/login").send({
      email: "logout@example.test",
      password
    });
    const cookies = responseCookies(login);
    const cookieHeader = cookies.map((item) => item.split(";")[0]!).join("; ");
    const csrf = cookieValue(cookies, "relay_csrf");

    const rejected = await request(app)
      .post("/auth/logout")
      .set("Cookie", cookieHeader);
    expect(rejected.status).toBe(403);

    const logout = await request(app)
      .post("/auth/logout")
      .set("Cookie", cookieHeader)
      .set("X-CSRF-Token", cookieToken(csrf));
    expect(logout.status).toBe(204);
    expect((await request(app).get("/auth/me").set("Cookie", cookieHeader)).status).toBe(401);
    expect(await Session.countDocuments({ revokedAt: { $ne: null } })).toBe(1);
  });

  it("does not disclose whether an account exists during password reset", async () => {
    const response = await request(app).post("/auth/password-reset").send({
      email: "absent@example.test"
    });
    expect(response.status).toBe(202);
    expect(response.body.message).toContain("If the account exists");
    expect(response.body).not.toHaveProperty("developmentResetUrl");
  });

  it("persists notification preferences through the authenticated preferences API", async () => {
    const password = "secure-password-with-more-than-12";
    await registerAndVerify("preferences@example.test", password);
    const login = await request(app).post("/auth/login").send({
      email: "preferences@example.test",
      password
    });
    const cookies = responseCookies(login);
    const cookieHeader = cookies.map((item) => item.split(";")[0]!).join("; ");
    const csrf = cookieValue(cookies, "relay_csrf");

    const initial = await request(app).get("/auth/preferences").set("Cookie", cookieHeader);
    expect(initial.body.preferences).toEqual({ sound: false, desktop: false });
    const saved = await request(app)
      .patch("/auth/preferences")
      .set("Cookie", cookieHeader)
      .set("X-CSRF-Token", cookieToken(csrf))
      .send({ sound: true, desktop: true });
    expect(saved.status).toBe(200);
    expect(saved.body.preferences).toEqual({ sound: true, desktop: true });
    const refreshed = await request(app).get("/auth/preferences").set("Cookie", cookieHeader);
    expect(refreshed.body.preferences).toEqual({ sound: true, desktop: true });
    const invalid = await request(app)
      .patch("/auth/preferences")
      .set("Cookie", cookieHeader)
      .set("X-CSRF-Token", cookieToken(csrf))
      .send({ sound: true, desktop: true, role: "admin" });
    expect(invalid.status).toBe(400);
  });

  it("resets passwords with a single-use token and revokes existing sessions", async () => {
    const oldPassword = "secure-password-with-more-than-12";
    const newPassword = "another-secure-password-over-12";
    await registerAndVerify("reset@example.test", oldPassword);
    const login = await request(app).post("/auth/login").send({
      email: "reset@example.test",
      password: oldPassword
    });
    const sessionCookies = responseCookies(login).map((item) => item.split(";")[0]!).join("; ");

    const resetRequest = await request(app).post("/auth/password-reset").send({
      email: "reset@example.test"
    });
    expect(resetRequest.status).toBe(202);
    const resetUrl = resetRequest.body.developmentResetUrl as string;
    const token = new URL(resetUrl).searchParams.get("token");
    if (!token) throw new Error("Password reset response did not include development token");

    const completed = await request(app).post("/auth/reset-password").send({
      token,
      password: newPassword
    });
    expect(completed.status).toBe(200);
    expect((await request(app).post("/auth/reset-password").send({ token, password: newPassword })).status).toBe(400);
    expect((await request(app).get("/auth/me").set("Cookie", sessionCookies)).status).toBe(401);
    expect((await request(app).post("/auth/login").send({ email: "reset@example.test", password: oldPassword })).status).toBe(401);
    expect((await request(app).post("/auth/login").send({ email: "reset@example.test", password: newPassword })).status).toBe(200);
  });
});
