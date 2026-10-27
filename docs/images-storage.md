# Media & Storage

## Upload flow

- Endpoint: `POST /api/v1/admin/images`
- Content type: `multipart/form-data`, field name `file`
- Both admin roles may upload.
- Accepted types: JPEG, PNG, WebP, GIF, MP4, and WebM. The backend validates
  both the declared MIME type and the file's magic bytes; the declared type and
  detected container must agree.
- Maximum size: `IMAGE_UPLOAD_MAX_MB` (default 25 MB, maximum 100 MB) for
  images and `VIDEO_UPLOAD_MAX_MB` (default 15 MB, maximum 100 MB) for videos.
  Multer rejects anything above the larger of the two caps before validation.
- Videos longer than `VIDEO_MAX_DURATION_SECONDS` (default 5, maximum 60) are
  trimmed server-side to their first N seconds with the bundled `ffmpeg-static`
  binary. The trimmed video is normalized to MP4/H.264/AAC, capped at 1280 px,
  stripped of container metadata, and re-checked against the video size limit.
- Videos already within the duration budget are stored byte-for-byte; their
  container (MP4 or WebM) is preserved. A video whose duration cannot be read
  from the container is rejected with 400.
- Trimming runs without a shell, in an OS temp directory that is always
  removed. A 30-second timeout returns 504; ffmpeg failures return 502. If the
  ffmpeg binary is unavailable, short videos still upload and only over-long
  videos return 503.
- Binary storage: Cloudflare R2 through the AWS S3 SDK.
- MongoDB stores metadata and delivery URLs only, never binaries.
- Success response (201): `{ imageId, url, mediaType, mimeType, durationMs }`;
  R2 credentials are never exposed.

## Assigning media

The returned `url` can be supplied as a coffee `logo`/`cover`, category
`image`, item `image`, or offer `image`. Item galleries (`items[].media`) also
accept video entries. When the URL corresponds to a managed R2 object, the
backend records the `imageId` on the entity for ownership and cleanup. External
URLs remain supported (and are always treated as images).

## Deletion and ownership

- `DELETE /api/v1/admin/images/:imageId`
- App admin may delete any image.
- Coffee admin may delete an image uploaded by their own coffee or still
  referenced by their own coffee/items; otherwise 403.
- Unknown image: 404. Malformed ID: 400. R2 unavailable: 502/503.
- An image still referenced by a blocked coffee's rows is not deleted
  automatically. Cleanup occurs when the referencing entity is removed or
  replaced (`image.service.ts` / `cloudflare-images.service.ts`).

## Required configuration

All of the following must be set for managed uploads:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`
- `CLOUDFLARE_R2_ENDPOINT`
- `CLOUDFLARE_R2_PUBLIC_URL`

`env.cloudflareR2Configured` is true only when all required values are present.

Upload ceilings are controlled by `IMAGE_UPLOAD_MAX_MB`,
`VIDEO_UPLOAD_MAX_MB`, and `VIDEO_MAX_DURATION_SECONDS`. The trimmer ships in
`ffmpeg-static`; keep its install script enabled so the binary is downloaded
during `npm ci`.
