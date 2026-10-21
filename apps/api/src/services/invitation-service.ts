import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { Invitation, User, Workspace, WorkspaceMember } from "../models/index.js";
import { createOpaqueToken, hashOpaqueToken } from "./token-service.js";
import {
  parseObjectId,
  requireWorkspaceMember,
  type TenantActor
} from "./tenant-authorization.js";
import { releaseWorkspaceUsage, reserveWorkspaceUsage } from "./usage-service.js";
import { writeAuditLog } from "./audit.js";

const invitationInputSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["admin", "supervisor", "agent"])
});

export async function createInvitation(
  actor: TenantActor,
  workspaceId: string,
  input: unknown
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const parsed = invitationInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("Invalid invitation", 400, "VALIDATION_ERROR");
  if (scope.membership.role === "admin" && parsed.data.role === "admin") {
    throw new AppError("Workspace member not found", 404, "NOT_FOUND");
  }

  const email = parsed.data.email.toLowerCase();
  const invitee = await User.findOne({ email }).select("_id");
  if (invitee) {
    const existingMember = await WorkspaceMember.findOne({
      workspaceId: scope.workspaceId,
      userId: invitee._id,
      status: { $in: ["active", "invited"] }
    }).select("_id");
    if (existingMember) {
      throw new AppError("Workspace invitation cannot be created", 409, "INVITATION_CONFLICT");
    }
  }
  const existingInvitation = await Invitation.findOne({
    workspaceId: scope.workspaceId,
    email,
    acceptedAt: null,
    expiresAt: { $gt: new Date() }
  }).select("_id");
  if (existingInvitation) {
    throw new AppError("Workspace invitation cannot be created", 409, "INVITATION_CONFLICT");
  }

  const { token, tokenHash } = createOpaqueToken();
  const invitation = await Invitation.create({
    workspaceId: scope.workspaceId,
    email,
    role: parsed.data.role,
    tokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    invitedBy: scope.userId
  });
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "workspace_invitation.created",
    resourceType: "invitation",
    resourceId: invitation._id
  });
  return {
    invitation: {
      id: invitation._id.toString(),
      workspaceId: invitation.workspaceId.toString(),
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt
    },
    token
  };
}

export async function listInvitations(actor: TenantActor, workspaceId: string) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  return Invitation.find({
    workspaceId: scope.workspaceId,
    acceptedAt: null
  }).select("email role expiresAt createdAt invitedBy").sort({ createdAt: -1 }).lean();
}

export async function invitationEmailContext(workspaceId: string, email: string) {
  const workspace = await Workspace.findById(workspaceId).select("name").lean();
  return { workspaceName: workspace?.name ?? "your workspace", email };
}

export async function resendInvitation(
  actor: TenantActor,
  workspaceId: string,
  invitationId: string
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const invitation = await Invitation.findOne({
    _id: parseObjectId(invitationId, "invitation id"),
    workspaceId: scope.workspaceId,
    acceptedAt: null
  });
  if (!invitation || (scope.membership.role === "admin" && invitation.role === "admin")) {
    throw new AppError("Invitation not found", 404, "NOT_FOUND");
  }

  const { token, tokenHash } = createOpaqueToken();
  invitation.tokenHash = tokenHash;
  invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await invitation.save();
  return {
    invitation: {
      id: invitation._id.toString(),
      workspaceId: invitation.workspaceId.toString(),
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt
    },
    token
  };
}

export async function revokeInvitation(
  actor: TenantActor,
  workspaceId: string,
  invitationId: string
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const invitation = await Invitation.findOne({
    _id: parseObjectId(invitationId, "invitation id"),
    workspaceId: scope.workspaceId,
    acceptedAt: null
  });
  if (!invitation || (scope.membership.role === "admin" && invitation.role === "admin")) {
    throw new AppError("Invitation not found", 404, "NOT_FOUND");
  }
  await Invitation.deleteOne({ _id: invitation._id, workspaceId: scope.workspaceId });
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "workspace_invitation.revoked",
    resourceType: "invitation",
    resourceId: invitation._id
  });
}

export async function acceptInvitation(actor: TenantActor, token: string) {
  if (token.length < 32 || token.length > 128) {
    throw new AppError("Invitation is invalid or expired", 404, "NOT_FOUND");
  }
  const userId = parseObjectId(actor.userId, "user id");
  const user = await User.findOne({ _id: userId, accountStatus: "active" }).select("email");
  if (!user) throw new AppError("Invitation is invalid or expired", 404, "NOT_FOUND");

  const acceptedAt = new Date();
  const invitation = await Invitation.findOneAndUpdate(
    {
      tokenHash: hashOpaqueToken(token),
      email: user.email,
      acceptedAt: null,
      expiresAt: { $gt: acceptedAt }
    },
    { $set: { acceptedAt } },
    { new: true }
  );
  if (!invitation) throw new AppError("Invitation is invalid or expired", 404, "NOT_FOUND");

  let member: InstanceType<typeof WorkspaceMember> | null = null;
  let usageReserved = false;
  try {
    const existingMember = await WorkspaceMember.findOne({
      workspaceId: invitation.workspaceId,
      userId
    });
    if (existingMember?.status === "active") {
      throw new AppError("Invitation cannot be accepted for an active member", 409, "INVITATION_CONFLICT");
    }
    if (existingMember?.status === "suspended") {
      await reserveWorkspaceUsage(invitation.workspaceId.toString(), "members");
      usageReserved = true;
      existingMember.role = invitation.role;
      existingMember.status = "active";
      existingMember.invitedAt = invitation.createdAt;
      existingMember.joinedAt = acceptedAt;
      member = await existingMember.save();
    } else {
      await reserveWorkspaceUsage(invitation.workspaceId.toString(), "members");
      usageReserved = true;
      member = await WorkspaceMember.create({
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        status: "active",
        invitedAt: invitation.createdAt,
        joinedAt: acceptedAt
      });
    }
  } catch (error) {
    await Invitation.updateOne(
      { _id: invitation._id, acceptedAt },
      { $set: { acceptedAt: null } }
    );
    if (usageReserved) {
      await releaseWorkspaceUsage(invitation.workspaceId.toString(), "members");
    }
    throw error;
  }

  await writeAuditLog({
    workspaceId: invitation.workspaceId,
    actorUserId: userId,
    action: "workspace_invitation.accepted",
    resourceType: "workspace_member",
    resourceId: member._id
  });
  return {
    workspaceId: invitation.workspaceId.toString(),
    memberId: member._id.toString(),
    role: member.role
  };
}
