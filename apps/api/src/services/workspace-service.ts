import { z } from "zod";
import mongoose from "mongoose";
import { AppError } from "../errors/app-error.js";
import { SubscriptionUsage, Workspace, WorkspaceMember } from "../models/index.js";
import {
  requireActiveUser,
  requireWorkspaceMember,
  type TenantActor
} from "./tenant-authorization.js";
import { writeAuditLog } from "./audit.js";
import { randomBytes } from "node:crypto";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

function makeSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return slug || "workspace";
}

export async function createWorkspace(actor: TenantActor, input: unknown) {
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) throw new AppError("Invalid workspace name", 400, "VALIDATION_ERROR");
  const userId = await requireActiveUser(actor);
  const name = parsed.data.name;
  const baseSlug = makeSlug(name);
  let workspace: InstanceType<typeof Workspace> | undefined;
  const transactionsUnsupported = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.includes("Transaction numbers are only allowed on a replica set member or mongos");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${randomBytes(4).toString("hex")}`;
    const slug = `${baseSlug.slice(0, 80 - suffix.length)}${suffix}`;
    try {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const [created] = await Workspace.create([{ name, slug, ownerUserId: userId }], { session });
          await WorkspaceMember.create([{
            workspaceId: created._id,
            userId,
            role: "owner",
            status: "active",
            joinedAt: new Date()
          }], { session });
          await SubscriptionUsage.create([{
            workspaceId: created._id,
            periodStart: new Date()
          }], { session });
          await writeAuditLog({
            workspaceId: created._id,
            actorUserId: userId,
            action: "workspace.created",
            resourceType: "workspace",
            resourceId: created._id
          }, session);
          workspace = created;
        });
      } finally {
        await session.endSession();
      }
      break;
    } catch (error) {
      if (transactionsUnsupported(error)) {
        const [created] = await Workspace.create([{ name, slug, ownerUserId: userId }]);
        try {
          await WorkspaceMember.create({
            workspaceId: created._id,
            userId,
            role: "owner",
            status: "active",
            joinedAt: new Date()
          });
          await SubscriptionUsage.create({
            workspaceId: created._id,
            periodStart: new Date()
          });
          await writeAuditLog({
            workspaceId: created._id,
            actorUserId: userId,
            action: "workspace.created",
            resourceType: "workspace",
            resourceId: created._id
          });
          workspace = created;
          break;
        } catch (fallbackError) {
          await Promise.all([
            WorkspaceMember.deleteOne({ workspaceId: created._id }),
            SubscriptionUsage.deleteOne({ workspaceId: created._id }),
            Workspace.deleteOne({ _id: created._id })
          ]);
          throw fallbackError;
        }
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000 &&
        attempt < 4
      ) {
        continue;
      }
      throw error;
    }
  }
  if (!workspace) throw new AppError("Unable to create workspace", 409, "SLUG_CONFLICT");
  return workspace;
}

export async function listWorkspaces(actor: TenantActor) {
  const userId = await requireActiveUser(actor);
  return WorkspaceMember.find({ userId, status: "active" })
    .populate({ path: "workspaceId", select: "name slug createdAt" })
    .sort({ createdAt: 1 })
    .lean();
}

export async function getWorkspace(actor: TenantActor, workspaceId: string) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const workspace = await Workspace.findById(scope.workspaceId).lean();
  if (!workspace) throw new AppError("Workspace not found", 404, "NOT_FOUND");
  return workspace;
}
