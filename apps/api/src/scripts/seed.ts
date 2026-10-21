import { z } from "zod";
import { env } from "../config/env.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { User, Website, Workspace } from "../models/index.js";
import { hashPassword } from "../security/passwords.js";
import { createWebsite } from "../services/website-service.js";
import { createWorkspace } from "../services/workspace-service.js";
import { logger } from "../lib/logger.js";

const seedSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
});

async function seed(): Promise<void> {
  const credentials = seedSchema.safeParse({
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD
  });
  if (!credentials.success) {
    throw new Error("Set valid SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD values before seeding");
  }

  await connectToDatabase();
  const email = credentials.data.email.toLowerCase();
  let user = await User.findOne({ email }).select("+passwordHash");
  if (!user) {
    user = await User.create({
      name: "Local workspace owner",
      email,
      passwordHash: await hashPassword(credentials.data.password),
      emailVerifiedAt: new Date(),
      accountStatus: "active"
    });
  } else if (user.accountStatus !== "active") {
    user.accountStatus = "active";
    user.emailVerifiedAt = new Date();
    await user.save();
  }

  const actor = { userId: user._id.toString() };
  const workspace =
    (await Workspace.findOne({ ownerUserId: user._id, slug: "local-demo" })) ??
    (await createWorkspace(actor, { name: "Local Demo" }));
  const websiteExists = await Website.exists({
    workspaceId: workspace._id,
    name: "Local Demo Website"
  });
  if (!websiteExists) {
    await createWebsite(actor, workspace._id.toString(), {
      name: "Local Demo Website",
      domain: "localhost",
      allowedOrigins: ["http://localhost:3000"]
    });
  }
  logger.info({ workspaceId: workspace._id.toString() }, "Local seed data created");
}

seed()
  .catch((error: unknown) => {
    logger.error({ err: error }, "Local seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFromDatabase();
  });
