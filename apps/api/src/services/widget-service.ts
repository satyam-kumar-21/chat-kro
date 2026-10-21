import { createHmac, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { releaseWorkspaceUsage, reserveWorkspaceUsage } from "./usage-service.js";
import { Conversation, Message, Visitor, Website } from "../models/index.js";
import { persistConversationMessage } from "./message-service.js";
import { findOrCreateWidgetVisitor } from "./visitor-service.js";

const initSchema = z.object({
  widgetId: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  visitorId: z.string().trim().min(32).max(128),
  currentPageUrl: z.string().url().max(2048).optional(),
  referrer: z.string().url().max(2048).optional(),
  consent: z.object({
    analytics: z.boolean().optional(),
    chat: z.boolean().optional(),
    policyVersion: z.string().trim().max(40).optional()
  }).strict().optional()
}).strict();

type VisitorClaims = {
  visitor: string;
  website: string;
  workspace: string;
  expiresAt: number;
};

export type VerifiedWidgetVisitor = VisitorClaims & {
  websiteSettings: {
    collectName: boolean;
    collectEmail: boolean;
    offlineContactForm: boolean;
  };
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", env.WIDGET_SESSION_SECRET).update(payload).digest("base64url");
}

export function createVisitorSessionToken(claims: Omit<VisitorClaims, "expiresAt">): string {
  const payload = encode({ ...claims, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  return `${payload}.${sign(payload)}`;
}

function parseVisitorSessionToken(token: string): VisitorClaims {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) {
    throw new AppError("Visitor session is invalid", 401, "WIDGET_SESSION_INVALID");
  }
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AppError("Visitor session is invalid", 401, "WIDGET_SESSION_INVALID");
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new AppError("Visitor session is invalid", 401, "WIDGET_SESSION_INVALID");
  }
  const parsed = z.object({
    visitor: z.string().regex(/^[\da-f]{24}$/i),
    website: z.string().regex(/^[\da-f]{24}$/i),
    workspace: z.string().regex(/^[\da-f]{24}$/i),
    expiresAt: z.number().int()
  }).strict().safeParse(claims);
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
    throw new AppError("Visitor session is invalid or expired", 401, "WIDGET_SESSION_INVALID");
  }
  return parsed.data;
}

function assertOriginMatchesWebsite(origin: string | undefined, website: { allowedOrigins: string[] }) {
  if (!origin) throw new AppError("Widget origin is required", 403, "ORIGIN_NOT_ALLOWED");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AppError("Widget origin is not allowed", 403, "ORIGIN_NOT_ALLOWED");
  }
  const localDev =
    env.NODE_ENV !== "production" &&
    env.WIDGET_DEV_MODE === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.origin !== origin || (!website.allowedOrigins.includes(origin) && !localDev)) {
    throw new AppError("Widget origin is not allowed", 403, "ORIGIN_NOT_ALLOWED");
  }
}

function isWithinAvailability(
  schedule: Array<{ day: number; start: string; end: string }>,
  timezone: string
): boolean {
  if (!schedule.length) return true;
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  } catch {
    throw new AppError("Invalid availability time zone", 400, "VALIDATION_ERROR");
  }
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = weekdays.indexOf(parts.weekday ?? "");
  const minuteNow = Number(parts.hour) * 60 + Number(parts.minute);
  return schedule.some((period) => {
    if (period.day !== day) return false;
    const start = Number(period.start.slice(0, 2)) * 60 + Number(period.start.slice(3));
    const end = Number(period.end.slice(0, 2)) * 60 + Number(period.end.slice(3));
    return end > start && minuteNow >= start && minuteNow < end;
  });
}

export async function initializeWidget(input: unknown, origin: string | undefined) {
  const parsed = initSchema.safeParse(input);
  if (!parsed.success) throw new AppError("Invalid widget initialization request", 400, "VALIDATION_ERROR");
  const visitor = await findOrCreateWidgetVisitor(parsed.data.widgetId, origin, {
    visitorId: parsed.data.visitorId,
    currentPageUrl: parsed.data.currentPageUrl,
    referrer: parsed.data.referrer,
    consent: parsed.data.consent
  });
  if (!visitor) throw new AppError("Unable to initialize visitor session", 503, "WIDGET_UNAVAILABLE");
  const website = await Website.findOne({
    _id: visitor.websiteId,
    workspaceId: visitor.workspaceId,
    publicWidgetId: parsed.data.widgetId,
    status: "active"
  }).select("name widgetSettings allowedOrigins");
  if (!website) throw new AppError("Widget not found", 404, "NOT_FOUND");
  assertOriginMatchesWebsite(origin, website);
  const settings = website.widgetSettings;
  return {
    visitorToken: createVisitorSessionToken({
      visitor: visitor._id.toString(),
      website: website._id.toString(),
      workspace: visitor.workspaceId.toString()
    }),
    website: { name: website.name },
    config: {
      accentColor: settings.accentColor,
      welcomeMessage: settings.welcomeMessage,
      position: settings.position,
      title: settings.title,
      subtitle: settings.subtitle,
      launcherLabel: settings.launcherLabel,
      launcherIcon: settings.launcherIcon,
      logoUrl: settings.logoUrl,
      theme: settings.theme,
      onlineText: settings.onlineText,
      offlineText: settings.offlineText,
      greeting: settings.greeting,
      collectName: settings.collectName,
      collectEmail: settings.collectEmail,
      offlineContactForm: settings.offlineContactForm,
      availabilityTimezone: settings.availabilityTimezone,
      availabilitySchedule: settings.availabilitySchedule,
      availableBySchedule: isWithinAvailability(
        settings.availabilitySchedule,
        settings.availabilityTimezone
      )
    }
  };
}

export async function updateWidgetVisitorProfile(
  visitor: VerifiedWidgetVisitor,
  input: unknown
) {
  const profileSchema = z.object({
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().email().max(254).optional()
  }).strict();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw new AppError("Invalid visitor details", 400, "VALIDATION_ERROR");
  const settings = visitor.websiteSettings;
  if (
    (parsed.data.name !== undefined && !settings.collectName && !settings.offlineContactForm) ||
    (parsed.data.email !== undefined && !settings.collectEmail && !settings.offlineContactForm)
  ) {
    throw new AppError("Contact details are not enabled for this website", 403, "PROFILE_COLLECTION_DISABLED");
  }
  const update: Record<string, string> = {};
  if (parsed.data.name !== undefined) update.displayName = parsed.data.name;
  if (parsed.data.email !== undefined) update.email = parsed.data.email.toLowerCase();
  await Visitor.updateOne(
    { _id: visitor.visitor, websiteId: visitor.website, workspaceId: visitor.workspace },
    { $set: update }
  );
  return { updated: true };
}

export async function verifyVisitorSession(token: string, origin: string | undefined): Promise<VerifiedWidgetVisitor> {
  const claims = parseVisitorSessionToken(token);
  const [website, visitor] = await Promise.all([
    Website.findOne({
      _id: claims.website,
      workspaceId: claims.workspace,
      status: "active"
    }).select("allowedOrigins widgetSettings name"),
    Visitor.findOne({
      _id: claims.visitor,
      websiteId: claims.website,
      workspaceId: claims.workspace
    })
  ]);
  if (!website || !visitor) throw new AppError("Visitor session is no longer active", 401, "WIDGET_SESSION_INVALID");
  assertOriginMatchesWebsite(origin, website);
  return {
    ...claims,
    websiteSettings: {
      collectName: website.widgetSettings.collectName,
      collectEmail: website.widgetSettings.collectEmail,
      offlineContactForm: website.widgetSettings.offlineContactForm
    }
  };
}

export async function getOrCreateVisitorConversation(visitor: VerifiedWidgetVisitor) {
  let conversation = await Conversation.findOne({
    workspaceId: visitor.workspace,
    websiteId: visitor.website,
    visitorId: visitor.visitor,
    status: { $in: ["open", "pending"] }
  }).sort({ lastMessageAt: -1 });
  let created = false;
  if (!conversation) {
    await reserveWorkspaceUsage(visitor.workspace, "monthlyConversations");
    try {
      conversation = await Conversation.create({
        workspaceId: visitor.workspace,
        websiteId: visitor.website,
        visitorId: visitor.visitor,
        status: "open",
        lastMessageAt: new Date()
      });
      created = true;
    } catch (error) {
      await releaseWorkspaceUsage(visitor.workspace, "monthlyConversations");
      throw error;
    }
  }
  const messages = await Message.find({
    workspaceId: visitor.workspace,
    conversationId: conversation._id,
    deletedAt: null
  }).sort({ createdAt: 1, _id: 1 }).limit(100).lean();
  return {
    conversationId: conversation._id.toString(),
    status: conversation.status,
    created,
    messages: messages.map((message) => ({
      id: message._id.toString(),
      senderType: message.senderType,
      body: message.body,
      createdAt: message.createdAt,
      clientMessageId: message.clientMessageId,
      status: "sent"
    }))
  };
}

export async function authorizeVisitorConversation(
  visitor: VerifiedWidgetVisitor,
  conversationId: string
) {
  if (!/^[\da-f]{24}$/i.test(conversationId)) {
    throw new AppError("Conversation not found", 404, "NOT_FOUND");
  }
  const conversation = await Conversation.findOne({
    _id: conversationId,
    workspaceId: visitor.workspace,
    websiteId: visitor.website,
    visitorId: visitor.visitor
  });
  if (!conversation) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  return conversation;
}

export async function createVisitorMessage(
  visitor: VerifiedWidgetVisitor,
  conversationId: string,
  input: unknown
) {
  const conversation = await authorizeVisitorConversation(visitor, conversationId);
  if (conversation.status === "resolved") {
    throw new AppError("This conversation is resolved", 409, "CONVERSATION_RESOLVED");
  }
  return persistConversationMessage({
    workspaceId: new Types.ObjectId(visitor.workspace),
    conversationId: conversation._id,
    senderType: "visitor",
    senderId: new Types.ObjectId(visitor.visitor),
    source: "widget",
    input
  });
}

export async function markVisitorConversationRead(visitor: VerifiedWidgetVisitor, conversationId: string) {
  const conversation = await authorizeVisitorConversation(visitor, conversationId);
  await Conversation.updateOne(
    { _id: conversation._id, workspaceId: visitor.workspace },
    { $set: { visitorUnreadCount: 0 } }
  );
}
