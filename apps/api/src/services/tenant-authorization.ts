import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import { Conversation, User, WorkspaceMember } from "../models/index.js";

export type TenantActor = { userId: string };
export type WorkspaceRole = "owner" | "admin" | "supervisor" | "agent";

export function parseObjectId(value: string, field = "id"): Types.ObjectId {
  if (!/^[\da-f]{24}$/i.test(value)) {
    throw new AppError(`Invalid ${field}`, 400, "INVALID_ID");
  }
  return new Types.ObjectId(value);
}

export async function requireActiveUser(actor: TenantActor) {
  const userId = parseObjectId(actor.userId, "user id");
  const user = await User.findOne({ _id: userId, accountStatus: "active" }).select("_id");
  if (!user) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  return userId;
}

export async function requireWorkspaceMember(
  actor: TenantActor,
  workspaceId: string,
  roles?: WorkspaceRole[]
) {
  const userObjectId = parseObjectId(actor.userId, "user id");
  const workspaceObjectId = parseObjectId(workspaceId, "workspace id");
  const membership = await WorkspaceMember.findOne({
    workspaceId: workspaceObjectId,
    userId: userObjectId,
    status: "active"
  }).lean();
  const user = await User.findOne({ _id: userObjectId, accountStatus: "active" }).select("_id");

  if (!membership || !user || (roles && !roles.includes(membership.role))) {
    throw new AppError("Workspace resource not found", 404, "NOT_FOUND");
  }
  return { userId: userObjectId, workspaceId: workspaceObjectId, membership };
}

export async function requireConversation(
  actor: TenantActor,
  workspaceId: string,
  conversationId: string
) {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  const conversation = await Conversation.findOne({
    _id: parseObjectId(conversationId, "conversation id"),
    workspaceId: scope.workspaceId
  });
  if (!conversation) {
    throw new AppError("Conversation not found", 404, "NOT_FOUND");
  }
  if (
    membershipRoleIsAgent(scope.membership.role) &&
    conversation.assignedAgentId &&
    conversation.assignedAgentId.toString() !== scope.userId.toString()
  ) {
    throw new AppError("Conversation not found", 404, "NOT_FOUND");
  }
  return { ...scope, conversation };
}

function membershipRoleIsAgent(role: WorkspaceRole): boolean {
  return role === "agent";
}
