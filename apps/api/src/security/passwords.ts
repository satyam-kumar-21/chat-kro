import argon2 from "argon2";
import { registrationSchema } from "@live-chat/shared";
import { AppError } from "../errors/app-error.js";

export async function hashPassword(password: string): Promise<string> {
  const validated = registrationSchema.shape.password.safeParse(password);
  if (!validated.success) {
    throw new AppError("Password does not meet the required policy", 400, "INVALID_PASSWORD");
  }
  return argon2.hash(validated.data, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
