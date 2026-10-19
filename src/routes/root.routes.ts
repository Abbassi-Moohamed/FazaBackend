import { Router } from "express";
import { sendSuccess } from "../utils/http.js";

/** Informational overview served at `GET /` so the API root is self-describing. */
export const rootRouter = Router();

rootRouter.get("/", (_req, res) => {
  sendSuccess(res, {
    name: "Faza API",
    apiVersion: "v1",
    endpoints: {
      health: "/health",
      readiness: "/health/ready",
      coffeeBySlug: "/api/v1/coffees/:coffeeSlug",
      itemsByCategory: "/api/v1/categories/:categoryId/items",
      adminLogin: "/api/v1/admin/auth/app",
      coffeeAdminLogin: "/api/v1/admin/auth/coffee/:coffeeSlug",
    },
  });
});
