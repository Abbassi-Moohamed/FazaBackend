import { Router } from "express";
import { isDatabaseConnected } from "../db/index.js";
import { env } from "../config/env.js";

export const healthRouter = Router();

/**
 * Liveness: the process is up and serving traffic.
 *
 * The payload also carries the build identity (`buildSha`) so a deploy can be
 * verified: the CI/CD waits until the live instance reports the commit that
 * was just pushed. That is what turns "the push happened" into "the push is
 * live", which is exactly what drifted last time.
 */
healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    apiVersion: "v1",
    buildSha: env.buildSha,
    builtAt: env.builtAt,
    startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** Readiness: the process can actually serve data (database reachable). */
healthRouter.get("/ready", (_req, res) => {
  if (isDatabaseConnected()) {
    res.json({ status: "ok", database: "up", buildSha: env.buildSha });
    return;
  }
  res.status(503).json({ status: "error", database: "down", buildSha: env.buildSha });
});
