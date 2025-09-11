import { Router, Request, Response } from "express";
import { prisma } from "../prisma";
import IORedis from "ioredis";
import { env } from "../env";

export const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redis = new IORedis(env.REDIS_URL);
    await redis.ping();
    await redis.quit();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});