import { Router } from "express";
import { loginAppAdminController, loginCoffeeAdminController } from "../../controllers/admin/auth.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { coffeeSlugParamsSchema, pinBodySchema } from "../../validators/admin.validators.js";

/**
 * Admin authentication: PIN → short-lived bearer token.
 * Separated per role: application admin has its own endpoint, coffee admins
 * authenticate against their own coffee slug.
 */
export const adminAuthRouter = Router();

adminAuthRouter.post("/app", validate({ body: pinBodySchema }), loginAppAdminController);

adminAuthRouter.post(
  "/coffee/:coffeeSlug",
  validate({ params: coffeeSlugParamsSchema, body: pinBodySchema }),
  loginCoffeeAdminController,
);
