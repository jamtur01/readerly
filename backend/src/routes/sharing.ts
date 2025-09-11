import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const router = Router();

// Body schema for toggling share
const shareBodySchema = z.object({
  share: z.boolean(),
  note: z.string().max(1000).nullable().optional(),
});

// Toggle share for an item
// POST /sharing/items/:id/share { share: boolean, note?: string }
router.post("/items/:id/share", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id: itemId } = req.params;
  const parsed = shareBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { share, note } = parsed.data;

  try {
    // Ensure item exists
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!item) return res.status(404).json({ error: "Item not found" });

    if (share) {
      // Upsert SharedItem and mark ItemState.shared = true
      await prisma.$transaction([
        prisma.sharedItem.upsert({
          where: { userId_itemId: { userId, itemId } },
          update: { note: note ?? null },
          create: { userId, itemId, note: note ?? null },
        }),
        prisma.itemState.upsert({
          where: { userId_itemId: { userId, itemId } },
          update: { shared: true, sharedAt: new Date() },
          create: { userId, itemId, shared: true, sharedAt: new Date() },
        }),
      ]);
      return res.json({ ok: true, shared: true });
    } else {
      // Delete SharedItem (if present) and clear ItemState.shared
      // Use deleteMany to avoid Promise<...> from .catch() which breaks PrismaPromise[] typing
      await prisma.$transaction([
        prisma.sharedItem.deleteMany({ where: { userId, itemId } }),
        prisma.itemState.upsert({
          where: { userId_itemId: { userId, itemId } },
          update: { shared: false, sharedAt: null },
          create: { userId, itemId, shared: false, sharedAt: null },
        }),
      ]);
      return res.json({ ok: true, shared: false });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to toggle share" });
  }
});

// Get current user's shared items (private management view)
// GET /sharing/me
router.get("/me", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const rows = await prisma.sharedItem.findMany({
      where: { userId },
      orderBy: { sharedAt: "desc" },
      take: 100,
      include: {
        item: {
          select: {
            id: true,
            feedId: true,
            title: true,
            url: true,
            contentHtml: true,
            contentText: true,
            imageUrl: true,
            publishedAt: true,
          },
        },
      },
    });

    const items = rows.map((r: any) => ({
      id: r.item.id,
      feedId: r.item.feedId,
      title: r.item.title,
      url: r.item.url,
      contentHtml: r.item.contentHtml,
      contentText: r.item.contentText,
      imageUrl: r.item.imageUrl,
      publishedAt: r.item.publishedAt,
      sharedAt: r.sharedAt,
      note: r.note,
    }));

    return res.json({ items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load shared items" });
  }
});

// Public RSS feed for a user's shared items
// GET /sharing/:username/rss
router.get("/:username/rss", async (req, res) => {
  const { username } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true },
    });
    if (!user) return res.status(404).send("Not found");

    const shares = await prisma.sharedItem.findMany({
      where: { userId: user.id },
      orderBy: { sharedAt: "desc" },
      take: 50,
      include: {
        item: {
          select: {
            id: true,
            title: true,
            url: true,
            contentHtml: true,
            contentText: true,
            publishedAt: true,
          },
        },
      },
    });

    const channelTitle = `${user.username}'s shared items - Readerly`;
    const channelLink =
      req.protocol + "://" + req.get("host") + req.originalUrl;
    const rssItems = shares
      .map((s: any) => {
        const it = s.item;
        const title = escapeXml(it.title || "(no title)");
        const link = escapeXml(it.url || channelLink);
        const pub = (s.sharedAt || it.publishedAt || new Date()).toUTCString();
        const desc =
          it.contentHtml ??
          (it.contentText ? `<pre>${escapeXml(it.contentText)}</pre>` : "");
        return `
      <item>
        <title>${title}</title>
        <link>${link}</link>
        <guid isPermaLink="false">${escapeXml(it.id)}</guid>
        <pubDate>${pub}</pubDate>
        <description><![CDATA[${desc || ""}]]></description>
      </item>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeXml(channelTitle)}</title>
  <link>${escapeXml(channelLink)}</link>
  <description>${escapeXml(channelTitle)}</description>
  ${rssItems}
</channel>
</rss>`.trim();

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    return res.send(xml);
  } catch (e) {
    console.error(e);
    return res.status(500).send("RSS generation failed");
  }
});

export function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default router;
