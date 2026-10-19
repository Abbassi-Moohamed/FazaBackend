import { Router } from "express";
import { getCoffeeBySlugController } from "../../controllers/coffee.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { coffeeSlugSchema } from "../../validators/coffee.validators.js";

export const coffeeRouter = Router();

coffeeRouter.get("/coffees/:coffeeSlug", validate({ params: coffeeSlugSchema }), getCoffeeBySlugController);
