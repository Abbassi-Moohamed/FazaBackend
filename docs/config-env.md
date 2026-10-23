# Config & Environment

## Backend variables

Validated in `src/config/env.ts` against `backend/.env.example`:

- `NODE_ENV`: `development`, `test`, or `production`
- `HOST`, `PORT` (default 4000)
- `IMAGE_UPLOAD_MAX_MB` (default 25, max 100)
- `DATABASE_URL` (required)
- `FRONTEND_URL` (primary CORS origin)
- `CORS_ORIGINS` (comma-separated extras; `*` rejected in production)
- `LOG_LEVEL`
- `APP_ADMIN_PIN` (exactly four digits; static MVP gate)
- `ADMIN_SECRET` (minimum 16 characters; dev default refused in production)
- `ADMIN_TOKEN_TTL` (default `12h`)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`
- `CLOUDFLARE_R2_ENDPOINT`
- `CLOUDFLARE_R2_PUBLIC_URL`
- `GIT_SHA`, `RENDER_GIT_COMMIT` (build identity inputs)

`env.apiPrefix` is `/api`; versioning is centralized by mounting `/v1`.

## Frontend variables

- `BACKEND_API_URL`: server-side API origin for SSR
- `NEXT_PUBLIC_BACKEND_API_URL`: browser-visible API origin

The browser helper in `frontend/src/config/api.ts` overrides a loopback API host
with the page hostname when the app is opened from a non-loopback LAN address.

## Next.js config

`frontend/next.config.ts` currently sets:

- `reactStrictMode: true`
- `allowedDevOrigins: ["192.168.1.146"]`
- `images.unoptimized: true`

## CORS and HTTP hardening

- Helmet is enabled on the backend.
- CORS comes from `src/config/cors.ts`.
- JSON bodies are limited to 10 KB (image uploads use multipart handling).
- `x-request-id` is attached to responses.

## Production requirements

- Set an explicit random `ADMIN_SECRET`.
- Set explicit CORS origins.
- Use a production MongoDB URI.
- Run `npm run db:migrate` before starting the compiled server.
- Never commit `.env` files or R2 credentials.
