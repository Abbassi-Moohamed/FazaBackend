import multer from "multer";
import { MEDIA_MAX_SIZE_BYTES, MEDIA_MIME_TYPES } from "../services/cloudflare-images.service.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Multipart upload middleware for a single media file (`file` field). Files
 * are kept entirely in memory — nothing is written to the local filesystem
 * (Render's is ephemeral). The real authorization and re-validation happen in
 * the image service; this is the first line of defense.
 */
export const uploadSingleImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MEDIA_MAX_SIZE_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 10 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!MEDIA_MIME_TYPES.has(file.mimetype)) {
      cb(new ApiError(400, "Unsupported media type. Supported formats: JPEG, PNG, WebP, GIF, MP4, WebM."));
      return;
    }
    cb(null, true);
  },
}).single("file");
