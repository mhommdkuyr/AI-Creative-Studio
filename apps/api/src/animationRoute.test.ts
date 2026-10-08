import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { registerAnimationRoute } from "./animationRoute.js";

const app = express();
app.use(express.json());
registerAnimationRoute(app);

const oldOpenAIKey = process.env.OPENAI_API_KEY;
const oldAnimationToken = process.env.ANIMATION_API_TOKEN;
const oldNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (oldOpenAIKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAIKey;
  if (oldAnimationToken === undefined) delete process.env.ANIMATION_API_TOKEN; else process.env.ANIMATION_API_TOKEN = oldAnimationToken;
  if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
});

describe("anime animation API", () => {
  it("returns a valid local animation plan without a provider key", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANIMATION_API_TOKEN;
    const response = await request(app).post("/api/animation/plan").send({ prompt: "أنمي قصير عن بطل يقفز عند الغروب" });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.provider).toBe("local");
    expect(response.body.plan.scenes.length).toBeGreaterThan(0);
    expect(response.body.plan.keyframes.length).toBeGreaterThanOrEqual(2);
    expect(response.body.plan.durationSeconds).toBeLessThanOrEqual(30);
  });

  it("rejects an empty prompt", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANIMATION_API_TOKEN;
    const response = await request(app).post("/api/animation/plan").send({ prompt: "   " });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("PROMPT_REQUIRED");
  });

  it("requires the configured bearer token", async () => {
    process.env.ANIMATION_API_TOKEN = "test-secret";
    const rejected = await request(app).post("/api/animation/plan").send({ prompt: "test" });
    expect(rejected.status).toBe(401);
    const accepted = await request(app).post("/api/animation/plan").set("Authorization", "Bearer test-secret").send({ prompt: "test" });
    expect(accepted.status).toBe(200);
  });
});
