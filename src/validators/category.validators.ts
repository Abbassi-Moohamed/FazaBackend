import { z } from "zod";

export const MONGODB_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
export const MONGODB_ID_MESSAGE = "Invalid identifier format.";

export const categoryIdSchema = z.object({
  categoryId: z.string().min(1, "categoryId is required.").regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE),
});
