import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed, devCreateItem, unique } from "./util";

describe("Search pagination and ordering (/search)", () => {
  it("orders by date and paginates correctly", async () => {
    const { token } = await signupAndLogin();
    const feedId = await createFeed(token);

    const term = `q${unique("t").replace(/[^a-z0-9]/gi, "")}`; // safe token for tsquery

    // Create items with deterministic times
    const t1 = new Date(Date.now() - 3 * 60 * 1000); // oldest
    const t2 = new Date(Date.now() - 2 * 60 * 1000);
    const t3 = new Date(Date.now() - 1 * 60 * 1000); // newest

    const a = await devCreateItem(token, { feedId, title: `Alpha ${term}`, contentText: "one", publishedAt: t1.toISOString() });
    if (a.status === 404) return; // dev-create disabled in prod; skip gracefully
    const aId = a.body.id as string;

    const b = await devCreateItem(token, { feedId, title: `Beta ${term}`, contentText: "two", publishedAt: t2.toISOString() });
    const bId = b.body.id as string;

    const c = await devCreateItem(token, { feedId, title: `Gamma ${term}`, contentText: "three", publishedAt: t3.toISOString() });
    const cId = c.body.id as string;

    // order=date -> newest first (c, b, a) with pagination
    const s1 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}&order=date&pageSize=2&page=1`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const ids1 = s1.body.items.map((i: any) => i.id);
    expect(ids1).toEqual([cId, bId]);

    const s2 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}&order=date&pageSize=2&page=2`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const ids2 = s2.body.items.map((i: any) => i.id);
    expect(ids2).toEqual([aId]);

    // relevance also preserves secondary sort by publishedAt DESC; should contain all 3 across pages
    const r1 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}&order=relevance&pageSize=2&page=1`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const r2 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}&order=relevance&pageSize=2&page=2`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const allIds = [...r1.body.items, ...r2.body.items].map((i: any) => i.id);
    expect(new Set(allIds)).toEqual(new Set([aId, bId, cId]));
  });
});