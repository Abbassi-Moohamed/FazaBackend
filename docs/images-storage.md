# Images & Storage

## Upload flow

- Endpoint: `POST /api/v1/admin/images`
- Content type: `multipart/form-data`, field name `file`
- Both admin roles may upload.
- Accepted types: JPEG, PNG, WebP, GIF. The backend validates both the declared
  MIME type and the file's magic bytes.
- Maximum size: `IMAGE_UPLOAD_MAX_MB` (default 25 MB, maximum 100 MB).
- Binary storage: Cloudflare R2 through the AWS S3 SDK.
- MongoDB stores metadata and delivery URLs only, never binaries.
- Success response (201): `{ imageId, url }`; R2 credentials are never exposed.

## Assigning images

The returned `url` can be supplied as a coffee `logo`/`cover`, category
`image`, item `image`, or offer `image`. When the URL corresponds to a managed
R2 object, the backend records the `imageId` on the entity for ownership and
cleanup. External URLs remain supported.

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
