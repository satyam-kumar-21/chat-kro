import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { CannedReply } from "../models/index.js";
import { parseObjectId, requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";

const cannedReplyInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]+$/).max(50),
  body: z.string().trim().min(1).max(10000)
});

function safeBody(body: string): string {
  const safe = sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} }).trim();
  if (!safe) throw new AppError("Reply text cannot be empty", 400, "VALIDATION_ERROR");
  return safe;
}

export async function listCannedReplies(actor: TenantActor, workspaceId: string, search = "") {
  const scope = await requireWorkspaceMember(actor, workspaceId);
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
  const query = search.trim().slice(0, 100);
  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "i");
    filter.$or = [{ title: expression }, { shortcut: expression }, { body: expression }];
  }
  return CannedReply.find(filter).sort({ shortcut: 1 }).limit(100).lean();
}

export async function updateCannedReply(
  actor: TenantActor,
  workspaceId: string,
  cannedReplyId: string,
  input: unknown
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin", "supervisor"]);
  const parsed = cannedReplyInputSchema.partial().safeParse(input);
  if (!parsed.success || !Object.keys(parsed.data).length) {
    throw new AppError("Invalid canned reply", 400, "VALIDATION_ERROR");
  }
  const update = {
    ...parsed.data,
    ...(parsed.data.body ? { body: safeBody(parsed.data.body) } : {})
  };
  const reply = await CannedReply.findOneAndUpdate(
    { _id: parseObjectId(cannedReplyId, "canned reply id"), workspaceId: scope.workspaceId },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!reply) throw new AppError("Canned reply not found", 404, "NOT_FOUND");
  return reply;
}

export async function createCannedReply(
  actor: TenantActor,
  workspaceId: string,
  input: unknown
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin", "supervisor"]);
  const parsed = cannedReplyInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("Invalid canned reply", 400, "VALIDATION_ERROR");
  return CannedReply.create({
    workspaceId: scope.workspaceId,
    createdBy: scope.userId,
    ...parsed.data,
    body: safeBody(parsed.data.body)
  });
}

export async function deleteCannedReply(
  actor: TenantActor,
  workspaceId: string,
  cannedReplyId: string
) {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin", "supervisor"]);
  const reply = await CannedReply.findOneAndDelete({
    _id: parseObjectId(cannedReplyId, "canned reply id"),
    workspaceId: scope.workspaceId
  });
  if (!reply) throw new AppError("Canned reply not found", 404, "NOT_FOUND");
}
