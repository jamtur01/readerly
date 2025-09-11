import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed, devCreateItem } from "./util";

describe("Items pagination and ordering integrity (/items)", () => {
  it("orders by publishedAt asc/desc and paginates correctly", async () => {
    const { token } = await signupAndLogin();
    const feedId = await createFeed(token);

    // Create three items with deterministic publishedAt times
    const t1 = new Date(Date.now() - 3 * 60 * 1000); // oldest
    const t2 = new Date(Date.now() - 2 * 60 * 1000);
    const t3 = new Date(Date.now() - 1 * 60 * 1000); // newest

    const a = await devCreateItem(token, { feedId, title: "Alpha", contentText: "one", publishedAt: t1.toISOString() });
    if (a.status === 404) return; // dev-create disabled in prod; skip test
    const aId = a.body.id as string;

    const b = await devCreateItem(token, { feedId, title: "Beta", contentText: "two", publishedAt: t2.toISOString() });
    const bId = b.body.id as string;

    const c = await devCreateItem(token, { feedId, title: "Gamma", contentText: "three", publishedAt: t3.toISOString() });
    const cId = c.body.id as string;

    // Default order=desc -> newest first: c, b, a
    const desc = await request(app)
      .get(`/items?feedId=${feedId}&pageSize=50`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const descIds = desc.body.items.map((i: any) => i.id);
    expect(descIds.slice(0, 3)).toEqual([cId, bId, aId]);

    // order=asc -> oldest first: a, b, c
    const asc = await request(app)
      .get(`/items?feedId=${feedId}&order=asc&pageSize=50`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const ascIds = asc.body.items.map((i: any) => i.id);
    expect(ascIds.slice(0, 3)).toEqual([aId, bId, cId]);

    // Pagination: pageSize=2 => page 1 has [c,b], page 2 has [a]
    const page1 = await request(app)
      .get(`/items?feedId=${feedId}&pageSize=2&page=1`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(page1.body.items.map((i: any) => i.id)).toEqual([cId, bId]);

    const page2 = await request(app)
      .get(`/items?feedId=${feedId}&pageSize=2&page=2`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(page2.body.items.map((i: any) => i.id)).toEqual([aId]);
  });
});