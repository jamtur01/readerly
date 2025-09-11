import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { env } from "../env";

export const router = Router();

// Query schema for listing items
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  feedId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  tag: z.string().optional(),
  read: z.enum(["true", "false"]).optional(),
  starred: z.enum(["true", "false"]).optional(),
  shared: z.enum(["true", "false"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  q: z.string().max(200).optional(), // simple text filter (title/contentText)
  order: z.enum(["desc", "asc"]).default("desc"),
});

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.flatten() });
  }
  const {
    page,
    pageSize,
    feedId,
    folderId,
    tag,
    read,
    starred,
    shared,
    archived,
    dateFrom,
    dateTo,
    q,
    order,
  } = parsed.data;

  try {
    // Base item filters
    const whereItem: any = {};
    if (feedId) whereItem.feedId = feedId;
    if (dateFrom || dateTo) {
      whereItem.publishedAt = {};
      if (dateFrom) whereItem.publishedAt.gte = dateFrom;
      if (dateTo) whereItem.publishedAt.lte = dateTo;
    }
    if (q) {
      // naive text filter until FTS: check title/contentText ILIKE
      whereItem.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { contentText: { contains: q, mode: "insensitive" } },
      ];
    }

    // Filter by folderId or tag via user's subscriptions
    if (folderId || tag) {
      // find feedIds the user is subscribed to that match folder/tag
      const subWhere: any = { userId };
      if (folderId) subWhere.folderId = folderId;
      if (tag) subWhere.tags = { has: tag };
      const subs = await prisma.subscription.findMany({
        where: subWhere,
        select: { feedId: true },
      });
      const feedIds = subs.map((s: { feedId: string }) => s.feedId);
      // if no matching subs, return empty result quickly
      if (feedIds.length === 0) {
        return res.json({ total: 0, page, pageSize, items: [] });
      }
      whereItem.feedId = feedId ? feedId : { in: feedIds };
    }

    // Pagination
    const skip = (page - 1) * pageSize;
    const [total, prismaItems] = await Promise.all([
      prisma.item.count({ where: whereItem }),
      prisma.item.findMany({
        where: whereItem,
        orderBy: { publishedAt: order as "asc" | "desc" },
        skip,
        take: pageSize,
        include: {
          states: {
            where: { userId },
            select: {
              read: true,
              starred: true,
              shared: true,
              archived: true,
              readAt: true,
              starredAt: true,
              sharedAt: true,
              archivedAt: true,
              userId: true,
              itemId: true,
            },
          },
        },
      }),
    ]);

    let items = prismaItems.map((it: any) => {
      const st = it.states[0];
      return {
        id: it.id,
        feedId: it.feedId,
        guid: it.guid,
        title: it.title,
        url: it.url,
        contentHtml: it.contentHtml,
        contentText: it.contentText,
        imageUrl: it.imageUrl,
        publishedAt: it.publishedAt,
        fetchedAt: it.fetchedAt,
        state: st
          ? {
              read: st.read,
              starred: st.starred,
              shared: st.shared,
              archived: st.archived,
              readAt: st.readAt,
              starredAt: st.starredAt,
              sharedAt: st.sharedAt,
              archivedAt: st.archivedAt,
            }
          : { read: false, starred: false, shared: false, archived: false },
      };
    });

    // Post-filter by state flags if provided (since states are user-specific)
    function flag(val?: "true" | "false") {
      return val === "true" ? true : val === "false" ? false : undefined;
    }
    const fRead = flag(read),
      fStar = flag(starred),
      fShare = flag(shared),
      fArch = flag(archived);
    if (fRead !== undefined)
      items = items.filter((i: any) => i.state.read === fRead);
    if (fStar !== undefined)
      items = items.filter((i: any) => i.state.starred === fStar);
    if (fShare !== undefined)
      items = items.filter((i: any) => i.state.shared === fShare);
    if (fArch !== undefined)
      items = items.filter((i: any) => i.state.archived === fArch);

    return res.json({ total, page, pageSize, items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list items" });
  }
});

// Upsert item state (read/starred/shared/archived)
const stateBodySchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  shared: z.boolean().optional(),
  archived: z.boolean().optional(),
});

router.post("/:id/state", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id: itemId } = req.params;
  const parsed = stateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { read, starred, shared, archived } = parsed.data;

  try {
    // Ensure item exists
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!item) return res.status(404).json({ error: "Item not found" });

    const now = new Date();
    const data: any = {};
    if (read !== undefined) {
      data.read = read;
      data.readAt = read ? now : null;
    }
    if (starred !== undefined) {
      data.starred = starred;
      data.starredAt = starred ? now : null;
    }
    if (shared !== undefined) {
      data.shared = shared;
      data.sharedAt = shared ? now : null;
    }
    if (archived !== undefined) {
      data.archived = archived;
      data.archivedAt = archived ? now : null;
    }

    const up = await prisma.itemState.upsert({
      where: { userId_itemId: { userId, itemId } },
      update: data,
      create: { userId, itemId, ...data },
    });

    return res.json({ ok: true, state: up });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to update item state" });
  }
});

// Bulk mark read
const bulkMarkSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
  feedId: z.string().uuid().optional(),
  olderThan: z.coerce.date().optional(), // mark items older than this date as read (can combine with feedId)
});

router.post("/mark-read-bulk", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = bulkMarkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { itemIds, feedId, olderThan } = parsed.data;

  try {
    let where: any = {};
    if (itemIds?.length) {
      where.id = { in: itemIds };
    } else {
      if (feedId) where.feedId = feedId;
      if (olderThan) where.publishedAt = { lte: olderThan };
    }

    // Find items to mark read
    const ids = (
      await prisma.item.findMany({ where, select: { id: true }, take: 5000 })
    ).map((i: { id: string }) => i.id);

    // Upsert states in batches
    const now = new Date();
    const BATCH = 500;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      await prisma.$transaction(
        chunk.map((itemId: string) =>
          prisma.itemState.upsert({
            where: { userId_itemId: { userId, itemId } },
            update: { read: true, readAt: now },
            create: { userId, itemId, read: true, readAt: now },
          })
        )
      );
    }

    return res.json({ ok: true, count: ids.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to bulk mark read" });
  }
});

// Dev-only: create a test item for a feed to help during development before fetcher exists
const devCreateSchema = z.object({
  feedId: z.string().uuid(),
  title: z.string().min(1),
  url: z.string().url().optional(),
  contentText: z.string().optional(),
  publishedAt: z.coerce.date().optional(),
});

router.post("/dev-create", requireAuth, async (req, res) => {
  if (env.NODE_ENV === "production") return res.status(404).end();
  const parsed = devCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { feedId, title, url, contentText, publishedAt } = parsed.data;
  try {
    const feed = await prisma.feed.findUnique({ where: { id: feedId } });
    if (!feed) return res.status(404).json({ error: "Feed not found" });

    const item = await prisma.item.create({
      data: {
        feedId,
        title,
        url,
        contentText,
        publishedAt: publishedAt ?? new Date(),
      },
    });

    return res.status(201).json(item);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to create dev item" });
  }
});

export default router;
