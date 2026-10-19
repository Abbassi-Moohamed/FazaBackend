import type { Request, Response } from "express";
import { deleteAdminImage, uploadAdminImage } from "../../services/image.service.js";
import { ApiError } from "../../utils/ApiError.js";
import { sendSuccess } from "../../utils/http.js";

/** POST /api/v1/admin/images — multipart, field name `file`. */
export async function uploadImageController(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    throw new ApiError(400, "No image file provided. Upload a single file using the field name 'file'.");
  }

  const image = await uploadAdminImage({
    buffer: file.buffer,
    contentType: file.mimetype,
    originalName: file.originalname,
    admin: req.admin!,
  });

  sendSuccess(res, image, 201);
}

/** DELETE /api/v1/admin/images/:imageId */
export async function deleteImageController(req: Request, res: Response): Promise<void> {
  const { imageId } = req.validated!.params as { imageId: string };
  const result = await deleteAdminImage(imageId, req.admin!);
  sendSuccess(res, result);
}
