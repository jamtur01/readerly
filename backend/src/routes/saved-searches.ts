import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const router = Router();

// Schemas
const createSchema = z.object({
  name: z.string().min(1).max(100),
  query: z.string().min(1).max(500),
  filters: z.any().optional(), // JSON blob for future structured filters
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  query: z.string().min(1).max(500).optional(),
  filters: z.any().optional(),
});

// List saved searches
router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const searches = await prisma.savedSearch.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
    });
    return res.json({ searches });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list saved searches" });
  }
});

// Create saved search
router.post("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { name, query, filters } = parsed.data;
  try {
    const created = await prisma.savedSearch.create({
      data: { userId, name, query, filters: filters ?? null },
    });
    return res.status(201).json(created);
  } catch (e: any) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "A saved search with that name already exists" });
    }
    console.error(e);
    return res.status(500).json({ error: "Failed to create saved search" });
  }
});

// Update saved search
router.patch("/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    // Ensure ownership
    const existing = await prisma.savedSearch.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.savedSearch.update({
      where: { id },
      data: parsed.data,
    });
    return res.json(updated);
  } catch (e: any) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "A saved search with that name already exists" });
    }
    console.error(e);
    return res.status(500).json({ error: "Failed to update saved search" });
  }
});

// Delete saved search
router.delete("/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  try {
    // Ensure ownership
    const existing = await prisma.savedSearch.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    await prisma.savedSearch.delete({ where: { id } });
    return res.status(204).end();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete saved search" });
  }
});

export default router;