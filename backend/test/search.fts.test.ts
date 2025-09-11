import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed, devCreateItem, unique } from "./util";

describe("FTS /search with advanced filters", () => {
  it("finds items by term and respects starred filter flags", async () => {
    const { token } = await signupAndLogin();
    const feedId = await createFeed(token);

    const term = `gizmo-${unique("t")}`;
    const created = await devCreateItem(token, {
      feedId,
      title: `Cool ${term}`,
      contentText: `Body for ${term}`,
    });
    if (created.status === 404) return; // dev-create disabled in prod; skip

    const id = created.body.id as string;

    // Baseline search: should include our item
    const s1 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(s1.body.items)).toBe(true);
    expect(s1.body.items.find((i: any) => i.id === id)).toBeTruthy();

    // Star the item
    await request(app)
      .post(`/items/${id}/state`)
      .set("Authorization", `Bearer ${token}`)
      .send({ starred: true })
      .expect(200);

    // starred=true should include it
    const s2 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}&starred=true`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(s2.body.items.find((i: any) => i.id === id)).toBeTruthy();

    // starred=false should exclude it
    const s3 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}&starred=false`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(s3.body.items.find((i: any) => i.id === id)).toBeFalsy();

    // feedId filter should not exclude it (still the same feed)
    const s4 = await request(app)
      .get(`/search?q=${encodeURIComponent(term)}&feedId=${feedId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(s4.body.items.find((i: any) => i.id === id)).toBeTruthy();
  });
});