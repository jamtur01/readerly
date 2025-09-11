import { describe, it, expect } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { router as authRouter } from "../src/routes/auth";

function buildLimitedAuthApp(max: number) {
  const app = express();
  app.use(express.json());
  const limiter = rateLimit({
    windowMs: 1_000, // 1s window for the test
    max,
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.use("/auth", limiter, authRouter);
  return app;
}

describe("Auth rate limiting (isolated app with small limits)", () => {
  it("returns 429 after exceeding the configured limit within window", async () => {
    // Configure a small limit and then burst requests until we see 429.
    // Some versions/stores increment at slightly different times, so assert that
    // at least one login within a burst is rate-limited.
    const app = buildLimitedAuthApp(4);

    const email = `user-${Date.now()}@example.com`;
    const password = "P@ssw0rd!";
    const username = `user-${Math.random().toString(36).slice(2, 8)}`;

    // Signup consumes 1 request
    await request(app)
      .post("/auth/signup")
      .send({ username, email, password })
      .expect(201);

    // Perform a burst of additional login attempts to exceed the limit
    let got429 = false;
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post("/auth/login").send({ email, password });
      if (r.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});