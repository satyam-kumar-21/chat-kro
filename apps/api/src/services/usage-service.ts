import { AppError } from "../errors/app-error.js";
import {
  Conversation,
  Message,
  SubscriptionUsage,
  Website,
  Workspace,
  WorkspaceMember
} from "../models/index.js";
import { parseObjectId, requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";

export const planLimits = {
  free: { websites: 1, members: 2, monthlyConversations: 100, monthlyMessages: 1000, fileStorageBytes: 100_000_000 },
  starter: { websites: 3, members: 5, monthlyConversations: 1000, monthlyMessages: 10000, fileStorageBytes: 1_000_000_000 },
  pro: { websites: 10, members: 20, monthlyConversations: 10000, monthlyMessages: 100000, fileStorageBytes: 10_000_000_000 },
  business: {
    websites: 100,
    members: 250,
    monthlyConversations: 100000,
    monthlyMessages: 1000000,
    fileStorageBytes: 100_000_000_000
  }
} as const;

export type UsageMetric = keyof (typeof planLimits)["free"];

function currentMonthStart(): Date {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export async function reserveUsage(
  actor: TenantActor,
  workspaceId: string,
  metric: UsageMetric,
  amount = 1
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  return reserveWorkspaceUsage(scope.workspaceId.toString(), metric, amount);
}

export async function reserveWorkspaceUsage(
  workspaceId: string,
  metric: UsageMetric,
  amount = 1
) {
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new AppError("Invalid usage increment", 400, "VALIDATION_ERROR");
  }
  const scopeId = parseObjectId(workspaceId, "workspace id");
  const workspace = await Workspace.findById(scopeId).select("plan").lean();
  if (!workspace) throw new AppError("Workspace not found", 404, "NOT_FOUND");
  const limit = planLimits[workspace.plan][metric];
  const periodStart = currentMonthStart();
  const [websites, members, monthlyConversations, monthlyMessages] = await Promise.all([
    Website.countDocuments({ workspaceId: scopeId }),
    WorkspaceMember.countDocuments({ workspaceId: scopeId, status: "active" }),
    Conversation.countDocuments({ workspaceId: scopeId, createdAt: { $gte: periodStart } }),
    Message.countDocuments({ workspaceId: scopeId, createdAt: { $gte: periodStart } })
  ]);

  await SubscriptionUsage.updateOne(
    { workspaceId: scopeId },
    {
      $setOnInsert: {
        workspaceId: scopeId,
        websites,
        members,
        monthlyConversations,
        monthlyMessages,
        fileStorageBytes: 0,
        periodStart
      }
    },
    { upsert: true }
  ).catch(async (error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return;
    throw error;
  });

  await SubscriptionUsage.updateOne(
    {
      workspaceId: scopeId,
      periodStart: { $lt: periodStart }
    },
    { $set: { monthlyConversations: 0, monthlyMessages: 0, periodStart } }
  );

  const result = await SubscriptionUsage.findOneAndUpdate(
    {
      workspaceId: scopeId,
      [metric]: { $lte: limit - amount }
    },
    { $inc: { [metric]: amount } },
    { new: true }
  );
  if (!result) throw new AppError("Workspace usage limit reached", 429, "USAGE_LIMIT_REACHED");
  return result;
}

export async function releaseUsage(
  actor: TenantActor,
  workspaceId: string,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  return releaseWorkspaceUsage(scope.workspaceId.toString(), metric, amount);
}

export async function releaseWorkspaceUsage(
  workspaceId: string,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new AppError("Invalid usage decrement", 400, "VALIDATION_ERROR");
  }
  const scopeId = parseObjectId(workspaceId, "workspace id");
  await SubscriptionUsage.updateOne(
    { workspaceId: scopeId, [metric]: { $gte: amount } },
    { $inc: { [metric]: -amount } }
  );
}

export async function getWorkspaceUsage(actor: TenantActor, workspaceId: string) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const workspace = await Workspace.findById(scope.workspaceId).select("plan subscriptionStatus").lean();
  if (!workspace) throw new AppError("Workspace not found", 404, "NOT_FOUND");
  const usage = await SubscriptionUsage.findOne({ workspaceId: scope.workspaceId }).lean();
  return {
    plan: workspace.plan,
    subscriptionStatus: workspace.subscriptionStatus,
    limits: planLimits[workspace.plan],
    usage: {
      websites: usage?.websites ?? 0,
      members: usage?.members ?? 0,
      monthlyConversations: usage?.monthlyConversations ?? 0,
      monthlyMessages: usage?.monthlyMessages ?? 0,
      fileStorageBytes: usage?.fileStorageBytes ?? 0,
      periodStart: usage?.periodStart ?? currentMonthStart()
    }
  };
}
