import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { env } from "./env";
import { router as healthRouter } from "./routes/health";
import { router as authRouter } from "./routes/auth";
import { router as feedsRouter } from "./routes/feeds";
import { router as subscriptionsRouter } from "./routes/subscriptions";
import { router as itemsRouter } from "./routes/items";
import { router as foldersRouter } from "./routes/folders";
import { router as opmlRouter } from "./routes/opml";
import { router as searchRouter } from "./routes/search";
import { router as savedSearchesRouter } from "./routes/saved-searches";
import { router as sharingRouter } from "./routes/sharing";
import { requireAuth } from "./middleware/auth";
import { prisma } from "./prisma";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cors({ origin: env.CORS_ALLOW_ORIGIN ?? "*", credentials: true }));
  app.use(morgan("dev"));

  // Global rate limiter
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Stricter limits for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(apiLimiter);

  app.use("/health", healthRouter);
  app.use("/auth", authLimiter, authRouter);
  app.use("/feeds", feedsRouter);
  app.use("/subscriptions", subscriptionsRouter);
  app.use("/items", itemsRouter);
  app.use("/folders", foldersRouter);
  app.use("/opml", opmlRouter);
  app.use("/search", searchRouter);
  app.use("/saved-searches", savedSearchesRouter);
  app.use("/sharing", sharingRouter);

  app.get("/", (_req: Request, res: Response) => {
    res.json({ name: "Readerly API", status: "ok" });
  });

  app.get("/me", requireAuth, async (_req: Request, res: Response) => {
    try {
      const userId = (_req as any).userId as string;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, email: true, createdAt: true },
      });
      return res.json({ user });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to load profile" });
    }
  });

  // Error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  );

  return app;
}
