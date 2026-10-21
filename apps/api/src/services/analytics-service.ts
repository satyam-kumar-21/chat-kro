import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { Conversation, Message, Website, WorkspaceMember } from "../models/index.js";
import { requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
}).strict();

export async function getWorkspaceAnalytics(
  actor: TenantActor,
  workspaceId: string,
  query: unknown
) {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  const parsed = dateRangeSchema.safeParse(query);
  if (!parsed.success) throw new AppError("Invalid analytics date range", 400, "VALIDATION_ERROR");
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from >= to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new AppError("Analytics range must be chronological and no longer than one year", 400, "VALIDATION_ERROR");
  }
  const workspace = scope.workspaceId;
  const dateQuery = { $gte: from, $lt: to };
  const conversations = await Conversation.find({
    workspaceId: workspace,
    createdAt: dateQuery
  }).select("_id websiteId assignedAgentId status createdAt closedAt").lean();
  const conversationIds = conversations.map((item) => item._id);
  const [websites, members, messages, timeline] = await Promise.all([
    Website.find({ workspaceId: workspace }).select("name domain").lean(),
    WorkspaceMember.find({ workspaceId: workspace }).populate("userId", "name email").lean(),
    Message.find({
      workspaceId: workspace,
      conversationId: { $in: conversationIds },
      createdAt: dateQuery,
      deletedAt: null
    }).select("conversationId senderType createdAt").sort({ createdAt: 1 }).lean(),
    Message.aggregate([
      { $match: { workspaceId: workspace, createdAt: dateQuery, deletedAt: null } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" }
          },
          messages: { $sum: 1 },
          visitorMessages: { $sum: { $cond: [{ $eq: ["$senderType", "visitor"] }, 1, 0] } },
          agentMessages: { $sum: { $cond: [{ $eq: ["$senderType", "agent"] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);
  const messagesByConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    const key = message.conversationId.toString();
    const bucket = messagesByConversation.get(key) ?? [];
    bucket.push(message);
    messagesByConversation.set(key, bucket);
  }
  const responseSamples: number[] = [];
  for (const conversation of conversations) {
    const history = messagesByConversation.get(conversation._id.toString()) ?? [];
    const firstVisitor = history.find((message) => message.senderType === "visitor");
    if (!firstVisitor) continue;
    const firstResponse = history.find((message) =>
      message.senderType === "agent" && message.createdAt >= firstVisitor.createdAt
    );
    if (firstResponse) {
      const seconds = (firstResponse.createdAt.getTime() - firstVisitor.createdAt.getTime()) / 1000;
      if (Number.isFinite(seconds) && seconds >= 0) responseSamples.push(seconds);
    }
  }
  const resolutionSamples = conversations.flatMap((conversation) => {
    if (conversation.status !== "resolved" || !conversation.closedAt) return [];
    const seconds = (conversation.closedAt.getTime() - conversation.createdAt.getTime()) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? [seconds] : [];
  });
  const average = (samples: number[]) => samples.length
    ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
    : null;
  const byWebsite = new Map<string, number>();
  const byAgent = new Map<string, number>();
  for (const conversation of conversations) {
    const websiteId = conversation.websiteId.toString();
    byWebsite.set(websiteId, (byWebsite.get(websiteId) ?? 0) + 1);
    const agentId = conversation.assignedAgentId?.toString() ?? "unassigned";
    byAgent.set(agentId, (byAgent.get(agentId) ?? 0) + 1);
  }
  const websiteNames = new Map(websites.map((item) => [item._id.toString(), item]));
  const memberNames = new Map(members.map((item) => [
    item.userId && typeof item.userId === "object" && "_id" in item.userId
      ? item.userId._id.toString()
      : "",
    item.userId && typeof item.userId === "object" && "name" in item.userId
      ? item.userId.name
      : "Workspace member"
  ]));
  const statusCounts = conversations.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, { open: 0, pending: 0, resolved: 0 });
  return {
    range: { from, to },
    totals: {
      conversations: conversations.length,
      open: statusCounts.open,
      pending: statusCounts.pending,
      resolved: statusCounts.resolved,
      messages: timeline.reduce((sum, item) => sum + item.messages, 0)
    },
    firstResponseTime: { averageSeconds: average(responseSamples), sampleSize: responseSamples.length },
    resolutionTime: { averageSeconds: average(resolutionSamples), sampleSize: resolutionSamples.length },
    byWebsite: [...byWebsite].map(([id, count]) => ({
      websiteId: id,
      name: websiteNames.get(id)?.name ?? "Website",
      domain: websiteNames.get(id)?.domain ?? "",
      conversations: count
    })),
    byAgent: [...byAgent].map(([id, count]) => ({
      agentId: id === "unassigned" ? null : id,
      name: id === "unassigned" ? "Unassigned" : memberNames.get(id) ?? "Workspace member",
      conversations: count
    })),
    messageVolume: timeline.map((item) => ({
      date: item._id,
      messages: item.messages,
      visitorMessages: item.visitorMessages,
      agentMessages: item.agentMessages
    }))
  };
}
