import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";
import { isAllowedOrigin } from "./origins.js";
import { createOpaqueToken, hashOpaqueToken } from "../services/token-service.js";

describe("authentication primitives", () => {
  it("hashes passwords with Argon2id and verifies only the correct password", async () => {
    const hash = await hashPassword("a-long-and-unique-password");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hash, "a-long-and-unique-password")).resolves.toBe(true);
    await expect(verifyPassword(hash, "incorrect-password")).resolves.toBe(false);
  });

  it("creates opaque tokens whose persisted form is a one-way hash", () => {
    const { token, tokenHash } = createOpaqueToken();

    expect(token).not.toBe(tokenHash);
    expect(hashOpaqueToken(token)).toBe(tokenHash);
    expect(token).toHaveLength(43);
  });

  it("accepts only exact configured web origins", () => {
    expect(isAllowedOrigin("https://support.example.test", ["https://support.example.test"]))
      .toBe(true);
    expect(isAllowedOrigin("https://support.example.test.evil", ["https://support.example.test"]))
      .toBe(false);
    expect(isAllowedOrigin("https://support.example.test/path", ["https://support.example.test"]))
      .toBe(false);
  });
});
