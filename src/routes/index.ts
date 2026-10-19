import { Router } from "express";
import { v1Router } from "./v1/index.js";

/**
 * Central API router. All public routes live under `/api`, versions under it:
 * `/api/v1`, `/api/v2`, ... Versioning is centralized here rather than being
 * hardcoded in every controller.
 */
export const apiRouter = Router();

apiRouter.use("/v1", v1Router);
