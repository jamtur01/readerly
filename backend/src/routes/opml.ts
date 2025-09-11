import { Router } from "express";
import { z } from "zod";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const router = Router();

// Import OPML (body.opml: string)
// Supports basic OPML with outlines having xmlUrl and optional title/text and category (folder)
const importSchema = z.object({
  opml: z.string().min(10),
});

router.post("/import", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { opml } = parsed.data;

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: true,
      trimValues: true,
    });
    const doc: any = parser.parse(opml);

    // OPML structures vary; try to flatten all outlines
    const outlines: any[] = [];

    function walk(node: any, folderName?: string) {
      if (!node) return;
      const children = Array.isArray(node) ? node : [node];
      for (const c of children) {
        if (!c) continue;
        const hasXmlUrl = c["@_xmlUrl"] || c["@_xmlurl"] || c["@_xmlURL"];
        const text = c["@_text"] || c["@_title"] || c["@_TEXT"];
        const title = typeof text === "string" ? text : undefined;

        if (hasXmlUrl) {
          outlines.push({
            xmlUrl: String(hasXmlUrl),
            title,
            folder: folderName,
          });
        }

        // recurse into child outlines
        if (c.outline) {
          const childFolder = hasXmlUrl ? folderName : title || folderName;
          walk(c.outline, childFolder);
        }
      }
    }

    const bodyOutlines =
      doc?.opml?.body?.outline ?? doc?.body?.outline ?? doc?.outline ?? [];

    walk(bodyOutlines);

    let created = 0;
    let subscribed = 0;

    for (const o of outlines) {
      const url = o.xmlUrl as string;
      if (!/^https?:\/\//i.test(url)) continue;

      // Ensure Feed exists
      const feed = await prisma.feed.upsert({
        where: { url },
        create: { url, title: o.title ?? url, fetchInterval: 30 },
        update: {},
      });
      if (feed.createdAt.getTime() === feed.updatedAt.getTime()) {
        created++;
      }

      // Optional folder
      let folderId: string | null = null;
      if (o.folder && typeof o.folder === "string") {
        const folder = await prisma.folder.upsert({
          where: { userId_name: { userId, name: o.folder } },
          create: { userId, name: o.folder },
          update: {},
        });
        folderId = folder.id;
      }

      // Subscribe (unique per user/feed)
      await prisma.subscription
        .create({
          data: {
            userId,
            feedId: feed.id,
            folderId,
            tags: [],
            sortOrder: 0,
          },
        })
        .then(() => {
          subscribed++;
        })
        .catch((e: any) => {
          // Ignore unique violation (already subscribed)
          if (e.code !== "P2002") {
            throw e;
          }
        });
    }

    return res.json({ ok: true, createdFeeds: created, subscribed });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: "Failed to import OPML" });
  }
});

// Export OPML for current user
router.get("/export", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const subs = await prisma.subscription.findMany({
      where: { userId },
      include: {
        feed: true,
        folder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    // Group by folder
    const groups = new Map<string, typeof subs>();
    for (const s of subs) {
      const key = s.folder?.name ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
      suppressEmptyNode: true,
    });

    const outlines: any[] = [];
    // Unfoldered feeds
    const noFolder = groups.get("") ?? [];
    for (const s of noFolder) {
      outlines.push({
        outline: {
          "@_type": "rss",
          "@_text": s.feed.title || s.feed.url,
          "@_title": s.feed.title || s.feed.url,
          "@_xmlUrl": s.feed.url,
        },
      });
    }
    // Foldered feeds
    for (const [folderName, list] of groups.entries()) {
      if (!folderName) continue;
      outlines.push({
        outline: {
          "@_text": folderName,
          "@_title": folderName,
          outline: list.map(
            (s: { feed: { title: string | null; url: string } }) => ({
              "@_type": "rss",
              "@_text": s.feed.title || s.feed.url,
              "@_title": s.feed.title || s.feed.url,
              "@_xmlUrl": s.feed.url,
            })
          ),
        },
      });
    }

    const opmlObj = {
      opml: {
        "@_version": "2.0",
        head: {
          title: "Readerly Subscriptions",
        },
        body: outlines.map((o) => o.outline),
      },
    };

    const xml = builder.build(opmlObj);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="subscriptions.opml"'
    );
    return res.send(xml);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to export OPML" });
  }
});

export default router;
