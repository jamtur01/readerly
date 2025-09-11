import "dotenv/config";
import { prisma } from "../prisma";
import { randomUUID } from "crypto";

async function main() {
  console.log("Seeding dev data...");

  const email = "seeduser@example.com";
  const username = "seeduser";

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      username,
      email,
      passwordHash: "dev-seeded", // not used for auth flow in seed
      offlineLimit: 500,
      prefs: {},
    },
    select: { id: true, username: true, email: true },
  });
  console.log("User:", user);

  const folder = await prisma.folder.upsert({
    where: { userId_name: { userId: user.id, name: "Tech" } },
    update: {},
    create: { userId: user.id, name: "Tech" },
    select: { id: true, name: true },
  });
  console.log("Folder:", folder);

  // Create a feed
  const feedUrl = "https://hnrss.org/frontpage";
  const feed = await prisma.feed.upsert({
    where: { url: feedUrl },
    update: {},
    create: {
      url: feedUrl,
      title: "Hacker News (HN) Frontpage",
      fetchInterval: 30,
    },
    select: { id: true, url: true, title: true },
  });
  console.log("Feed:", feed);

  // Subscribe user to the feed
  const sub = await prisma.subscription.upsert({
    where: { userId_feedId: { userId: user.id, feedId: feed.id } },
    update: {},
    create: {
      userId: user.id,
      feedId: feed.id,
      folderId: folder.id,
      tags: ["news", "tech"],
      sortOrder: 0,
    },
    select: { id: true, userId: true, feedId: true },
  });
  console.log("Subscription:", sub);

  // Create a couple of items if none exist
  const existingCount = await prisma.item.count({ where: { feedId: feed.id } });
  if (existingCount === 0) {
    const now = new Date();
    const items = await prisma.$transaction([
      prisma.item.create({
        data: {
          feedId: feed.id,
          guid: randomUUID(),
          title: "Welcome to Readerly seed item",
          url: "https://example.com/readerly-seed-1",
          contentText: "This is a seeded item for local development.",
          publishedAt: now,
        },
      }),
      prisma.item.create({
        data: {
          feedId: feed.id,
          guid: randomUUID(),
          title: "Another seeded item",
          url: "https://example.com/readerly-seed-2",
          contentText: "Second seeded item content.",
          publishedAt: new Date(now.getTime() - 1000 * 60 * 60),
        },
      }),
    ]);
    console.log(
      "Seeded items:",
      items.map((i: { id: string }) => i.id)
    );
  } else {
    console.log("Items already exist for this feed, skipping item seeding");
  }

  console.log("Seeding completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
