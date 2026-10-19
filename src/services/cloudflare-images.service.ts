import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

/** Configurable upload ceiling; bounded to prevent memory exhaustion. */
export const IMAGE_MAX_SIZE_BYTES = env.IMAGE_UPLOAD_MAX_MB * 1024 * 1024;

export const IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const IMAGE_EXTENSIONS = new Set([...IMAGE_MIME_TYPES.values(), "jpeg"]);

export interface CloudflareUploadedImage {
  imageId: string;
  url: string;
}

export function isCloudflareConfigured(): boolean {
  return env.cloudflareR2Configured;
}

function assertCloudflareConfigured(): void {
  if (!isCloudflareConfigured()) {
    throw new ApiError(503, "Image storage is not configured on this server. Set the Cloudflare R2 variables.");
  }
}

function storageClient(): S3Client {
  assertCloudflareConfigured();
  return new S3Client({
    region: "auto",
    endpoint: env.CLOUDFLARE_R2_ENDPOINT,
    credentials: {
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });
}

export function buildDeliveryUrl(objectKey: string): string {
  assertCloudflareConfigured();
  if (!/^uploads\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]+\.(jpg|png|webp|gif)$/.test(objectKey)) {
    throw new ApiError(400, "Invalid image storage key.");
  }
  return `${env.CLOUDFLARE_R2_PUBLIC_URL.replace(/\/+$/, "")}/${objectKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function isManagedDeliveryUrl(url: string): boolean {
  try {
    if (new URL(url).hostname === "imagedelivery.net") return true;
    const publicUrl = new URL(env.CLOUDFLARE_R2_PUBLIC_URL);
    const parsed = new URL(url);
    return (
      parsed.origin === publicUrl.origin && parsed.pathname.startsWith(`${publicUrl.pathname.replace(/\/+$/, "")}/`)
    );
  } catch {
    return false;
  }
}

export function parseImageIdFromDeliveryUrl(url: string): string | null {
  if (!isManagedDeliveryUrl(url)) return null;
  try {
    const legacy = new URL(url);
    if (legacy.hostname === "imagedelivery.net") {
      const segments = legacy.pathname.split("/").filter(Boolean);
      return segments[1] ?? null;
    }
    const publicUrl = new URL(env.CLOUDFLARE_R2_PUBLIC_URL);
    const parsed = new URL(url);
    const prefix = publicUrl.pathname.replace(/\/+$/, "");
    const key = decodeURIComponent(parsed.pathname.slice(`${prefix}/`.length));
    return /^uploads\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]+\.(jpg|png|webp|gif)$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return (
    base
      // eslint-disable-next-line no-control-regex -- intentional: strip control characters from uploaded filenames
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 120)
  );
}

function sniffImageFormat(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a)
    return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    return "webp";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4).startsWith("GIF")) return "gif";
  return null;
}

export function assertSupportedImage(file: { buffer: Buffer; contentType: string; originalname: string }): void {
  if (file.buffer.length === 0) throw new ApiError(400, "The uploaded file is empty.");
  if (file.buffer.length > IMAGE_MAX_SIZE_BYTES) {
    throw new ApiError(413, `Image file too large. Maximum size is ${env.IMAGE_UPLOAD_MAX_MB} MB.`);
  }

  const expected = IMAGE_MIME_TYPES.get(file.contentType);
  if (!expected) throw new ApiError(400, "Unsupported image type. Supported formats: JPEG, PNG, WebP, GIF.");
  if (sniffImageFormat(file.buffer) !== expected)
    throw new ApiError(400, "The image content does not match its declared type.");

  const filename = sanitizeFilename(file.originalname).toLowerCase();
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
  if (extension.length > 0 && !IMAGE_EXTENSIONS.has(extension)) {
    throw new ApiError(400, "The file extension conflicts with the image type.");
  }
}

export async function uploadCloudflareImage(input: {
  buffer: Buffer;
  contentType: string;
  filename?: string;
}): Promise<CloudflareUploadedImage> {
  assertCloudflareConfigured();
  const extension = IMAGE_MIME_TYPES.get(input.contentType);
  if (!extension) throw new ApiError(400, "Unsupported image type.");

  const objectKey = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
  try {
    await storageClient().send(
      new PutObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: objectKey,
        Body: input.buffer,
        ContentType: input.contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (error) {
    const r2Error = error as { name?: string; Code?: string; code?: string };
    logger.error({ name: r2Error.name, code: r2Error.Code ?? r2Error.code }, "Cloudflare R2 upload failed");
    if (r2Error.name === "InvalidBucketName" || r2Error.Code === "InvalidBucketName") {
      throw new ApiError(503, "Image storage is misconfigured. The R2 bucket name must be lowercase.");
    }
    throw new ApiError(502, "Image upload failed");
  }

  return { imageId: objectKey, url: buildDeliveryUrl(objectKey) };
}

export async function deleteCloudflareImage(objectKey: string): Promise<void> {
  assertCloudflareConfigured();
  if (!/^uploads\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]+\.(jpg|png|webp|gif)$/.test(objectKey)) {
    return;
  }
  try {
    await storageClient().send(
      new DeleteObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: objectKey,
      }),
    );
  } catch (error) {
    logger.error({ err: error, objectKey }, "Cloudflare R2 deletion failed");
    throw new ApiError(502, "Image deletion failed");
  }
}
