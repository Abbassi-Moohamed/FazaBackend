import { Router } from "express";
import { isDatabaseConnected } from "../db/index.js";

export const healthRouter = Router();

/** Liveness: the process is up and serving traffic. */
healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

/** Readiness: the process can actually serve data (database reachable). */
healthRouter.get("/ready", (_req, res) => {
  if (isDatabaseConnected()) {
    res.json({ status: "ok", database: "up" });
    return;
  }
  res.status(503).json({ status: "error", database: "down" });
});
