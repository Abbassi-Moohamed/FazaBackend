import { Router } from "express";
import { deleteImageController, uploadImageController } from "../../controllers/admin/image.controller.js";
import { requireAdmin } from "../../middlewares/auth.middleware.js";
import { uploadSingleImage } from "../../middlewares/upload.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { imageIdParamsSchema } from "../../validators/admin.validators.js";

/**
 * Admin image endpoints — available to both admin roles. Authorization is
 * enforced per operation in the image service (app admin may manage any
 * image; a coffee admin only their own coffee's images).
 */
export const adminImagesRouter = Router();

adminImagesRouter.post("/", requireAdmin, uploadSingleImage, uploadImageController);

adminImagesRouter.delete("/:imageId", requireAdmin, validate({ params: imageIdParamsSchema }), deleteImageController);
