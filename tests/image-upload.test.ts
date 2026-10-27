import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";

// Mock only the Cloudflare network calls; keep the real validation helpers
// (mime/magic-byte checks, delivery-URL parsing) so the whole file contract is
// exercised against a fake Cloudflare.
let mockImageCounter = 0;

vi.mock("../src/services/cloudflare-images.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/cloudflare-images.service.js")>();
  return {
    ...actual,
    uploadCloudflareImage: vi.fn(async (): Promise<{ imageId: string; url: string }> => {
      mockImageCounter += 1;
      const imageId = `fake-image-${mockImageCounter}`;
      return { imageId, url: `https://imagedelivery.net/testhash/${imageId}/public` };
    }),
    deleteCloudflareImage: vi.fn(async (): Promise<void> => undefined),
  };
});

import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { mongoose } from "../src/db/index.js";
import { ImageModel } from "../src/models/image.model.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";
import {
  deleteCloudflareImage,
  IMAGE_MAX_SIZE_BYTES,
  readVideoDurationSeconds,
  uploadCloudflareImage,
} from "../src/services/cloudflare-images.service.js";
import type { AdminAuthDto, AdminImageDto, AdminItemDto, CoffeeWithCategoriesDto } from "../src/types/index.js";

const execFileAsync = promisify(execFile);
const ffmpegPath = ffmpegStatic as unknown as string | null;

const APP_PIN = "3219";
const DEFAULT_COFFEE_PIN = "0000";
const deliveryUrl = (imageId: string) => `https://imagedelivery.net/testhash/${imageId}/public`;

function pngBuffer(extra = 32): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 1)]);
}

const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]);
const textBuffer = Buffer.from("definitely not an image", "utf8");

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function mp4Buffer(durationSeconds = 3, timescale = 1000): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt8(0, 0);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(durationSeconds * timescale), 16);
  return Buffer.concat([box("ftyp", Buffer.from("isom0000", "ascii")), box("moov", box("mvhd", mvhd))]);
}

async function realVideoBuffer(durationSeconds: number, format: "mp4" | "webm" = "mp4"): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary is unavailable");
  }

  const directory = await mkdtemp(join(tmpdir(), "faza-test-video-"));
  const outputPath = join(directory, `clip.${format}`);
  const codecArgs =
    format === "webm"
      ? ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "200k"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc=duration=${durationSeconds}:size=160x120:rate=10`,
      ...codecArgs,
      "-y",
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function realMp4Buffer(durationSeconds: number): Promise<Buffer> {
  return realVideoBuffer(durationSeconds, "mp4");
}

describe("Faza image uploads (Cloudflare R2)", () => {
  let testDb: TestDatabase;
  let app: Express;

  beforeAll(async () => {
    testDb = await setupTestDatabase();
    app = createApp();
    await seedDatabase();
  });

  beforeEach(async () => {
    await seedDatabase();
    await ImageModel.deleteMany({});
    mockImageCounter = 0;
    vi.mocked(uploadCloudflareImage).mockClear();
    vi.mocked(deleteCloudflareImage).mockClear();
  });

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  // ---- helpers -------------------------------------------------------------

  async function appToken(): Promise<string> {
    const response = await request(app).post("/api/v1/admin/auth/app").send({ pin: APP_PIN });
    expect(response.status).toBe(200);
    return (response.body.data as AdminAuthDto).token;
  }

  async function coffeeToken(slug: string, pin: string = DEFAULT_COFFEE_PIN): Promise<string> {
    const response = await request(app).post(`/api/v1/admin/auth/coffee/${slug}`).send({ pin });
    expect(response.status).toBe(200);
    return (response.body.data as AdminAuthDto).token;
  }

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];

  async function uploadAs(
    token: string,
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<request.Response> {
    return request(app)
      .post("/api/v1/admin/images")
      .set(...bearer(token))
      .attach("file", buffer, { filename, contentType });
  }

  async function publicCoffee(slug: string): Promise<CoffeeWithCategoriesDto> {
    const response = await request(app).get(`/api/v1/coffees/${slug}`);
    expect(response.status).toBe(200);
    return response.body.data as CoffeeWithCategoriesDto;
  }

  async function categoryIdOf(slug: string, name: string): Promise<string> {
    const coffee = await publicCoffee(slug);
    const category = coffee.categories.find((candidate) => candidate.name === name);
    expect(category).toBeDefined();
    return category!.id;
  }

  async function firstCategoryId(slug: string): Promise<string> {
    const coffee = await publicCoffee(slug);
    expect(coffee.categories.length).toBeGreaterThan(0);
    return coffee.categories[0]!.id;
  }

  // ---- upload authorization & validation ------------------------------------

  describe("upload endpoint", () => {
    it("rejects uploads without a token (401)", async () => {
      const response = await request(app)
        .post("/api/v1/admin/images")
        .attach("file", pngBuffer(), { filename: "logo.png", contentType: "image/png" });
      expect(response.status).toBe(401);
    });

    it("uploads a PNG for a coffee admin and returns clean metadata", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await uploadAs(token, pngBuffer(), "logo.png", "image/png");

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      const image = response.body.data as AdminImageDto;
      expect(image.imageId).toBe("fake-image-1");
      expect(image.url).toBe(deliveryUrl("fake-image-1"));
      expect(image.mediaType).toBe("image");
      expect(image.mimeType).toBe("image/png");
      expect(image.durationMs).toBeNull();

      // Never leak credentials — the response only carries safe metadata.
      expect(Object.keys(response.body.data).sort()).toEqual(["durationMs", "imageId", "mediaType", "mimeType", "url"]);

      expect(JSON.stringify(response.body)).not.toMatch(
        /access_key|secret_access_key|CLOUDFLARE_R2_SECRET_ACCESS_KEY/i,
      );

      // Metadata recorded in MongoDB only (no binary is stored).
      const doc = await ImageModel.findOne({ imageId: "fake-image-1" }).lean().exec();
      expect(doc).not.toBeNull();
      expect(doc!.ownerType).toBe("COFFEE");
      expect(doc!.url).toBe(deliveryUrl("fake-image-1"));
      expect(vi.mocked(uploadCloudflareImage)).toHaveBeenCalledTimes(1);
    });

    it("marks app-admin uploads as unassigned (APP owned)", async () => {
      const token = await appToken();
      const response = await uploadAs(token, pngBuffer(), "logo.png", "image/png");
      expect(response.status).toBe(201);

      const doc = await ImageModel.findOne({ imageId: "fake-image-1" }).lean().exec();
      expect(doc!.ownerType).toBe("APP");
      expect(doc!.coffeeId).toBeNull();
    });

    it("accepts JPEGs as well (magic-byte match)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await uploadAs(token, jpegBuffer, "photo.jpg", "image/jpeg");
      expect(response.status).toBe(201);
      expect((response.body.data as AdminImageDto).imageId).toBe("fake-image-1");
    });

    it("accepts a short MP4 unchanged and records its duration", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const original = mp4Buffer(3);
      const response = await uploadAs(token, original, "clip.mp4", "video/mp4");

      expect(response.status).toBe(201);
      const media = response.body.data as AdminImageDto;
      expect(media.mediaType).toBe("video");
      expect(media.mimeType).toBe("video/mp4");
      expect(media.durationMs).toBe(3000);

      // Videos within the budget are uploaded byte-for-byte (no re-encode).
      const uploadCall = vi.mocked(uploadCloudflareImage).mock.calls[0]?.[0];
      expect(uploadCall).toBeDefined();
      expect(uploadCall!.buffer.equals(original)).toBe(true);

      const doc = await ImageModel.findOne({ imageId: "fake-image-1" }).lean().exec();
      expect(doc!.mediaType).toBe("video");
      expect(doc!.mimeType).toBe("video/mp4");
      expect(doc!.durationMs).toBe(3000);
      expect(doc!.sizeBytes).toBe(original.length);
    });

    it("keeps a video that is exactly at the duration limit", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const original = mp4Buffer(5);
      const response = await uploadAs(token, original, "exact.mp4", "video/mp4");

      expect(response.status).toBe(201);
      expect((response.body.data as AdminImageDto).durationMs).toBe(5000);

      const uploadCall = vi.mocked(uploadCloudflareImage).mock.calls[0]?.[0];
      expect(uploadCall).toBeDefined();
      expect(uploadCall!.buffer.equals(original)).toBe(true);
    });

    it("trims a video longer than five seconds to the first five seconds", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await uploadAs(token, await realMp4Buffer(6), "long.mp4", "video/mp4");

      expect(response.status).toBe(201);
      const media = response.body.data as AdminImageDto;
      expect(media.mediaType).toBe("video");
      expect(media.mimeType).toBe("video/mp4");
      expect(media.durationMs).toBeGreaterThan(4500);
      expect(media.durationMs).toBeLessThanOrEqual(5000);

      const uploadCall = vi.mocked(uploadCloudflareImage).mock.calls[0]?.[0];
      expect(uploadCall).toBeDefined();
      expect(uploadCall!.contentType).toBe("video/mp4");
      expect(uploadCall!.filename).toBe("long.mp4");

      const trimmedDuration = readVideoDurationSeconds(uploadCall!.buffer);
      expect(trimmedDuration).not.toBeNull();
      expect(trimmedDuration!).toBeGreaterThan(4.5);
      expect(trimmedDuration!).toBeLessThanOrEqual(5.05);

      const doc = await ImageModel.findOne({ imageId: "fake-image-1" }).lean().exec();
      expect(doc!.mediaType).toBe("video");
      expect(doc!.mimeType).toBe("video/mp4");
      expect(doc!.durationMs).toBeLessThanOrEqual(5000);
      expect(doc!.sizeBytes).toBe(uploadCall!.buffer.length);
    });

    it("normalizes an over-long WebM to a trimmed MP4", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await uploadAs(token, await realVideoBuffer(6, "webm"), "long.webm", "video/webm");

      expect(response.status).toBe(201);
      const media = response.body.data as AdminImageDto;
      expect(media.mediaType).toBe("video");
      expect(media.mimeType).toBe("video/mp4");

      const uploadCall = vi.mocked(uploadCloudflareImage).mock.calls[0]?.[0];
      expect(uploadCall).toBeDefined();
      expect(uploadCall!.contentType).toBe("video/mp4");
      expect(uploadCall!.filename).toBe("long.mp4");

      const trimmedDuration = readVideoDurationSeconds(uploadCall!.buffer);
      expect(trimmedDuration).not.toBeNull();
      expect(trimmedDuration!).toBeGreaterThan(4.5);
      expect(trimmedDuration!).toBeLessThanOrEqual(5.05);

      const doc = await ImageModel.findOne({ imageId: "fake-image-1" }).lean().exec();
      expect(doc!.mimeType).toBe("video/mp4");
      expect(doc!.filename).toBe("long.mp4");
    });

    it("rejects a video whose duration cannot be verified (400)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const invalidMp4 = Buffer.concat([box("ftyp", Buffer.from("isom0000", "ascii")), Buffer.alloc(32)]);
      const response = await uploadAs(token, invalidMp4, "broken.mp4", "video/mp4");

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/Unable to verify the video duration/);
      expect(vi.mocked(uploadCloudflareImage)).not.toHaveBeenCalled();
    });

    it("rejects unsupported MIME types (400)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await uploadAs(token, textBuffer, "notes.txt", "text/plain");
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/Unsupported media type/);
      expect(vi.mocked(uploadCloudflareImage)).not.toHaveBeenCalled();
    });

    it("rejects a file whose content does not match its declared type (400)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await uploadAs(token, textBuffer, "fake.png", "image/png");
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/does not match/);
      expect(vi.mocked(uploadCloudflareImage)).not.toHaveBeenCalled();
    });

    it("rejects an oversized image (413)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const bigBuffer = Buffer.alloc(IMAGE_MAX_SIZE_BYTES + 1);
      pngBuffer(0).copy(bigBuffer, 0);
      const response = await uploadAs(token, bigBuffer, "big.png", "image/png");
      expect(response.status).toBe(413);
      expect(vi.mocked(uploadCloudflareImage)).not.toHaveBeenCalled();
    });

    it("rejects a request with no file (400)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await request(app)
        .post("/api/v1/admin/images")
        .set(...bearer(token));
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/No image file/);
    });
  });

  // ---- deletion & ownership --------------------------------------------------

  describe("delete endpoint", () => {
    it("rejects deletion without a token (401)", async () => {
      const response = await request(app).delete("/api/v1/admin/images/fake-image-1");
      expect(response.status).toBe(401);
    });

    it("returns 404 for an unknown image id", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await request(app)
        .delete("/api/v1/admin/images/does-not-exist")
        .set(...bearer(token));
      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Image not found");
    });

    it("lets a coffee admin delete their own uploaded image", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      await uploadAs(token, pngBuffer(), "logo.png", "image/png");

      const response = await request(app)
        .delete("/api/v1/admin/images/fake-image-1")
        .set(...bearer(token));
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ id: "fake-image-1" });
      expect(vi.mocked(deleteCloudflareImage)).toHaveBeenCalledWith("fake-image-1");
      expect(await ImageModel.exists({ imageId: "fake-image-1" })).toBeNull();
    });

    it("forbids a coffee admin from deleting another coffee's image (403)", async () => {
      const tokenA = await coffeeToken("cafe-el-manzah");
      const tokenB = await coffeeToken("brew-and-beans");
      await uploadAs(tokenA, pngBuffer(), "logo.png", "image/png");

      const response = await request(app)
        .delete("/api/v1/admin/images/fake-image-1")
        .set(...bearer(tokenB));
      expect(response.status).toBe(403);
      expect(vi.mocked(deleteCloudflareImage)).not.toHaveBeenCalled();
    });

    it("lets the app admin delete any image", async () => {
      const coffeeTokenA = await coffeeToken("cafe-el-manzah");
      await uploadAs(coffeeTokenA, pngBuffer(), "logo.png", "image/png");

      const appTokenValue = await appToken();
      const response = await request(app)
        .delete("/api/v1/admin/images/fake-image-1")
        .set(...bearer(appTokenValue));
      expect(response.status).toBe(200);
      expect(vi.mocked(deleteCloudflareImage)).toHaveBeenCalledWith("fake-image-1");
    });
  });

  // ---- entity attachment, replacement and cleanup ----------------------------

  describe("entity image lifecycle", () => {
    it("records the Cloudflare image id when an item uses a delivery URL", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      await uploadAs(token, pngBuffer(), "photo.png", "image/png");
      const categoryId = await categoryIdOf("cafe-el-manzah", "Cafés");

      const created = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({ name: "Café Test", price: 2.5, image: deliveryUrl("fake-image-1") });
      expect(created.status).toBe(201);

      const itemId = (created.body.data as AdminItemDto).id;
      const raw = await mongoose.connection.collection("items").findOne({ _id: new mongoose.Types.ObjectId(itemId) });
      expect(raw!.image).toBe(deliveryUrl("fake-image-1"));
      expect(raw!.imageId).toBe("fake-image-1");
      expect(raw!.media).toEqual([
        {
          imageId: "fake-image-1",
          url: deliveryUrl("fake-image-1"),
          type: "image",
          mimeType: null,
          durationMs: null,
          alt: null,
        },
      ]);

      // No binary image data is ever written to MongoDB.
      expect(Object.values(raw ?? {}).some((value) => Buffer.isBuffer(value))).toBe(false);
    });

    it("stores an ordered item gallery with server-trusted media types", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const categoryId = await firstCategoryId("cafe-el-manzah");

      await uploadAs(token, pngBuffer(), "cover.png", "image/png"); // fake-image-1
      await uploadAs(token, mp4Buffer(4), "clip.mp4", "video/mp4"); // fake-image-2
      await uploadAs(token, pngBuffer(), "detail.png", "image/png"); // fake-image-3

      const created = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({
          name: "Gallery",
          price: 4,
          media: [
            { url: deliveryUrl("fake-image-1"), alt: "Vue de face" },
            { url: deliveryUrl("fake-image-2") },
            { url: deliveryUrl("fake-image-3") },
          ],
        });
      expect(created.status).toBe(201);

      const item = created.body.data as AdminItemDto;
      expect(item.media).toHaveLength(3);
      expect(item.media.map((media) => media.type)).toEqual(["image", "video", "image"]);
      expect(item.media[1]!.durationMs).toBe(4000);
      expect(item.media[0]!.alt).toBe("Vue de face");
      expect(item.image).toBe(deliveryUrl("fake-image-1"));

      const raw = await mongoose.connection.collection("items").findOne({ _id: new mongoose.Types.ObjectId(item.id) });
      expect(raw!.media).toHaveLength(3);
      expect(raw!.image).toBe(deliveryUrl("fake-image-1"));
      expect(raw!.imageId).toBe("fake-image-1");
    });

    it("rejects more than five media files (400)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const categoryId = await firstCategoryId("cafe-el-manzah");

      const response = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({
          name: "Too many media",
          price: 1,
          media: Array.from({ length: 6 }, (_, index) => ({
            url: `https://picsum.photos/seed/media-${index}/400/300`,
          })),
        });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toMatch(/at most 5 media/);
    });

    it("replacing the gallery deletes only media that is no longer used", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const categoryId = await firstCategoryId("cafe-el-manzah");

      await uploadAs(token, pngBuffer(), "a.png", "image/png"); // fake-image-1
      await uploadAs(token, pngBuffer(), "b.png", "image/png"); // fake-image-2
      await uploadAs(token, pngBuffer(), "c.png", "image/png"); // fake-image-3

      const created = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({
          name: "Gallery replace",
          price: 2,
          media: [{ url: deliveryUrl("fake-image-1") }, { url: deliveryUrl("fake-image-2") }],
        });
      expect(created.status).toBe(201);
      const itemId = (created.body.data as AdminItemDto).id;

      const updated = await request(app)
        .patch(`/api/v1/admin/my-coffee/items/${itemId}`)
        .set(...bearer(token))
        .send({ media: [{ url: deliveryUrl("fake-image-2") }, { url: deliveryUrl("fake-image-3") }] });

      expect(updated.status).toBe(200);
      expect(vi.mocked(deleteCloudflareImage)).toHaveBeenCalledWith("fake-image-1");
      expect(vi.mocked(deleteCloudflareImage)).not.toHaveBeenCalledWith("fake-image-2");
      expect(vi.mocked(deleteCloudflareImage)).not.toHaveBeenCalledWith("fake-image-3");
      expect(await ImageModel.exists({ imageId: "fake-image-1" })).toBeNull();
      expect(await ImageModel.exists({ imageId: "fake-image-2" })).not.toBeNull();
      expect(await ImageModel.exists({ imageId: "fake-image-3" })).not.toBeNull();
    });

    it("keeps external URLs untouched (imageId stays null)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const categoryId = await categoryIdOf("cafe-el-manzah", "Cafés");

      const created = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({ name: "Café Test", price: 2.5, image: "https://picsum.photos/seed/manzah-x/400/300" });
      expect(created.status).toBe(201);

      const itemId = (created.body.data as AdminItemDto).id;
      const raw = await mongoose.connection.collection("items").findOne({ _id: new mongoose.Types.ObjectId(itemId) });
      expect(raw!.image).toBe("https://picsum.photos/seed/manzah-x/400/300");
      expect(raw!.imageId).toBeNull();
      expect(vi.mocked(deleteCloudflareImage)).not.toHaveBeenCalled();
    });

    it("forbids a coffee admin from attaching another coffee's image (403)", async () => {
      const tokenA = await coffeeToken("cafe-el-manzah");
      await uploadAs(tokenA, pngBuffer(), "photo.png", "image/png");

      const tokenB = await coffeeToken("brew-and-beans");
      const categoryIdB = await categoryIdOf("brew-and-beans", "Cafés");
      const response = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryIdB}/items`)
        .set(...bearer(tokenB))
        .send({ name: "Stolen Image", price: 1, image: deliveryUrl("fake-image-1") });
      expect(response.status).toBe(403);
      expect(await ImageModel.exists({ imageId: "fake-image-1" })).not.toBeNull();
    });

    it("replacing an item image deletes the old Cloudflare image after the new one is saved", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const categoryId = await categoryIdOf("cafe-el-manzah", "Cafés");

      await uploadAs(token, pngBuffer(), "a.png", "image/png"); // fake-image-1
      await uploadAs(token, pngBuffer(), "b.png", "image/png"); // fake-image-2

      const created = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({ name: "Café Test", price: 2.5, image: deliveryUrl("fake-image-1") });
      const itemId = (created.body.data as AdminItemDto).id;

      const updated = await request(app)
        .patch(`/api/v1/admin/my-coffee/items/${itemId}`)
        .set(...bearer(token))
        .send({ image: deliveryUrl("fake-image-2") });

      expect(updated.status).toBe(200);
      expect(vi.mocked(deleteCloudflareImage)).toHaveBeenCalledWith("fake-image-1");
      expect(vi.mocked(deleteCloudflareImage)).not.toHaveBeenCalledWith("fake-image-2");
      expect(await ImageModel.exists({ imageId: "fake-image-1" })).toBeNull();
      expect(await ImageModel.exists({ imageId: "fake-image-2" })).not.toBeNull();
    });

    it("does not delete a Cloudflare image still referenced by another item", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const categoryId = await categoryIdOf("cafe-el-manzah", "Cafés");
      await uploadAs(token, pngBuffer(), "shared.png", "image/png");

      const createItem = async () => {
        const response = await request(app)
          .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
          .set(...bearer(token))
          .send({ name: `Shared ${Date.now()}`, price: 1, image: deliveryUrl("fake-image-1") });
        expect(response.status).toBe(201);
        return (response.body.data as AdminItemDto).id;
      };
      const firstId = await createItem();
      const secondId = await createItem();

      await request(app)
        .delete(`/api/v1/admin/my-coffee/items/${firstId}`)
        .set(...bearer(token));
      expect(vi.mocked(deleteCloudflareImage)).not.toHaveBeenCalled();

      await request(app)
        .delete(`/api/v1/admin/my-coffee/items/${secondId}`)
        .set(...bearer(token));
      expect(vi.mocked(deleteCloudflareImage)).toHaveBeenCalledWith("fake-image-1");
      expect(await ImageModel.exists({ imageId: "fake-image-1" })).toBeNull();
    });

    it("deleting a coffee cleans up its logo and item Cloudflare images", async () => {
      const appTokenValue = await appToken();
      const coffeeTokenValue = await coffeeToken("cafe-el-manzah");

      await uploadAs(appTokenValue, pngBuffer(), "logo.png", "image/png"); // fake-image-1
      await uploadAs(coffeeTokenValue, pngBuffer(), "photo.png", "image/png"); // fake-image-2
      const categoryId = await categoryIdOf("cafe-el-manzah", "Cafés");

      const coffee = await publicCoffee("cafe-el-manzah");
      const createdItem = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(coffeeTokenValue))
        .send({ name: "With Photo", price: 3, image: deliveryUrl("fake-image-2") });
      expect(createdItem.status).toBe(201);

      const updateLogo = await request(app)
        .patch(`/api/v1/admin/coffees/${coffee.id}`)
        .set(...bearer(appTokenValue))
        .send({ logo: deliveryUrl("fake-image-1") });
      expect(updateLogo.status).toBe(200);

      const deleted = await request(app)
        .delete(`/api/v1/admin/coffees/${coffee.id}`)
        .set(...bearer(appTokenValue));
      expect(deleted.status).toBe(200);

      expect(vi.mocked(deleteCloudflareImage).mock.calls.flat()).toContain("fake-image-1");
      expect(vi.mocked(deleteCloudflareImage).mock.calls.flat()).toContain("fake-image-2");
      expect(await ImageModel.countDocuments({})).toBe(0);
    });

    it("never stores image binaries in MongoDB collections", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      await uploadAs(token, pngBuffer(), "photo.png", "image/png");
      const categoryId = await categoryIdOf("cafe-el-manzah", "Cafés");
      await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({ name: "Café Test", price: 2.5, image: deliveryUrl("fake-image-1") });

      for (const collection of ["images", "items", "coffees"] as const) {
        const docs = await mongoose.connection.collection(collection).find({}).toArray();
        for (const doc of docs) {
          expect(Object.values(doc).some((value) => Buffer.isBuffer(value))).toBe(false);
        }
      }
    });
  });
});
