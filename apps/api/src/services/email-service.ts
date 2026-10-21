import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export async function sendActionEmail(input: {
  to: string;
  subject: string;
  actionUrl: string;
  actionLabel: string;
}) {
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return false;
    logger.error({ code: "EMAIL_UNAVAILABLE" }, "Action email delivery is not configured");
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER && env.SMTP_PASSWORD
      ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
      : undefined
  });
  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: `${input.actionLabel}: ${input.actionUrl}`,
      html: `<p>${input.actionLabel}</p><p><a href="${input.actionUrl}">${input.actionLabel}</a></p>`
    });
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Action email delivery failed"
    );
    return false;
  }
  return true;
}
