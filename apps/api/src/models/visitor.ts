import { Schema, model } from "mongoose";
import {
  baseSchemaOptions,
  isHttpUrl,
  objectId,
  optionalText,
  sanitizePlainText
} from "./common.js";

const consentSchema = new Schema(
  {
    analytics: { type: Boolean, default: false },
    chat: { type: Boolean, default: true },
    collectedAt: { type: Date, default: Date.now },
    policyVersion: { type: String, trim: true, maxlength: 40 }
  },
  { _id: false, strict: "throw" }
);

const visitorSchema = new Schema(
  {
    workspaceId: { ...objectId, ref: "Workspace", required: true },
    websiteId: { ...objectId, ref: "Website", required: true },
    visitorId: { type: String, required: true, trim: true, minlength: 8, maxlength: 128 },
    displayName: { ...optionalText(120), default: null, set: sanitizePlainText },
    email: { type: String, lowercase: true, trim: true, maxlength: 254, default: null },
    phone: { ...optionalText(40), default: null },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    currentPageUrl: {
      ...optionalText(2048),
      default: null,
      validate: isHttpUrl
    },
    referrer: { ...optionalText(2048), default: null, validate: isHttpUrl },
    browser: { ...optionalText(120), default: null },
    operatingSystem: { ...optionalText(120), default: null },
    country: { type: String, trim: true, uppercase: true, match: /^[A-Z]{2}$/, default: null },
    consent: { type: consentSchema, default: () => ({}) },
    customAttributes: {
      type: Map,
      of: { type: String, maxlength: 500 },
      default: () => new Map(),
      validate: {
        validator: (attributes: Map<string, string>) =>
          attributes.size <= 50 &&
          [...attributes.keys()].every(
            (key) =>
              /^[a-zA-Z][\w.-]{0,79}$/.test(key) &&
              !/(password|token|secret|ssn|credit.?card)/i.test(key)
          ),
        message: "Custom attributes exceed the safe key or size policy"
      }
    }
  } as const,
  baseSchemaOptions
);
visitorSchema.index(
  { websiteId: 1, visitorId: 1 },
  { unique: true, name: "visitor_website_visitor_unique" }
);
visitorSchema.index({ workspaceId: 1, lastSeenAt: -1 }, { name: "visitor_workspace_recent" });

export const Visitor = model("Visitor", visitorSchema);
