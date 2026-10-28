import { z } from "zod";
import { SLUG_MESSAGE, SLUG_PATTERN } from "../models/coffee.model.js";

export const coffeeSlugSchema = z.object({
  coffeeSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "coffeeSlug is required.")
    .max(80, "coffeeSlug must be at most 80 characters.")
    .regex(SLUG_PATTERN, SLUG_MESSAGE),
});

export const publicItemViewParamsSchema = z.object({
  coffeeSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "coffeeSlug is required.")
    .max(80, "coffeeSlug must be at most 80 characters.")
    .regex(SLUG_PATTERN, SLUG_MESSAGE),
  itemId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid item identifier."),
});
