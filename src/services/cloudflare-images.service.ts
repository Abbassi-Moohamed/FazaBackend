import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

/** Configurable upload ceilings; bounded to prevent memory exhaustion. */
export const IMAGE_MAX_SIZE_BYTES = env.IMAGE_UPLOAD_MAX_MB * 1024 * 1024;
export const VIDEO_MAX_SIZE_BYTES = env.VIDEO_UPLOAD_MAX_MB * 1024 * 1024;
export const MEDIA_MAX_SIZE_BYTES = Math.max(IMAGE_MAX_SIZE_BYTES, VIDEO_MAX_SIZE_BYTES);
export const VIDEO_MAX_DURATION_SECONDS = env.VIDEO_MAX_DURATION_SECONDS;

export type MediaType = "image" | "video";

export const IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export const VIDEO_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
]);

export const MEDIA_MIME_TYPES: ReadonlyMap<string, string> = new Map([...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES]);

const IMAGE_EXTENSIONS = new Set([...IMAGE_MIME_TYPES.values(), "jpeg"]);
const VIDEO_EXTENSIONS = new Set(VIDEO_MIME_TYPES.values());
const MEDIA_KEY_PATTERN = /^uploads\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]+\.(jpg|jpeg|png|webp|gif|mp4|webm)$/;

export interface CloudflareUploadedImage {
  imageId: string;
  url: string;
}

export interface MediaInspection {
  mediaType: MediaType;
  mimeType: string;
  durationMs: number | null;
  sizeBytes: number;
  extension: string;
}

export function isCloudflareConfigured(): boolean {
  return env.cloudflareR2Configured;
}

function assertCloudflareConfigured(): void {
  if (!isCloudflareConfigured()) {
    throw new ApiError(503, "Media storage is not configured on this server. Set the Cloudflare R2 variables.");
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
  if (!MEDIA_KEY_PATTERN.test(objectKey)) {
    throw new ApiError(400, "Invalid media storage key.");
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
    return MEDIA_KEY_PATTERN.test(key) ? key : null;
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

function extensionOf(imageId: string): string {
  return imageId.slice(imageId.lastIndexOf(".") + 1).toLowerCase();
}

export function mediaTypeFromImageId(imageId: string): MediaType {
  return VIDEO_EXTENSIONS.has(extensionOf(imageId)) ? "video" : "image";
}

export function mimeTypeFromImageId(imageId: string): string | null {
  const extension = extensionOf(imageId);
  for (const [mime, candidate] of MEDIA_MIME_TYPES) {
    if (candidate === extension || (extension === "jpeg" && candidate === "jpg")) return mime;
  }
  return null;
}

function sniffMediaFormat(buffer: Buffer): { mediaType: MediaType; extension: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { mediaType: "image", extension: "jpg" };
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a)
    return { mediaType: "image", extension: "png" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    return { mediaType: "image", extension: "webp" };
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4).startsWith("GIF"))
    return { mediaType: "image", extension: "gif" };
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp")
    return { mediaType: "video", extension: "mp4" };
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  )
    return { mediaType: "video", extension: "webm" };
  return null;
}

interface BoxRange {
  start: number;
  end: number;
}

function findMp4Box(buffer: Buffer, start: number, end: number, type: string): BoxRange | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const boxType = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) return null;
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(end - offset)) return null;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) return null;
    if (boxType === type) return { start: offset + headerSize, end: offset + size };
    offset += size;
  }
  return null;
}

/** Reads the duration from an MP4/MOV `mvhd` box without external tools. */
export function readMp4DurationSeconds(buffer: Buffer): number | null {
  const moov = findMp4Box(buffer, 0, buffer.length, "moov");
  if (!moov) return null;
  const mvhd = findMp4Box(buffer, moov.start, moov.end, "mvhd");
  if (!mvhd) return null;

  const version = buffer[mvhd.start];
  if (version === 0) {
    if (mvhd.start + 20 > mvhd.end) return null;
    const timescale = buffer.readUInt32BE(mvhd.start + 12);
    const duration = buffer.readUInt32BE(mvhd.start + 16);
    return timescale > 0 ? duration / timescale : null;
  }
  if (version === 1) {
    if (mvhd.start + 32 > mvhd.end) return null;
    const timescale = buffer.readUInt32BE(mvhd.start + 20);
    const duration = buffer.readBigUInt64BE(mvhd.start + 24);
    return timescale > 0 ? Number(duration) / timescale : null;
  }
  return null;
}

interface EbmlValue {
  value: number;
  length: number;
  unknown?: boolean;
}

function readEbmlId(buffer: Buffer, offset: number): EbmlValue | null {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  if (first === undefined) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 4 || offset + length > buffer.length) return null;

  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + (buffer[offset + index] ?? 0);
  return { value, length };
}

function readEbmlSize(buffer: Buffer, offset: number): EbmlValue | null {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  if (first === undefined) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > buffer.length) return null;

  let value = first & (mask - 1);
  let unknown = value === mask - 1;
  for (let index = 1; index < length; index += 1) {
    const byte = buffer[offset + index] ?? 0;
    value = value * 256 + byte;
    unknown = unknown && byte === 0xff;
  }
  return { value, length, unknown };
}

function readEbmlFloat(buffer: Buffer, offset: number, size: number): number | null {
  if (size === 4 && offset + 4 <= buffer.length) return buffer.readFloatBE(offset);
  if (size === 8 && offset + 8 <= buffer.length) return buffer.readDoubleBE(offset);
  return null;
}

/** Reads the duration from a WebM `Info` element without external tools. */
export function readWebmDurationSeconds(buffer: Buffer): number | null {
  const infoMarker = Buffer.from([0x15, 0x49, 0xa9, 0x66]);
  const infoIndex = buffer.indexOf(infoMarker);
  if (infoIndex < 0) return null;

  const infoSize = readEbmlSize(buffer, infoIndex + infoMarker.length);
  if (!infoSize || infoSize.unknown) return null;
  const infoStart = infoIndex + infoMarker.length + infoSize.length;
  const infoEnd = infoStart + infoSize.value;
  if (infoEnd > buffer.length) return null;

  let offset = infoStart;
  let timecodeScale = 1_000_000;
  let duration: number | null = null;

  while (offset < infoEnd) {
    const id = readEbmlId(buffer, offset);
    if (!id) return null;
    const size = readEbmlSize(buffer, offset + id.length);
    if (!size || size.unknown) return null;

    const dataStart = offset + id.length + size.length;
    const dataEnd = dataStart + size.value;
    if (dataEnd > infoEnd) return null;

    if (id.value === 0x2ad7b1 && size.value > 0 && size.value <= 8) {
      timecodeScale = 0;
      for (let index = 0; index < size.value; index += 1)
        timecodeScale = timecodeScale * 256 + (buffer[dataStart + index] ?? 0);
    } else if (id.value === 0x4489) {
      duration = readEbmlFloat(buffer, dataStart, size.value);
    }
    offset = dataEnd;
  }

  if (duration === null || timecodeScale <= 0) return null;
  return (duration * timecodeScale) / 1_000_000_000;
}

export function readVideoDurationSeconds(buffer: Buffer): number | null {
  const format = sniffMediaFormat(buffer);
  if (format?.extension === "mp4") return readMp4DurationSeconds(buffer);
  if (format?.extension === "webm") return readWebmDurationSeconds(buffer);
  return null;
}

/**
 * Validates an uploaded image or short video and returns the metadata that is
 * safe to persist. The duration is read from the container itself, so a client
 * cannot lie about a video being five seconds long.
 */
export function inspectMedia(file: { buffer: Buffer; contentType: string; originalname: string }): MediaInspection {
  if (file.buffer.length === 0) throw new ApiError(400, "The uploaded file is empty.");

  const expectedExtension = MEDIA_MIME_TYPES.get(file.contentType);
  if (!expectedExtension) {
    throw new ApiError(400, "Unsupported media type. Supported formats: JPEG, PNG, WebP, GIF, MP4, WebM.");
  }

  const sniffed = sniffMediaFormat(file.buffer);
  if (!sniffed || sniffed.extension !== expectedExtension) {
    throw new ApiError(400, "The media content does not match its declared type.");
  }

  const filename = sanitizeFilename(file.originalname).toLowerCase();
  const filenameExtension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
  const validExtensions = sniffed.mediaType === "image" ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  if (filenameExtension.length > 0 && !validExtensions.has(filenameExtension)) {
    throw new ApiError(400, "The file extension conflicts with the media type.");
  }

  if (sniffed.mediaType === "image") {
    if (file.buffer.length > IMAGE_MAX_SIZE_BYTES) {
      throw new ApiError(413, `Image file too large. Maximum size is ${env.IMAGE_UPLOAD_MAX_MB} MB.`);
    }
    return {
      mediaType: "image",
      mimeType: file.contentType,
      durationMs: null,
      sizeBytes: file.buffer.length,
      extension: expectedExtension,
    };
  }

  if (file.buffer.length > VIDEO_MAX_SIZE_BYTES) {
    throw new ApiError(413, `Video file too large. Maximum size is ${env.VIDEO_UPLOAD_MAX_MB} MB.`);
  }
  const durationSeconds = readVideoDurationSeconds(file.buffer);
  if (durationSeconds === null) {
    throw new ApiError(400, "Unable to verify the video duration. Use a valid MP4 or WebM file.");
  }
  if (durationSeconds > VIDEO_MAX_DURATION_SECONDS + 0.05) {
    throw new ApiError(400, `Video must be ${VIDEO_MAX_DURATION_SECONDS} seconds or shorter.`);
  }

  return {
    mediaType: "video",
    mimeType: file.contentType,
    durationMs: Math.round(durationSeconds * 1000),
    sizeBytes: file.buffer.length,
    extension: expectedExtension,
  };
}

export function assertSupportedMedia(file: {
  buffer: Buffer;
  contentType: string;
  originalname: string;
}): MediaInspection {
  return inspectMedia(file);
}

export function assertSupportedImage(file: { buffer: Buffer; contentType: string; originalname: string }): void {
  const inspection = inspectMedia(file);
  if (inspection.mediaType !== "image") {
    throw new ApiError(400, "A video cannot be used as an image.");
  }
}

export async function uploadCloudflareImage(input: {
  buffer: Buffer;
  contentType: string;
  filename?: string;
}): Promise<CloudflareUploadedImage> {
  assertCloudflareConfigured();
  const extension = MEDIA_MIME_TYPES.get(input.contentType);
  if (!extension) throw new ApiError(400, "Unsupported media type.");

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
      throw new ApiError(503, "Media storage is misconfigured. The R2 bucket name must be lowercase.");
    }
    throw new ApiError(502, "Media upload failed");
  }

  return { imageId: objectKey, url: buildDeliveryUrl(objectKey) };
}

export async function deleteCloudflareImage(objectKey: string): Promise<void> {
  assertCloudflareConfigured();
  if (!MEDIA_KEY_PATTERN.test(objectKey)) return;
  try {
    await storageClient().send(
      new DeleteObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: objectKey,
      }),
    );
  } catch (error) {
    logger.error({ err: error, objectKey }, "Cloudflare R2 deletion failed");
    throw new ApiError(502, "Media deletion failed");
  }
}
