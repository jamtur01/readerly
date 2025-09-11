import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const router = Router();

const createSubSchema = z.object({
  feedId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1)).max(20).optional().default([]),
  sortOrder: z.number().int().optional(),
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = createSubSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const userId = (req as any).userId as string;
  const { feedId, folderId, tags, sortOrder } = parsed.data;

  try {
    // Ensure feed exists
    const feed = await prisma.feed.findUnique({ where: { id: feedId } });
    if (!feed) return res.status(404).json({ error: "Feed not found" });

    // Optional: ensure folder belongs to user if provided
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, userId },
      });
      if (!folder) return res.status(400).json({ error: "Invalid folderId" });
    }

    const sub = await prisma.subscription.create({
      data: {
        userId,
        feedId,
        folderId: folderId ?? null,
        tags,
        sortOrder: sortOrder ?? 0,
      },
    });

    return res.status(201).json(sub);
  } catch (e: any) {
    if (e.code === "P2002")
      return res.status(409).json({ error: "Already subscribed" });
    console.error(e);
    return res.status(500).json({ error: "Failed to create subscription" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const subs = await prisma.subscription.findMany({
      where: { userId },
      include: {
        feed: { select: { id: true, url: true, title: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    // Compute unread counts per feed for this user using Prisma client (no raw SQL)
    const feedIds: string[] = subs.map((s: { feedId: string }) => s.feedId);

    // Total items per feed
    const totals =
      feedIds.length > 0
        ? await prisma.item.groupBy({
            by: ["feedId"],
            where: { feedId: { in: feedIds } },
            _count: { _all: true },
          })
        : [];

    const totalMap = new Map<string, number>();
    for (const t of totals as any[]) {
      totalMap.set(t.feedId, Number(t._count._all ?? 0));
    }

    // Read items per feed for this user (count ItemState.read=true grouped by item's feed)
    const reads =
      feedIds.length > 0
        ? await prisma.itemState.findMany({
            where: {
              userId,
              read: true,
              item: { feedId: { in: feedIds } },
            },
            select: { item: { select: { feedId: true } } },
          })
        : [];

    const readMap = new Map<string, number>();
    for (const r of reads as any[]) {
      const fid = r.item.feedId as string;
      readMap.set(fid, (readMap.get(fid) ?? 0) + 1);
    }

    const withCounts = subs.map((s: typeof subs[number]) => {
      const total = totalMap.get(s.feedId) ?? 0;
      const read = readMap.get(s.feedId) ?? 0;
      const unread = Math.max(0, total - read);
      return { ...s, unreadCount: unread };
    });

    return res.json({ subscriptions: withCounts });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

const updateSubSchema = z.object({
  folderId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  sortOrder: z.number().int().optional(),
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const parsed = updateSubSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { folderId, tags, sortOrder } = parsed.data;

  try {
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, userId },
      });
      if (!folder) return res.status(400).json({ error: "Invalid folderId" });
    }

    const sub = await prisma.subscription.update({
      where: { id },
      data: {
        folderId: folderId !== undefined ? folderId : undefined,
        tags,
        sortOrder,
      },
    });
    return res.json(sub);
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "Not found" });
    console.error(e);
    return res.status(500).json({ error: "Failed to update subscription" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.subscription.delete({ where: { id } });
    return res.status(204).end();
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "Not found" });
    console.error(e);
    return res.status(500).json({ error: "Failed to delete subscription" });
  }
});

export default router;
