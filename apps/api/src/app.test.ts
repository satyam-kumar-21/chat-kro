import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { disconnectFromDatabase } from "./db/mongoose.js";

describe("health endpoints", () => {
  afterEach(async () => {
    await disconnectFromDatabase();
  });

  it("reports process liveness without requiring MongoDB", async () => {
    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("reports that the service is not ready when MongoDB is disconnected", async () => {
    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "not_ready",
      dependencies: { mongodb: "disconnected" }
    });
  });
});
