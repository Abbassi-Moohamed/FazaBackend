import { Router } from "express";
import { getItemsByCategoryController } from "../../controllers/category.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { categoryIdSchema } from "../../validators/category.validators.js";

export const categoryRouter = Router();

categoryRouter.get(
  "/categories/:categoryId/items",
  validate({ params: categoryIdSchema }),
  getItemsByCategoryController,
);
