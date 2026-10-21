import { type ClientSession, type Types } from "mongoose";
import { AuditLog } from "../models/index.js";

export async function writeAuditLog(input: {
  workspaceId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  action: string;
  resourceType: string;
  resourceId?: Types.ObjectId;
  changedFields?: string[];
}, session?: ClientSession): Promise<void> {
  const { changedFields, ...auditRecord } = input;
  const record = {
    ...auditRecord,
    safeMetadata: { source: "api", changedFields: changedFields ?? [] }
  };
  if (session) await AuditLog.create([record], { session });
  else await AuditLog.create(record);
}
