import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env";

export interface AuthPayload { sub: string }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    (req as any).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}