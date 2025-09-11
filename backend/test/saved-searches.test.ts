import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin } from "./util";

describe("Saved Searches CRUD", () => {
  it("creates, lists, updates (rename), and deletes a saved search", async () => {
    const { token } = await signupAndLogin();

    // Create
    const create = await request(app)
      .post("/saved-searches")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "My First Search",
        query: "readerly test",
        filters: { starred: true, feedId: null },
      })
      .expect(201);

    expect(create.body).toHaveProperty("id");
    const id = create.body.id as string;

    // List
    const list1 = await request(app)
      .get("/saved-searches")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(list1.body.searches)).toBe(true);
    expect(list1.body.searches.find((s: any) => s.id === id)).toBeTruthy();

    // Rename via PATCH
    const rename = await request(app)
      .patch(`/saved-searches/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Renamed Search" })
      .expect(200);

    expect(rename.body).toHaveProperty("name", "Renamed Search");

    // Delete
    await request(app)
      .delete(`/saved-searches/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    // Verify deletion
    const list2 = await request(app)
      .get("/saved-searches")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(list2.body.searches.find((s: any) => s.id === id)).toBeFalsy();
  });

  it("rejects duplicate names for the same user", async () => {
    const { token } = await signupAndLogin();

    const base = {
      name: "DupName",
      query: "dup test",
      filters: { read: false },
    };

    const a = await request(app)
      .post("/saved-searches")
      .set("Authorization", `Bearer ${token}`)
      .send(base)
      .expect(201);

    expect(a.body).toHaveProperty("id");

    // Second with same name should conflict (unique (userId, name))
    await request(app)
      .post("/saved-searches")
      .set("Authorization", `Bearer ${token}`)
      .send(base)
      .expect(409);
  });
});