import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { Visitor, Website } from "../models/index.js";
import { env } from "../config/env.js";
import { assertWidgetOrigin } from "../security/origins.js";
import { parseObjectId, requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";

const widgetVisitorInputSchema = z.object({
  visitorId: z.string().trim().min(32).max(128),
  displayName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  currentPageUrl: z.string().url().max(2048).optional(),
  referrer: z.string().url().max(2048).optional(),
  consent: z.object({
    analytics: z.boolean().optional(),
    chat: z.boolean().optional(),
    policyVersion: z.string().trim().max(40).optional()
  }).strict().optional(),
  customAttributes: z.record(z.string().trim().max(80), z.string().max(500)).refine(
    (attributes) =>
      Object.keys(attributes).length <= 50 &&
      Object.keys(attributes).every(
        (key) =>
          /^[a-zA-Z][\w.-]{0,79}$/.test(key) &&
          !/(password|token|secret|ssn|credit.?card)/i.test(key)
      )
  ).optional()
}).strict();

export async function getVisitor(
  actor: TenantActor,
  workspaceId: string,
  visitorDocumentId: string
) {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  const visitor = await Visitor.findOne({
    _id: parseObjectId(visitorDocumentId, "visitor id"),
    workspaceId: scope.workspaceId
  });
  if (!visitor) throw new AppError("Visitor not found", 404, "NOT_FOUND");
  return visitor;
}

export async function findOrCreateWidgetVisitor(
  publicWidgetId: string,
  origin: string | undefined,
  input: unknown
) {
  await assertWidgetOrigin(publicWidgetId, origin);
  const parsed = widgetVisitorInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("Invalid visitor details", 400, "VALIDATION_ERROR");
  const website = await Website.findOne({
    publicWidgetId,
    status: "active",
    ...(env.NODE_ENV !== "production" && env.WIDGET_DEV_MODE === "true" &&
    origin &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)
      ? {}
      : { allowedOrigins: origin })
  }).select("_id workspaceId allowedOrigins");
  if (!website || !origin) throw new AppError("Widget not found", 404, "NOT_FOUND");

  const pageUrl = parsed.data.currentPageUrl ? new URL(parsed.data.currentPageUrl) : undefined;
  const isLocalDevPage =
    env.NODE_ENV !== "production" &&
    env.WIDGET_DEV_MODE === "true" &&
    origin === pageUrl?.origin &&
    !!pageUrl &&
    ["localhost", "127.0.0.1", "[::1]"].includes(pageUrl.hostname);
  if (pageUrl && !website.allowedOrigins.includes(pageUrl.origin) && !isLocalDevPage) {
    throw new AppError("Page origin is not allowed", 403, "ORIGIN_NOT_ALLOWED");
  }
  if (pageUrl) {
    pageUrl.search = "";
    pageUrl.hash = "";
  }
  const referrerUrl = parsed.data.referrer ? new URL(parsed.data.referrer) : undefined;
  if (referrerUrl) {
    if (!["https:", "http:"].includes(referrerUrl.protocol)) {
      throw new AppError("Invalid referrer", 400, "VALIDATION_ERROR");
    }
    referrerUrl.search = "";
    referrerUrl.hash = "";
  }

  const scope = { workspaceId: website.workspaceId, websiteId: website._id };
  const filter = { ...scope, visitorId: parsed.data.visitorId };
  const update = {
    $set: {
      lastSeenAt: new Date(),
      currentPageUrl: pageUrl?.toString() ?? null,
      referrer: referrerUrl?.toString() ?? null,
      ...(parsed.data.displayName !== undefined && { displayName: parsed.data.displayName }),
      ...(parsed.data.email !== undefined && { email: parsed.data.email }),
      ...(parsed.data.phone !== undefined && { phone: parsed.data.phone }),
      ...(parsed.data.consent !== undefined && { consent: parsed.data.consent }),
      ...(parsed.data.customAttributes !== undefined && {
        customAttributes: parsed.data.customAttributes
      })
    },
    $setOnInsert: { firstSeenAt: new Date() }
  };
  try {
    return await Visitor.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true
    });
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 11000) {
      throw error;
    }
    return Visitor.findOneAndUpdate(filter, update, { new: true, runValidators: true });
  }
}
