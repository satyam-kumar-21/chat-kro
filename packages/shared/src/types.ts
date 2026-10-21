import type { ConversationStatus, WorkspaceRole } from "./schemas.js";

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface WebsiteSummary {
  id: string;
  workspaceId: string;
  name: string;
  publicWidgetId: string;
  allowedOrigins: string[];
}

export interface ConversationSummary {
  id: string;
  websiteId: string;
  status: ConversationStatus;
  unreadCount: number;
}
