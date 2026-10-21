import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { WorkspaceMember } from "../models/index.js";
import { parseObjectId, requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";
import { writeAuditLog } from "./audit.js";
import { releaseUsage, reserveUsage } from "./usage-service.js";

const memberRoleSchema = z.enum(["admin", "supervisor", "agent"]);

export async function listMembers(actor: TenantActor, workspaceId: string) {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  return WorkspaceMember.find({ workspaceId: scope.workspaceId })
    .populate("userId", "name email avatarUrl accountStatus")
    .sort({ createdAt: 1 })
    .lean();
}

export async function updateMemberRole(
  actor: TenantActor,
  workspaceId: string,
  memberId: string,
  requestedRole: unknown
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const parsedRole = memberRoleSchema.safeParse(requestedRole);
  if (!parsedRole.success) {
    throw new AppError("Invalid member role", 400, "VALIDATION_ERROR");
  }

  const target = await WorkspaceMember.findOne({
    _id: parseObjectId(memberId, "member id"),
    workspaceId: scope.workspaceId
  });
  if (!target || target.role === "owner") {
    throw new AppError("Workspace member not found", 404, "NOT_FOUND");
  }
  if (scope.membership.role === "admin" && target.role === "admin") {
    throw new AppError("Workspace member not found", 404, "NOT_FOUND");
  }

  const previousRole = target.role;
  target.role = parsedRole.data;
  await target.save();
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "workspace_member.role_updated",
    resourceType: "workspace_member",
    resourceId: target._id,
    changedFields: ["role", `role:${previousRole}->${target.role}`]
  });
  return target;
}

export async function setMemberStatus(
  actor: TenantActor,
  workspaceId: string,
  memberId: string,
  status: "active" | "suspended"
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  if (status !== "active" && status !== "suspended") {
    throw new AppError("Invalid member status", 400, "VALIDATION_ERROR");
  }
  const target = await WorkspaceMember.findOne({
    _id: parseObjectId(memberId, "member id"),
    workspaceId: scope.workspaceId
  });
  if (!target || target.role === "owner") {
    throw new AppError("Workspace member not found", 404, "NOT_FOUND");
  }
  if (scope.membership.role === "admin" && target.role === "admin") {
    throw new AppError("Workspace member not found", 404, "NOT_FOUND");
  }
  if (target.status === status) return target;

  if (status === "active") {
    await reserveUsage(actor, workspaceId, "members");
  } else {
    await releaseUsage(actor, workspaceId, "members");
  }
  target.status = status;
  try {
    await target.save();
  } catch (error) {
    if (status === "active") {
      await releaseUsage(actor, workspaceId, "members");
    } else {
      await reserveUsage(actor, workspaceId, "members");
    }
    throw error;
  }
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "workspace_member.status_updated",
    resourceType: "workspace_member",
    resourceId: target._id,
    changedFields: ["status"]
  });
  return target;
}
