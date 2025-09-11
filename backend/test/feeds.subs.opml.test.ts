import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed, unique } from "./util";

describe("Feeds CRUD, Subscriptions CRUD, and OPML import/export", () => {
  it("performs Feeds CRUD with validations and fetch trigger", async () => {
    const { token } = await signupAndLogin();

    // Invalid create (URL)
    await request(app)
      .post("/feeds")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "not-a-url" })
      .expect(400);

    const url = `http://example.com/${unique("feed")}.xml`;

    // Create new feed
    const created = await request(app)
      .post("/feeds")
      .set("Authorization", `Bearer ${token}`)
      .send({ url, title: "My Feed", fetchInterval: 30 })
      .expect(201);

    const id = created.body.id as string;
    expect(id).toBeTruthy();
    expect(created.body.url).toBe(url);
    expect(created.body.title).toBe("My Feed");

    // Duplicate create returns existing (200)
    const dup = await request(app)
      .post("/feeds")
      .set("Authorization", `Bearer ${token}`)
      .send({ url, title: "Ignored", fetchInterval: 60 })
      .expect(200);
    expect(dup.body.id).toBe(id);

    // Get by id
    const got = await request(app)
      .get(`/feeds/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(got.body.id).toBe(id);
    expect(got.body.url).toBe(url);

    // Patch title and fetchInterval
    const updated = await request(app)
      .patch(`/feeds/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updated Title", fetchInterval: 45 })
      .expect(200);
    expect(updated.body.title).toBe("Updated Title");
    expect(updated.body.fetchInterval).toBe(45);

    // Enqueue fetch
    const enq = await request(app)
      .post(`/feeds/${id}/fetch`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(enq.body).toHaveProperty("ok", true);

    // Delete
    await request(app)
      .delete(`/feeds/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    // Subsequent get is 404
    await request(app)
      .get(`/feeds/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("performs Subscriptions CRUD with duplicate protection and list details", async () => {
    const { token } = await signupAndLogin();
    const feedId = await createFeed(token);

    // Create subscription
    const sub = await request(app)
      .post("/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({ feedId })
      .expect(201);
    const subId = sub.body.id as string;
    expect(subId).toBeTruthy();

    // Duplicate -> 409
    await request(app)
      .post("/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({ feedId })
      .expect(409);

    // List includes subscription with unreadCount
    const list1 = await request(app)
      .get("/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(list1.body.subscriptions)).toBe(true);
    const found = list1.body.subscriptions.find((s: any) => s.id === subId);
    expect(found).toBeTruthy();
    expect(typeof found.unreadCount).toBe("number");

    // Patch tags and sortOrder (no folder change)
    const updated = await request(app)
      .patch(`/subscriptions/${subId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tags: ["tech", "news"], sortOrder: 5 })
      .expect(200);
    expect(updated.body.tags).toEqual(["tech", "news"]);
    expect(updated.body.sortOrder).toBe(5);

    // Delete subscription
    await request(app)
      .delete(`/subscriptions/${subId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    // List again: not present
    const list2 = await request(app)
      .get("/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const found2 = list2.body.subscriptions.find((s: any) => s.id === subId);
    expect(found2).toBeFalsy();
  });

  it("imports subscriptions from OPML and exports OPML containing them", async () => {
    const { token } = await signupAndLogin();

    const url1 = `http://example.com/${unique("opml1")}.xml`;
    const url2 = `http://example.com/${unique("opml2")}.xml`;

    // Minimal OPML with two feeds, one inside a folder, one outside
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Sample Subs</title>
  </head>
  <body>
    <outline text="My Folder" title="My Folder">
      <outline type="rss" text="Feed One" title="Feed One" xmlUrl="${url1}" />
    </outline>
    <outline type="rss" text="Feed Two" title="Feed Two" xmlUrl="${url2}" />
  </body>
</opml>`.trim();

    const imp = await request(app)
      .post("/opml/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ opml })
      .expect(200);

    expect(imp.body).toHaveProperty("ok", true);
    expect(typeof imp.body.createdFeeds).toBe("number");
    expect(typeof imp.body.subscribed).toBe("number");
    expect(imp.body.subscribed).toBeGreaterThanOrEqual(1);

    // Export should include both URLs
    const exp = await request(app)
      .get("/opml/export")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const xml = exp.text as string;
    // Accept optional XML declaration (fast-xml-parser may omit it)
    expect(xml).toMatch(/^(?:\s*<\?xml[^>]*\?>)?\s*<opml/);
    expect(xml).toContain(url1);
    expect(xml).toContain(url2);
  });
});