import { Schema } from "mongoose";
import sanitizeHtml from "sanitize-html";

export const baseSchemaOptions = {
  timestamps: true,
  strict: "throw",
  versionKey: false
} as const;

export const objectId = { type: Schema.Types.ObjectId } as const;
export function sanitizePlainText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
}
export function isHttpUrl(value: string | null | undefined): boolean {
  if (value == null) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
export const optionalText = (maxLength: number) => ({
  type: String,
  trim: true,
  maxlength: maxLength
});
