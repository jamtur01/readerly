import request from "supertest";
import { createApp } from "../src/app";

export const app = createApp();

export function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function signupAndLogin() {
  const username = unique("user");
  const email = `${username}@example.com`;
  const password = "P@ssw0rd!";

  const signup = await request(app).post("/auth/signup").send({ username, email, password });
  if (signup.status !== 201) {
    throw new Error(`Signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
  }

  const login = await request(app).post("/auth/login").send({ email, password });
  if (login.status !== 200) {
    throw new Error(`Login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  return {
    token: login.body.token as string,
    user: login.body.user as { id: string; username: string; email: string },
  };
}

export async function createFeed(token: string) {
  const url = `http://example.com/${unique("feed")}.xml`;
  const res = await request(app)
    .post("/feeds")
    .set("Authorization", `Bearer ${token}`)
    .send({ url, title: "Test Feed" });
  if (res.status !== 201) {
    throw new Error(`Create feed failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const feedId = (res.body.id as string) || (res.body.feed?.id as string);
  if (!feedId) throw new Error("Create feed did not return id");
  return feedId;
}

// Returns: { status: number, body?: any }
export async function devCreateItem(
  token: string,
  params: { feedId: string; title: string; contentText?: string; publishedAt?: string | Date }
) {
  const body: any = {
    feedId: params.feedId,
    title: params.title,
    contentText: params.contentText ?? "",
  };
  if (params.publishedAt) body.publishedAt = params.publishedAt;

  const res = await request(app)
    .post("/items/dev-create")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
  // In production this route may be disabled (404). Callers should handle that.
  return res;
}