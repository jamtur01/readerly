import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { env } from "../env";

export const router = Router();

const signupSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

function signAccessToken(userId: string) {
  // Default 15m expiry unless env overrides later
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: "15m" });
}

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { username, email, password } = parsed.data;

  try {
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing) {
      return res.status(409).json({ error: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, email, passwordHash },
      select: { id: true, username: true, email: true, createdAt: true },
    });

    const token = signAccessToken(user.id);
    return res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to create user" });
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signAccessToken(user.id);
    return res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Login failed" });
  }
});

export default router;