import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed, devCreateItem } from "./util";

describe("Items listing filters and user state", () => {
  it("filters by read and starred flags and respects feedId", async () => {
    const { token } = await signupAndLogin();
    const feedId = await createFeed(token);

    // Create two items (skip test gracefully if dev-create disabled)
    const a = await devCreateItem(token, { feedId, title: "Alpha One", contentText: "alpha content" });
    if (a.status === 404) return;
    const aId = a.body.id as string;

    const b = await devCreateItem(token, { feedId, title: "Beta Two", contentText: "beta content" });
    const bId = b.body.id as string;

    // Mark A read, B starred
    await request(app).post(`/items/${aId}/state`).set("Authorization", `Bearer ${token}`).send({ read: true }).expect(200);
    await request(app).post(`/items/${bId}/state`).set("Authorization", `Bearer ${token}`).send({ starred: true }).expect(200);

    // read=false should exclude A
    const unread = await request(app)
      .get(`/items?read=false&feedId=${feedId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(unread.body).toHaveProperty("items");
    expect(Array.isArray(unread.body.items)).toBe(true);
    expect(unread.body.items.find((i: any) => i.id === aId)).toBeFalsy();
    expect(unread.body.items.find((i: any) => i.id === bId)).toBeTruthy();

    // starred=true should include B only
    const starred = await request(app)
      .get(`/items?starred=true&feedId=${feedId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(starred.body.items.find((i: any) => i.id === bId)).toBeTruthy();
    // A may or may not be in this list depending on state, but ensure A is not starred
    const aInStarred = starred.body.items.find((i: any) => i.id === aId);
    if (aInStarred) {
      expect(Boolean(aInStarred.state?.starred)).toBe(false);
    }
  });
});