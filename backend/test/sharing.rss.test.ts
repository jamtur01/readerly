import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, signupAndLogin, createFeed, devCreateItem } from "./util";
import { escapeXml } from "../src/routes/sharing";

describe("Sharing RSS", () => {
  it("shares items and produces valid escaped RSS", async () => {
    const { token, user } = await signupAndLogin();
    const feedId = await createFeed(token);

    const titleRaw = `Best & <Great> "Quotes" 'n Things`;
    const contentTextRaw = `A & B with <b>bold</b> and "quotes" & 'apostrophes'`;

    const created = await devCreateItem(token, {
      feedId,
      title: titleRaw,
      contentText: contentTextRaw,
    });
    if (created.status === 404) return; // dev-create disabled in prod; skip

    const itemId = created.body.id as string;

    // Toggle share on
    await request(app)
      .post(`/sharing/items/${itemId}/share`)
      .set("Authorization", `Bearer ${token}`)
      .send({ share: true })
      .expect(200);

    // Private management endpoint lists the shared item
    const me = await request(app)
      .get("/sharing/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(me.body.items)).toBe(true);
    expect(me.body.items.some((i: any) => i.id === itemId)).toBe(true);

    // Public RSS
    const res = await request(app)
      .get(`/sharing/${encodeURIComponent(user.username)}/rss`)
      .expect(200);

    const xml = res.text as string;

    // Basic XML structure (real XML tags)
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toMatch(/<rss[^>]*>/);
    expect(xml).toMatch(/<channel>/);

    // Channel title/link/description; apostrophe should be encoded as &apos;
    expect(xml).toContain(
      `<title>${user.username}&apos;s shared items - Readerly</title>`
    );
    expect(xml).toMatch(/<link>https?:\/\/[^<]+<\/link>/);
    expect(xml).toMatch(/<description>.*Readerly<\/description>/);

    // Item title escaped with standard XML entities (using the shared escapeXml)
    const titleEsc = escapeXml(titleRaw);
    expect(xml).toContain(`<title>${titleEsc}</title>`);

    // GUID present and not permaLink
    expect(xml).toContain(`<guid isPermaLink="false">${itemId}</guid>`);

    // Description uses CDATA; for contentText path it's wrapped in <pre> with escaped text inside CDATA
    const contentEsc = escapeXml(contentTextRaw);
    expect(xml).toContain(`<![CDATA[<pre>${contentEsc}</pre>]]>`);

    // No stray ampersands outside standard entities anywhere in the doc
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});
