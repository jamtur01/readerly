import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const router = Router();

const searchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(["relevance", "date"]).default("relevance"),
  // Advanced filters (optional)
  feedId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  tag: z.string().optional(),
  read: z.enum(["true", "false"]).optional(),
  starred: z.enum(["true", "false"]).optional(),
  shared: z.enum(["true", "false"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
});

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.flatten() });
  }
  const {
    q,
    page,
    pageSize,
    order,
    feedId,
    folderId,
    tag,
    read,
    starred,
    shared,
    archived,
  } = parsed.data;

  const skip = (page - 1) * pageSize;

  // Optional feed scoping via folder/tag
  let allowedFeedIds: string[] | null = null;
  if (folderId || tag) {
    const subWhere: any = { userId };
    if (folderId) subWhere.folderId = folderId;
    if (tag) subWhere.tags = { has: tag };
    const subs = await prisma.subscription.findMany({
      where: subWhere,
      select: { feedId: true },
    });
    const fids = subs.map((s: { feedId: string }) => s.feedId);
    if (fids.length === 0) {
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    allowedFeedIds = fids;
  }

  try {
    // Count total matches using PostgreSQL FTS
    const totalRes = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM "Item" i
      WHERE to_tsvector('english', COALESCE(i.title, '') || ' ' || COALESCE(i."contentText", ''))
            @@ plainto_tsquery('english', ${q})
    `;
    const total = totalRes[0]?.total ?? 0;

    // Select matching IDs ordered by rank or date
    let idRows: { id: string }[] = [];
    if (order === "relevance") {
      idRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT i.id
        FROM "Item" i
        WHERE to_tsvector('english', COALESCE(i.title, '') || ' ' || COALESCE(i."contentText", ''))
              @@ plainto_tsquery('english', ${q})
        ORDER BY ts_rank_cd(
                   to_tsvector('english', COALESCE(i.title, '') || ' ' || COALESCE(i."contentText", '')),
                   plainto_tsquery('english', ${q})
                 ) DESC,
                 i."publishedAt" DESC NULLS LAST
        OFFSET ${skip} LIMIT ${pageSize}
      `;
    } else {
      // order === "date"
      idRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT i.id
        FROM "Item" i
        WHERE to_tsvector('english', COALESCE(i.title, '') || ' ' || COALESCE(i."contentText", ''))
              @@ plainto_tsquery('english', ${q})
        ORDER BY i."publishedAt" DESC NULLS LAST
        OFFSET ${skip} LIMIT ${pageSize}
      `;
    }

    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) {
      return res.json({ total, page, pageSize, items: [] });
    }

    // Fetch full items and user-specific state
    const prismaItems = await prisma.item.findMany({
      where: { id: { in: ids } },
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
    });

    // Preserve search order
    const indexMap = new Map(ids.map((id, idx) => [id, idx]));
    prismaItems.sort(
      (a: any, b: any) => indexMap.get(a.id)! - indexMap.get(b.id)!
    );

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

    // Optional feed filters
    if (feedId) {
      items = items.filter((i: any) => i.feedId === feedId);
    } else if (allowedFeedIds) {
      const set = new Set(allowedFeedIds);
      items = items.filter((i: any) => set.has(i.feedId));
    }

    // Post-filter by state flags if provided (user-specific)
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

    return res.json({ total: items.length, page, pageSize, items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Search failed" });
  }
});

export default router;
