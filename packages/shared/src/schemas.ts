import { z } from "zod";

export const workspaceRoleSchema = z.enum(["owner", "admin", "supervisor", "agent"]);
export const conversationStatusSchema = z.enum(["open", "pending", "resolved"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const registrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
});

export const widgetSettingsSchema = z.object({
  accentColor: z.string().regex(/^#[\da-fA-F]{6}$/).optional(),
  welcomeMessage: z.string().trim().max(500).optional(),
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  subtitle: z.string().trim().max(120).optional(),
  launcherLabel: z.string().trim().max(40).optional(),
  launcherIcon: z.enum(["chat", "message"]).optional(),
  logoUrl: z.string().url().max(2048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).nullable().optional(),
  theme: z.enum(["light", "dark"]).optional(),
  onlineText: z.string().trim().max(80).optional(),
  offlineText: z.string().trim().max(80).optional(),
  greeting: z.string().trim().max(500).optional(),
  collectName: z.boolean().optional(),
  collectEmail: z.boolean().optional(),
  offlineContactForm: z.boolean().optional(),
  availabilitySchedule: z.array(z.object({
    day: z.number().int().min(0).max(6),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  }).strict().refine((period) => period.end > period.start)).max(14).optional(),
  availabilityTimezone: z.string().trim().min(1).max(100).refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }).optional()
}).strict();

export const createWebsiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(1).max(253).refine((value) => {
    try {
      const url = new URL(`http://${value}`);
      return url.host.toLowerCase() === value.toLowerCase() && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
  allowedOrigins: z.array(z.string().url()).max(50)
});

export const objectIdSchema = z.string().regex(/^[\da-f]{24}$/i, "Invalid identifier");

export const messageInputSchema = z.object({
  clientMessageId: z.string().trim().min(1).max(128),
  body: z.string().trim().min(1).max(10_000)
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;
