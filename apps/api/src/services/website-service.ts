import { createWebsiteSchema, widgetSettingsSchema } from "@live-chat/shared";
import { AppError } from "../errors/app-error.js";
import { Website } from "../models/index.js";
import { parseObjectId, requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";
import { writeAuditLog } from "./audit.js";
import { releaseUsage, reserveUsage } from "./usage-service.js";

function validateExactOrigins(origins: string[]): void {
  if (
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return !["https:", "http:"].includes(url.protocol) || url.origin !== origin;
      } catch {
        return true;
      }
    })
  ) {
    throw new AppError("Allowed origins must be exact http(s) origins", 400, "INVALID_ORIGIN");
  }
}

export async function createWebsite(
  actor: TenantActor,
  workspaceId: string,
  input: unknown
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const data = createWebsiteSchema.safeParse(input);
  if (!data.success) {
    throw new AppError("Invalid website details", 400, "VALIDATION_ERROR");
  }
  validateExactOrigins(data.data.allowedOrigins);
  await reserveUsage(actor, workspaceId, "websites");
  let websiteId: ReturnType<typeof parseObjectId> | undefined;
  try {
    const website = await Website.create({
      workspaceId: scope.workspaceId,
      name: data.data.name,
      domain: data.data.domain.toLowerCase(),
      allowedOrigins: data.data.allowedOrigins
    });
    websiteId = website._id;
    await writeAuditLog({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "website.created",
      resourceType: "website",
      resourceId: website._id,
      changedFields: ["name", "domain", "allowedOrigins"]
    });
    return website;
  } catch (error) {
    if (websiteId) await Website.deleteOne({ _id: websiteId, workspaceId: scope.workspaceId });
    await releaseUsage(actor, workspaceId, "websites");
    throw error;
  }
}

export async function listWebsites(actor: TenantActor, workspaceId: string) {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  return Website.find({ workspaceId: scope.workspaceId }).sort({ createdAt: -1 }).lean();
}

export async function getWebsite(
  actor: TenantActor,
  workspaceId: string,
  websiteId: string
) {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  const website = await Website.findOne({
    _id: parseObjectId(websiteId, "website id"),
    workspaceId: scope.workspaceId
  });
  if (!website) throw new AppError("Website not found", 404, "NOT_FOUND");
  return website;
}

export async function updateWebsite(
  actor: TenantActor,
  workspaceId: string,
  websiteId: string,
  input: unknown
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppError("Invalid website update", 400, "VALIDATION_ERROR");
  }
  const data = input as Record<string, unknown>;
  const allowedKeys = ["name", "domain", "allowedOrigins", "widgetSettings", "status"];
  if (Object.keys(data).some((key) => !allowedKeys.includes(key))) {
    throw new AppError("Unsupported website field", 400, "VALIDATION_ERROR");
  }
  const update: Record<string, unknown> = {};
  if ("name" in data) {
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 120) {
      throw new AppError("Invalid website name", 400, "VALIDATION_ERROR");
    }
    update.name = data.name.trim();
  }
  if ("domain" in data) {
    const parsedDomain = createWebsiteSchema.shape.domain.safeParse(data.domain);
    if (!parsedDomain.success) {
      throw new AppError("Invalid website domain", 400, "VALIDATION_ERROR");
    }
    update.domain = parsedDomain.data.toLowerCase();
  }
  if ("allowedOrigins" in data) {
    if (!Array.isArray(data.allowedOrigins) || data.allowedOrigins.some((item) => typeof item !== "string")) {
      throw new AppError("Invalid allowed origins", 400, "VALIDATION_ERROR");
    }
    validateExactOrigins(data.allowedOrigins);
    update.allowedOrigins = data.allowedOrigins;
  }
  if ("widgetSettings" in data) {
    const parsedSettings = widgetSettingsSchema.safeParse(data.widgetSettings);
    if (!parsedSettings.success) {
      throw new AppError("Invalid widget settings", 400, "VALIDATION_ERROR");
    }
    update.widgetSettings = parsedSettings.data;
  }
  if ("status" in data) {
    if (data.status !== "active" && data.status !== "disabled") {
      throw new AppError("Invalid website status", 400, "VALIDATION_ERROR");
    }
    update.status = data.status;
  }
  const website = await Website.findOneAndUpdate(
    { _id: parseObjectId(websiteId, "website id"), workspaceId: scope.workspaceId },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!website) throw new AppError("Website not found", 404, "NOT_FOUND");
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "website.updated",
    resourceType: "website",
    resourceId: website._id,
    changedFields: Object.keys(update)
  });
  return website;
}

export async function disableWebsite(
  actor: TenantActor,
  workspaceId: string,
  websiteId: string
) {
  return updateWebsite(actor, workspaceId, websiteId, { status: "disabled" });
}
