import { Router } from "express";
import { adminAuthRouter } from "./auth.routes.js";
import { appAdminCoffeesRouter } from "./app-admin.routes.js";
import { coffeeAdminRouter } from "./coffee-admin.routes.js";
import { adminImagesRouter } from "./images.routes.js";
import { getPlatformInsightsController } from "../../controllers/admin/insights.controller.js";
import { requireAdmin, requireAppAdmin } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { insightsQuerySchema } from "../../validators/admin.validators.js";

/**
 * Backoffice routing, separated by role:
 *
 *   /api/v1/admin/auth/*        → PIN → bearer token (both roles)
 *   /api/v1/admin/coffees/*     → application admin only
 *   /api/v1/admin/my-coffee/*   → coffee admin only (their own coffee)
 *   /api/v1/admin/images/*      → both roles (ownership checked per image)
 */
export const adminRouter = Router();

adminRouter.use("/auth", adminAuthRouter);
adminRouter.use("/coffees", appAdminCoffeesRouter);
adminRouter.use("/my-coffee", coffeeAdminRouter);
adminRouter.use("/images", adminImagesRouter);
adminRouter.get(
  "/insights",
  requireAdmin,
  requireAppAdmin,
  validate({ query: insightsQuerySchema }),
  getPlatformInsightsController,
);
