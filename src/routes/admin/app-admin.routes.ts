import { Router } from "express";
import {
  createAdminCoffeeController,
  deleteAdminCoffeeController,
  getAdminCoffeeController,
  listAdminCoffeesController,
  resetAdminCoffeePinController,
  updateAdminCoffeeController,
} from "../../controllers/admin/app-admin/coffees.controller.js";
import { getAdminCoffeeInsightsController } from "../../controllers/admin/insights.controller.js";
import { requireAdmin, requireAppAdmin } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  coffeeIdParamsSchema,
  createCoffeeBodySchema,
  insightsQuerySchema,
  updateCoffeeBodySchema,
} from "../../validators/admin.validators.js";

/**
 * Application-admin coffee management. The app admin has full CRUD on every
 * coffee, plus the ability to reset any coffee's admin PIN.
 */
export const appAdminCoffeesRouter = Router();

appAdminCoffeesRouter.use(requireAdmin, requireAppAdmin);

appAdminCoffeesRouter.get("/", listAdminCoffeesController);
appAdminCoffeesRouter.post("/", validate({ body: createCoffeeBodySchema }), createAdminCoffeeController);
appAdminCoffeesRouter.get("/:coffeeId", validate({ params: coffeeIdParamsSchema }), getAdminCoffeeController);
appAdminCoffeesRouter.get(
  "/:coffeeId/insights",
  validate({ params: coffeeIdParamsSchema, query: insightsQuerySchema }),
  getAdminCoffeeInsightsController,
);
appAdminCoffeesRouter.patch(
  "/:coffeeId",
  validate({ params: coffeeIdParamsSchema, body: updateCoffeeBodySchema }),
  updateAdminCoffeeController,
);
appAdminCoffeesRouter.patch(
  "/:coffeeId/pin",
  validate({ params: coffeeIdParamsSchema }),
  resetAdminCoffeePinController,
);
appAdminCoffeesRouter.delete("/:coffeeId", validate({ params: coffeeIdParamsSchema }), deleteAdminCoffeeController);
