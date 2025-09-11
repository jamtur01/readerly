import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(64),
});

router.post("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { name } = parsed.data;
  try {
    const folder = await prisma.folder.create({ data: { userId, name } });
    return res.status(201).json(folder);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "Folder name already exists" });
    console.error(e);
    return res.status(500).json({ error: "Failed to create folder" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const folders = await prisma.folder.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });
    return res.json({ folders });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list folders" });
  }
});

const renameSchema = z.object({
  name: z.string().min(1).max(64),
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { name } = parsed.data;
  try {
    // Ensure belongs to user
    const f = await prisma.folder.findFirst({ where: { id, userId } });
    if (!f) return res.status(404).json({ error: "Not found" });

    const folder = await prisma.folder.update({ where: { id }, data: { name } });
    return res.json(folder);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "Folder name already exists" });
    console.error(e);
    return res.status(500).json({ error: "Failed to rename folder" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  try {
    // Ensure belongs to user
    const f = await prisma.folder.findFirst({ where: { id, userId } });
    if (!f) return res.status(404).json({ error: "Not found" });

    // Detach folder from subscriptions (set null) then delete folder
    await prisma.$transaction([
      prisma.subscription.updateMany({ where: { folderId: id, userId }, data: { folderId: null } }),
      prisma.folder.delete({ where: { id } }),
    ]);
    return res.status(204).end();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete folder" });
  }
});

export default router;