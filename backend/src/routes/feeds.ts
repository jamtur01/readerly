import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { enqueueFetch } from "../queue";

export const router = Router();

// Create or return existing feed by exact URL
const createFeedSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(256).optional(),
  fetchInterval: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(), // minutes
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = createFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { url, title, fetchInterval } = parsed.data;
  try {
    const existing = await prisma.feed.findUnique({ where: { url } });
    if (existing) return res.status(200).json(existing);

    const feed = await prisma.feed.create({
      data: { url, title: title ?? url, fetchInterval: fetchInterval ?? 30 },
    });
    return res.status(201).json(feed);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to create feed" });
  }
});

// List feeds (admin-ish; for now allow authed users to browse)
router.get("/", requireAuth, async (_req, res) => {
  try {
    const feeds = await prisma.feed.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ feeds });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list feeds" });
  }
});

// Get feed by id
router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const feed = await prisma.feed.findUnique({ where: { id } });
    if (!feed) return res.status(404).json({ error: "Not found" });
    return res.json(feed);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load feed" });
  }
});

// Update feed (title, fetchInterval)
const updateFeedSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  fetchInterval: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
});
router.patch("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const parsed = updateFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const feed = await prisma.feed.update({ where: { id }, data: parsed.data });
    return res.json(feed);
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "Not found" });
    console.error(e);
    return res.status(500).json({ error: "Failed to update feed" });
  }
});

// Trigger fetch for a feed (enqueue a job)
router.post("/:id/fetch", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const feed = await prisma.feed.findUnique({ where: { id } });
    if (!feed) return res.status(404).json({ error: "Not found" });
    await enqueueFetch(id, { removeOnComplete: 50, removeOnFail: 50 });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to enqueue fetch" });
  }
});

// Delete feed
router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.feed.delete({ where: { id } });
    return res.status(204).end();
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "Not found" });
    console.error(e);
    return res.status(500).json({ error: "Failed to delete feed" });
  }
});

export default router;
