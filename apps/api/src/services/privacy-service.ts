import { AppError } from "../errors/app-error.js";
import { Conversation, Message, Visitor } from "../models/index.js";
import { parseObjectId, requireWorkspaceMember, type TenantActor } from "./tenant-authorization.js";
import { writeAuditLog } from "./audit.js";

export async function eraseVisitorPersonalData(
  actor: TenantActor,
  workspaceId: string,
  visitorId: string
): Promise<void> {
  const scope = await requireWorkspaceMember(actor, workspaceId, ["owner", "admin"]);
  const id = parseObjectId(visitorId, "visitor id");
  const visitor = await Visitor.findOne({ _id: id, workspaceId: scope.workspaceId }).select("_id");
  if (!visitor) throw new AppError("Visitor not found", 404, "NOT_FOUND");
  const conversations = await Conversation.find({
    workspaceId: scope.workspaceId,
    visitorId: visitor._id
  }).select("_id");
  const conversationIds = conversations.map((conversation) => conversation._id);
  if (conversationIds.length) {
    await Message.updateMany(
      {
        workspaceId: scope.workspaceId,
        conversationId: { $in: conversationIds },
        senderType: "visitor"
      },
      {
        $set: {
          body: "Message removed for privacy",
          senderId: null,
          attachments: [],
          deletedAt: new Date()
        }
      }
    );
    await Conversation.updateMany(
      { workspaceId: scope.workspaceId, _id: { $in: conversationIds } },
      { $set: { subject: null, lastMessagePreview: "", visitorUnreadCount: 0 } }
    );
  }
  await Visitor.updateOne(
    { _id: id, workspaceId: scope.workspaceId },
    {
      $set: {
        displayName: null,
        email: null,
        phone: null,
        currentPageUrl: null,
        referrer: null,
        browser: null,
        operatingSystem: null,
        country: null,
        customAttributes: new Map()
      }
    }
  );
  await writeAuditLog({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "visitor.personal_data_erased",
    resourceType: "visitor",
    resourceId: visitor._id,
    changedFields: [
      "displayName",
      "email",
      "phone",
      "currentPageUrl",
      "referrer",
      "browser",
      "operatingSystem",
      "country",
      "customAttributes"
    ]
  });
}
