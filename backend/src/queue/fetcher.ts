import { createHash } from "crypto";
import { RequestInit } from "undici";
import { XMLParser } from "fast-xml-parser";
import { prisma } from "../prisma";
import { env } from "../env";
import { createWorker, FetchJobData, enqueueFetch } from "./index";

type ParsedItem = {
  // Some feeds provide objects with attributes; use `text()` to normalize
  guid?: any;
  id?: any; // Atom <id>
  title?: string;
  link?: any; // Atom may provide array of links with @href/@rel
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  content?: string;
  "content:encoded"?: string;
};

type ParsedFeed =
  | {
      rss?: {
        channel?: {
          title?: string;
          item?: ParsedItem[] | ParsedItem;
        };
      };
    }
  | {
      feed?: {
        title?: string | { "#text": string };
        entry?: ParsedItem[] | ParsedItem;
        link?: any;
      };
    };

async function fetchWithHeaders(
  url: string,
  headers: Record<string, string>
): Promise<Response> {
  const init: RequestInit = {
    method: "GET",
    headers,
  };
  // eslint-disable-next-line no-undef
  return fetch(url, init as any) as unknown as Response;
}

function toArray<T>(val?: T | T[]): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function text(val: any): string | undefined {
  if (val == null) return undefined;
  const t = typeof val;
  if (t === "string") return val;
  if (t === "number" || t === "boolean") return String(val);
  if (t === "object") {
    // Try common XML-to-JSON shapes produced by fast-xml-parser and others
    const candidates = [
      (val as any)["#text"],
      (val as any)._,
      (val as any).value,
      (val as any).content,
      (val as any)["$t"],
      (val as any)["@_href"], // Atom/RSS link href
      (val as any).href,
      (val as any).url,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c;
    }
    // Do NOT coerce plain objects to "[object Object]"
    return undefined;
  }
  return undefined;
}

function pickContent(it: ParsedItem): {
  html?: string;
  text?: string;
  url?: string;
} {
  const html = it["content:encoded"] ?? it.content ?? it.description;
  return {
    html: html as string | undefined,
    text: html ? undefined : undefined, // can add text-only fallback later
    url: it.link,
  };
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  return d;
}

function hashGuidFallback(
  feedId: string,
  url?: string,
  title?: string,
  publishedAt?: Date
): string {
  const h = createHash("sha256");
  h.update(feedId);
  if (url) h.update(url);
  if (title) h.update(title);
  if (publishedAt) h.update(publishedAt.toISOString());
  return h.digest("hex");
}

/** Canonicalize URLs for stable GUIDs and storage */
function canonicalUrl(input?: string): string | undefined {
  if (!input) return undefined;
  try {
    const u = new URL(input);
    // Drop fragment and common tracking params
    u.hash = "";
    const dropParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "spm",
      "igshid",
      "mc_eid",
    ];
    for (const k of dropParams) u.searchParams.delete(k);
    // Remove empty search
    if ([...u.searchParams.keys()].length === 0) u.search = "";
    // Normalize AMP suffix
    if (u.pathname.endsWith("/amp")) {
      u.pathname = u.pathname.slice(0, -4) || "/";
    }
    // Trim trailing slash (but keep root "/")
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    // Not a valid URL, return as-is
    return input;
  }
}

async function processAtomOrRss(feedId: string, body: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: true,
    trimValues: true,
  });
  const obj = parser.parse(body) as ParsedFeed;

  let feedTitle: string | undefined;
  let items: ParsedItem[] = [];

  // RSS
  if ((obj as any).rss?.channel) {
    const ch = (obj as any).rss.channel;
    feedTitle = text(ch.title);
    items = toArray(ch.item);
  }

  // Atom
  if (!items.length && (obj as any).feed) {
    const f = (obj as any).feed;
    feedTitle = text(f.title);
    items = toArray(f.entry);
  }

  // Update feed title if absent or changed
  if (feedTitle) {
    await prisma.feed
      .update({ where: { id: feedId }, data: { title: feedTitle } })
      .catch(() => {});
  }

  if (!items.length) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;

  for (const raw of items) {
    // Normalize GUID/ID. Some parsers return objects when attributes exist.
    const guidRaw = text((raw as any).guid) ?? text((raw as any).id);
    // If GUID looks like a URL, canonicalize it (strip hash/query trackers)
    const guidUrlish =
      guidRaw && /^https?:\/\//i.test(guidRaw) ? canonicalUrl(guidRaw) : undefined;
    const guid =
      guidUrlish ?? (guidRaw && guidRaw !== "[object Object]" ? guidRaw : undefined);

    const title = text((raw as any).title);

    // Normalize URL from RSS/Atom. Atom <link> can be an array of objects.
    let url: string | undefined = undefined;
    const linkVal = (raw as any).link;
    if (Array.isArray(linkVal)) {
      // Prefer rel="alternate", else first href, else first item's text
      const alt = linkVal.find((l: any) => l?.["@_rel"] === "alternate");
      url =
        text(alt?.["@_href"]) ||
        text(linkVal[0]?.["@_href"]) ||
        text(linkVal[0]);
    } else {
      url = text(linkVal) || text((raw as any)["link"]?.["@_href"]);
    }
    // Canonicalize URL for stable storage/dedup
    url = canonicalUrl(url) ?? url;

    const pub =
      parseDate((raw as any).pubDate) ||
      parseDate((raw as any).published) ||
      parseDate((raw as any).updated);
    const { html, text: txt } = pickContent(raw);

    // Canonicalize URL again for safety
    const urlCanon = canonicalUrl(url) ?? url;

    // Try to find an existing row using any GUID variants for this item
    const candidates = Array.from(
      new Set(
        [
          guid,        // canonicalized GUID if URL-like
          guidRaw,     // raw guid/id from feed
          urlCanon,    // canonicalized URL
          url,         // original URL
        ].filter(Boolean) as string[]
      )
    );

    if (candidates.length) {
      const existing = await prisma.item.findFirst({
        where: { feedId, guid: { in: candidates } },
        select: { guid: true },
      });
      if (existing?.guid) {
        // Update metadata in case anything changed; do not create a duplicate row
        await prisma.item
          .updateMany({
            where: { feedId, guid: existing.guid },
            data: {
              url: urlCanon ?? url ?? undefined,
              title: title ?? undefined,
              contentHtml: html ?? undefined,
              contentText: txt ?? undefined,
              publishedAt: pub ?? undefined,
            },
          })
          .catch(() => {});
        skipped++;
        continue;
      }
    }

    // Choose a stable effective GUID: prefer canonical URL over raw GUIDs that may vary
    const effectiveGuid =
      (urlCanon as string | undefined) ??
      (guid as string | undefined) ??
      hashGuidFallback(feedId, urlCanon ?? url, title, pub);

    // Upsert without triggering unique violations; treat update as skipped
    const exists = await prisma.item.findUnique({
      where: { feedId_guid: { feedId, guid: effectiveGuid } },
      select: { id: true },
    });

    if (exists) {
      await prisma.item.update({
        where: { feedId_guid: { feedId, guid: effectiveGuid } },
        data: {
          title: title ?? undefined,
          url: urlCanon ?? url ?? undefined,
          contentHtml: html ?? undefined,
          contentText: txt ?? undefined,
          publishedAt: pub ?? undefined,
        },
      });
      skipped++;
    } else {
      await prisma.item.create({
        data: {
          feedId,
          guid: effectiveGuid,
          title: title ?? urlCanon ?? url ?? "Untitled",
          url: urlCanon ?? url,
          contentHtml: html,
          contentText: txt,
          publishedAt: pub,
        },
      });
      inserted++;
    }
  }

  return { inserted, skipped };
}

async function performFetch(feedId: string) {
  const feed = await prisma.feed.findUnique({ where: { id: feedId } });
  if (!feed) return;

  const headers: Record<string, string> = {
    "user-agent": `${env.APP_NAME ?? "Readerly"}/0.1 (+https://localhost)`,
    accept:
      "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
  };
  if (feed.etag) headers["if-none-match"] = feed.etag;
  if (feed.lastModified) headers["if-modified-since"] = feed.lastModified;

  const res = await fetchWithHeaders(feed.url, headers);
  const now = new Date();

  if (res.status === 304) {
    await prisma.feed.update({
      where: { id: feedId },
      data: { lastFetched: now, errorCount: 0, backoffUntil: null },
    });
    return { status: 304, inserted: 0, skipped: 0 };
  }

  if (!res.ok) {
    // Increment backoff on error (exponential with cap + jitter)
    const prev = (feed as any).errorCount ?? 0;
    const nextCount = Math.min(prev + 1, 10);
    const expMs = Math.pow(2, nextCount) * 60_000; // start at 1m, then 2m, 4m, ...
    const capMs = 6 * 60 * 60 * 1000; // cap at 6h
    const jitter = Math.floor(Math.random() * 30_000); // up to 30s jitter
    const backoffMs = Math.min(expMs, capMs) + jitter;
    const until = new Date(now.getTime() + backoffMs);

    await prisma.feed.update({
      where: { id: feedId },
      data: { lastFetched: now, errorCount: nextCount, backoffUntil: until },
    });
    return { status: res.status, inserted: 0, skipped: 0 };
  }

  const etag = res.headers.get("etag") ?? undefined;
  const lastMod = res.headers.get("last-modified") ?? undefined;
  const body = await res.text();

  const { inserted, skipped } = await processAtomOrRss(feedId, body);

  await prisma.feed.update({
    where: { id: feedId },
    data: {
      lastFetched: now,
      etag,
      lastModified: lastMod,
      errorCount: 0,
      backoffUntil: null,
    },
  });

  return { status: 200, inserted, skipped };
}

// Worker entrypoint
if (require.main === module) {
  // When run directly (worker:dev / worker:start), create the worker
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    console.log("Fetcher worker starting...");
    createWorker(async ({ feedId }: FetchJobData) => {
      const result = await performFetch(feedId);
      console.log("Fetched", feedId, result);
    });

    // Simple interval scheduler: enqueue due feeds based on fetchInterval (minutes)
    const TICK_MS = 60_000; // 1 min
    setInterval(async () => {
      try {
        const now = new Date();
        const feeds = await prisma.feed.findMany({
          // fetch all scalar fields to tolerate client cache differences
          take: 1000,
        });
        for (const f of feeds as Array<{
          id: string;
          lastFetched: Date | null;
          fetchInterval: number | null;
          backoffUntil: Date | null;
        }>) {
          // Respect backoff window if set
          if (
            f.backoffUntil &&
            new Date(f.backoffUntil).getTime() > now.getTime()
          ) {
            continue;
          }
          const intervalMs = Math.max(5, f.fetchInterval ?? 30) * 60_000;
          const due =
            !f.lastFetched ||
            now.getTime() - new Date(f.lastFetched).getTime() >= intervalMs;
          if (due) {
            await enqueueFetch(f.id, {
              removeOnComplete: 100,
              removeOnFail: 100,
            });
          }
        }
      } catch (e) {
        console.error("scheduler tick error", e);
      }
    }, TICK_MS);
  })();
}

export { performFetch };
