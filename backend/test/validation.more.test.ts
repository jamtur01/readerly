import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed, devCreateItem } from "./util";

describe("Folders CRUD validation and ownership", () => {
  it("creates, lists, renames, detects duplicates, enforces ownership, and deletes", async () => {
    const a = await signupAndLogin();
    const b = await signupAndLogin();

    // Create folder for user A
    const f1 = await request(app)
      .post("/folders")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ name: "Tech" })
      .expect(201);

    const folderId = f1.body.id as string;
    expect(folderId).toBeTruthy();

    // Duplicate create for the same user => 409
    await request(app)
      .post("/folders")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ name: "Tech" })
      .expect(409);

    // List includes folder
    const list = await request(app)
      .get("/folders")
      .set("Authorization", `Bearer ${a.token}`)
      .expect(200);
    expect(Array.isArray(list.body.folders)).toBe(true);
    expect(list.body.folders.find((f: any) => f.id === folderId)).toBeTruthy();

    // Rename for user A
    const ren = await request(app)
      .patch(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${a.token}`)
      .send({ name: "News" })
      .expect(200);
    expect(ren.body.name).toBe("News");

    // Create another folder "Work" to test rename collision
    await request(app)
      .post("/folders")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ name: "Work" })
      .expect(201);

    // Rename "News" -> "Work" (duplicate) => 409
    await request(app)
      .patch(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${a.token}`)
      .send({ name: "Work" })
      .expect(409);

    // User B tries to rename A's folder => 404 (ownership enforced)
    await request(app)
      .patch(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${b.token}`)
      .send({ name: "Hacked" })
      .expect(404);

    // User B tries to delete A's folder => 404
    await request(app)
      .delete(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${b.token}`)
      .expect(404);

    // Delete for user A => 204
    await request(app)
      .delete(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${a.token}`)
      .expect(204);

    // No longer present in list
    const list2 = await request(app)
      .get("/folders")
      .set("Authorization", `Bearer ${a.token}`)
      .expect(200);
    expect(list2.body.folders.find((f: any) => f.id === folderId)).toBeFalsy();
  });
});

describe("Auth validation and error responses", () => {
  it("validates signup/login bodies and incorrect credentials", async () => {
    // Invalid signup email
    await request(app)
      .post("/auth/signup")
      .send({ username: "userbad", email: "not-an-email", password: "P@ssw0rd!" })
      .expect(400);

    // Invalid signup short password
    await request(app)
      .post("/auth/signup")
      .send({ username: "userbad2", email: "userbad2@example.com", password: "short" })
      .expect(400);

    // Create a valid user
    const email = `v-${Date.now()}@example.com`;
    const password = "P@ssw0rd!";
    const username = `user${Math.random().toString(36).slice(2, 8)}`;
    await request(app)
      .post("/auth/signup")
      .send({ username, email, password })
      .expect(201);

    // Invalid login email format
    await request(app)
      .post("/auth/login")
      .send({ email: "not-mail", password })
      .expect(400);

    // Incorrect credentials
    await request(app)
      .post("/auth/login")
      .send({ email, password: "wrongpassword" })
      .expect(401);
  });
});

describe("Items state validation and error responses", () => {
  it("rejects invalid state body and unknown item id", async () => {
    const { token } = await signupAndLogin();
    const feedId = await createFeed(token);

    const created = await devCreateItem(token, { feedId, title: "State Test", contentText: "x" });
    if (created.status === 404) return; // dev route disabled; skip gracefully

    const itemId = created.body.id as string;

    // Invalid body (Zod should reject) -> 400
    await request(app)
      .post(`/items/${itemId}/state`)
      .set("Authorization", `Bearer ${token}`)
      .send({ read: "yes" }) // should be boolean
      .expect(400);

    // Unknown item id -> 404
    await request(app)
      .post(`/items/11111111-1111-1111-1111-111111111111/state`)
      .set("Authorization", `Bearer ${token}`)
      .send({ read: true })
      .expect(404);
  });
});

describe("OPML import validation", () => {
  it("returns 400 for malformed/too-short opml payload", async () => {
    const { token } = await signupAndLogin();
    await request(app)
      .post("/opml/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ opml: "<xml/>" }) // shorter than min length + invalid structure
      .expect(400);
  });
});