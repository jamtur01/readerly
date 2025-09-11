import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed } from "./util";

describe("Validation and error responses across routes", () => {
  it("returns 400 for invalid /items query params (page < 1)", async () => {
    const { token } = await signupAndLogin();
    const res = await request(app)
      .get("/items?page=0") // min is 1
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Invalid query");
    expect(res.body).toHaveProperty("details");
  });

  it("returns 400 for invalid /feeds PATCH body (fetchInterval < 5)", async () => {
    const { token } = await signupAndLogin();
    const url = `http://example.com/feed-${Date.now()}.xml`;
    const created = await request(app)
      .post("/feeds")
      .set("Authorization", `Bearer ${token}`)
      .send({ url })
      .expect(201);

    const id = created.body.id as string;
    const bad = await request(app)
      .patch(`/feeds/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ fetchInterval: 2 }); // min is 5
    expect(bad.status).toBe(400);
    expect(bad.body).toHaveProperty("error", "Invalid body");
  });

  it("returns 400 for invalid folderId when creating subscription", async () => {
    const { token } = await signupAndLogin();
    const feedId = await createFeed(token);
    // Random UUID that won't belong to the user
    const invalidFolder = "11111111-1111-1111-1111-111111111111";
    const res = await request(app)
      .post("/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({ feedId, folderId: invalidFolder });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Invalid folderId");
  });

  it("saved searches: duplicate name on update returns 409 and unauthorized update returns 404", async () => {
    const a1 = await signupAndLogin();
    const a2 = await signupAndLogin();

    // Create two searches for user A
    const s1 = await request(app)
      .post("/saved-searches")
      .set("Authorization", `Bearer ${a1.token}`)
      .send({ name: "Alpha", query: "one" })
      .expect(201);

    const s2 = await request(app)
      .post("/saved-searches")
      .set("Authorization", `Bearer ${a1.token}`)
      .send({ name: "Beta", query: "two" })
      .expect(201);

    // Rename Beta -> Alpha (collision) => 409
    const dup = await request(app)
      .patch(`/saved-searches/${s2.body.id}`)
      .set("Authorization", `Bearer ${a1.token}`)
      .send({ name: "Alpha" });
    expect(dup.status).toBe(409);
    expect(dup.body).toHaveProperty("error");

    // User B tries to update User A's saved search => 404 (ownership enforced)
    const notFound = await request(app)
      .patch(`/saved-searches/${s1.body.id}`)
      .set("Authorization", `Bearer ${a2.token}`)
      .send({ name: "Hacker" });
    expect(notFound.status).toBe(404);
    expect(notFound.body).toHaveProperty("error", "Not found");
  });
});