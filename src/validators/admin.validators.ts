import { z } from "zod";
import { SLUG_MESSAGE, SLUG_PATTERN } from "../models/coffee.model.js";
import { MONGODB_ID_MESSAGE, MONGODB_ID_PATTERN } from "./category.validators.js";

/**
 * Request schemas for the backoffice. Location-scoped (params/body) so they
 * plug directly into `validate({ params, body })`, matching the public API
 * conventions. Every value is validated before it can reach a service.
 */

export const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits.");

export const coffeeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "coffeeSlug is required.")
  .max(80, "coffeeSlug must be at most 80 characters.")
  .regex(SLUG_PATTERN, SLUG_MESSAGE);

export const coffeeIdParamsSchema = z.object({
  coffeeId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
});

export const categoryIdParamsSchema = z.object({
  categoryId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
});

export const itemIdParamsSchema = z.object({
  itemId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
});

export const imageIdParamsSchema = z.object({
  imageId: z.string().trim().min(1, "imageId is required.").max(200, "imageId must be at most 200 characters."),
});

export const coffeeSlugParamsSchema = z.object({
  coffeeSlug: coffeeSlugSchema,
});

export const pinBodySchema = z.object({
  pin: pinSchema,
});

export const createCoffeeBodySchema = z.object({
  name: z.string().trim().min(1, "Coffee name is required.").max(120, "Coffee name must be at most 120 characters."),
  slug: coffeeSlugSchema,
  logo: z.url("logo must be a valid URL.").optional(),
  cover: z.url("cover must be a valid URL.").optional(),
});

const updateCoffeeFields = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Coffee name is required.")
    .max(120, "Coffee name must be at most 120 characters.")
    .optional(),
  logo: z.url("logo must be a valid URL.").optional(),
  cover: z.url("cover must be a valid URL.").optional(),
  slug: coffeeSlugSchema.optional(),
});

/** At least one editable field must be present (used for PATCH on coffees). */
export const updateCoffeeBodySchema = updateCoffeeFields.refine((value) => Object.keys(value).length >= 1, {
  message: "Provide at least one field to update.",
});

export const updateMyCoffeeBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Coffee name is required.")
      .max(120, "Coffee name must be at most 120 characters.")
      .optional(),
    logo: z.url("logo must be a valid URL.").optional(),
    cover: z.url("cover must be a valid URL.").optional(),
    /**
     * Accepted only so the service can reject an actual change: a coffee admin
     * may not rename their own slug. Sending the current slug is a no-op.
     */
    slug: coffeeSlugSchema.optional(),
  })
  .refine((value) => Object.keys(value).length >= 1, {
    message: "Provide at least one field to update.",
  });

export const categoryBodySchema = z.object({
  name: z.string().trim().min(1, "Category name is required.").max(80, "Category name must be at most 80 characters."),
  image: z.url("image must be a valid URL.").optional(),
});

export const itemBodySchema = z
  .object({
    name: z.string().trim().min(1, "Item name is required.").max(120, "Item name must be at most 120 characters."),
    description: z.string().trim().max(500, "Item description must be at most 500 characters.").optional(),
    price: z.number().finite().positive("Item price must be greater than zero."),
    promotion: z
      .number()
      .finite()
      .positive("Promotional price must be greater than zero.")
      .nullable()
      .optional()
      .default(null),
    isAvailable: z.boolean().optional().default(true),
    image: z.url("image must be a valid URL.").optional(),
  })
  .refine((value) => value.promotion === null || value.promotion < value.price, {
    message: "Promotional price must be lower than the regular price.",
    path: ["promotion"],
  });

export const updateItemBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Item name is required.")
      .max(120, "Item name must be at most 120 characters.")
      .optional(),
    description: z.string().trim().max(500, "Item description must be at most 500 characters.").optional(),
    price: z.number().finite().positive("Item price must be greater than zero.").optional(),
    promotion: z.number().finite().positive("Promotional price must be greater than zero.").nullable().optional(),
    isAvailable: z.boolean().optional(),
    image: z.url("image must be a valid URL.").optional(),
  })
  .refine((value) => Object.keys(value).length >= 1, {
    message: "Provide at least one field to update.",
  })
  .refine(
    (value) =>
      value.promotion === undefined ||
      value.promotion === null ||
      value.price === undefined ||
      value.promotion < value.price,
    {
      message: "Promotional price must be lower than the regular price.",
      path: ["promotion"],
    },
  );

export const changePinBodySchema = z
  .object({
    currentPin: pinSchema,
    newPin: pinSchema,
  })
  .refine((value) => value.currentPin !== value.newPin, {
    message: "New PIN must be different from the current PIN.",
    path: ["newPin"],
  });
export const insightsQuerySchema = z
  .object({
    startDate: z.string().trim().max(30).optional(),
    endDate: z.string().trim().max(30).optional(),
    from: z.string().trim().max(30).optional(),
    to: z.string().trim().max(30).optional(),
    serviceShiftId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE).optional(),
    shiftId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE).optional(),
  })
  .transform((value) => ({
    startDate: value.startDate ?? value.from,
    endDate: value.endDate ?? value.to,
    serviceShiftId: value.serviceShiftId ?? value.shiftId,
  }))
  .refine(
    (value) =>
      (!value.startDate || !Number.isNaN(new Date(value.startDate).getTime())) &&
      (!value.endDate || !Number.isNaN(new Date(value.endDate).getTime())),
    {
      message: "Dates must be valid ISO dates.",
      path: ["startDate"],
    },
  )
  .refine(
    (value) =>
      !value.startDate || !value.endDate || new Date(value.startDate).getTime() <= new Date(value.endDate).getTime(),
    {
      message: "startDate must be before or equal to endDate.",
      path: ["startDate"],
    },
  );

export const serviceShiftIdParamsSchema = z.object({
  shiftId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
});

export const tableSessionIdParamsSchema = z.object({
  sessionId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
});

export const tableNumberParamsSchema = z.object({
  tableNumber: z.coerce.number().int().min(1).max(10000),
});

export const openServiceShiftBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["MORNING", "AFTERNOON", "CUSTOM"]).optional(),
  label: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const listServiceShiftsQuerySchema = z.object({
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listTableSessionsQuerySchema = z.object({
  serviceShiftId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE).optional(),
  status: z.enum(["ACTIVE", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/* ---- Daily offers -------------------------------------------------------- */

const offerDateSchema = z
  .string()
  .trim()
  .min(1, "Date is required.")
  .max(40, "Date must be at most 40 characters.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date must be a valid ISO date.");

const offerLineBodySchema = z.object({
  itemId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
  quantity: z.number().int().min(1, "Quantity must be at least 1.").max(99, "Quantity must be at most 99."),
});

const offerLinesSchema = z
  .array(offerLineBodySchema)
  .min(1, "An offer must contain at least one item.")
  .max(20, "An offer can contain at most 20 items.")
  .refine((lines) => new Set(lines.map((line) => line.itemId)).size === lines.length, {
    message: "An item can appear only once in an offer.",
    path: ["lines"],
  });

export const offerIdParamsSchema = z.object({
  offerId: z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
});

export const offerBodySchema = z
  .object({
    name: z.string().trim().min(1, "Offer name is required.").max(120, "Offer name must be at most 120 characters."),
    description: z.string().trim().max(500, "Offer description must be at most 500 characters.").optional(),
    price: z.number().finite().positive("Offer price must be greater than zero."),
    stock: z.number().int().min(0, "Stock cannot be negative.").max(9999, "Stock must be at most 9999."),
    lines: offerLinesSchema,
    image: z.url("image must be a valid URL.").nullable().optional(),
    startAt: offerDateSchema.nullable().optional(),
    endAt: offerDateSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) => !value.startAt || !value.endAt || new Date(value.startAt).getTime() < new Date(value.endAt).getTime(),
    {
      message: "The end date must be after the start date.",
      path: ["endAt"],
    },
  );

export const updateOfferBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Offer name is required.")
      .max(120, "Offer name must be at most 120 characters.")
      .optional(),
    description: z.string().trim().max(500, "Offer description must be at most 500 characters.").optional(),
    price: z.number().finite().positive("Offer price must be greater than zero.").optional(),
    stock: z.number().int().min(0, "Stock cannot be negative.").max(9999, "Stock must be at most 9999.").optional(),
    lines: offerLinesSchema.optional(),
    image: z.url("image must be a valid URL.").nullable().optional(),
    startAt: offerDateSchema.nullable().optional(),
    endAt: offerDateSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length >= 1, {
    message: "Provide at least one field to update.",
  })
  .refine(
    (value) => !value.startAt || !value.endAt || new Date(value.startAt).getTime() < new Date(value.endAt).getTime(),
    {
      message: "The end date must be after the start date.",
      path: ["endAt"],
    },
  );
