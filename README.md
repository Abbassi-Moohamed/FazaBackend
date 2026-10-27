# Faza Backend

Express 5 + Mongoose API for the Faza QR-menu platform. It serves the public
menu and visitor ordering flow, two PIN-authenticated backoffice roles,
table-session/service-shift operations, daily offers, media uploads, analytics,
and Socket.IO order updates.

Current, code-grounded documentation lives in [`docs/`](docs/README.md).

## Stack

- Node.js 22.x, ESM, TypeScript
- Express 5, Mongoose 9 / MongoDB
- Zod 4, jsonwebtoken, Helmet, CORS, pino / pino-http
- Socket.IO 4
- Multer + AWS S3 SDK against Cloudflare R2
- ffmpeg-static for server-side video trimming

## Local development

```powershell
copy .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

The API listens on `http://localhost:4000` by default. The seed is destructive
and recreates the sample coffees with coffee-admin PIN `0000`. The development
app-admin PIN is `3219` unless overridden.

Production requires an explicit `ADMIN_SECRET`, real CORS origins, a production
`DATABASE_URL`, and migrations applied before the process starts.

## Request pipeline

1. `server.ts` connects MongoDB, creates the HTTP server, attaches Socket.IO,
   and listens.
2. `app.ts` applies Helmet, CORS, a 10 KB JSON body limit, request logging,
   and `x-request-id`.
3. Routes mount under `/api/v1`.
4. `validate({params, body, query})` checks Zod schemas.
5. Controllers call services; services apply business rules and call
   repositories; repositories own Mongo queries.
6. Responses use `{ success: true, data }`. Errors use
   `{ success: false, message, details? }` and are serialized centrally.

Coffee-admin routes derive the tenant from the verified token
(`req.admin.coffeeId`), never from client-supplied ownership fields.

## Main API groups

- Public menu: `GET /api/v1/coffees/:coffeeSlug`,
  `GET /api/v1/categories/:categoryId/items`,
  `GET /api/v1/coffees/:coffeeSlug/offers`
- Public orders: `POST /api/v1/orders`,
  `GET /api/v1/orders?sessionToken=...`,
  `GET /api/v1/orders/:orderId`
- Admin auth: `POST /api/v1/admin/auth/app`,
  `POST /api/v1/admin/auth/coffee/:coffeeSlug`
- App admin: `/api/v1/admin/coffees/*`,
  `GET /api/v1/admin/insights`
- Coffee admin: `/api/v1/admin/my-coffee/*` (menu, offers, orders, shifts,
  table sessions, tables, insights)
- Images: `/api/v1/admin/images/*`
- Health: `GET /health`, `GET /health/ready`

See [`docs/api-contracts.md`](docs/api-contracts.md) for request details and
[`docs/admin-backoffice.md`](docs/admin-backoffice.md) for operational routes.

## Scripts

```text
npm run dev          tsx watch src/server.ts
npm run build        tsc + build-info stamp
npm start            run dist/server.js
npm run typecheck    tsc --noEmit
npm run lint         ESLint
npm run format       Prettier write
npm run format:check Prettier check
npm run db:migrate   apply ordered migrations
npm run db:seed      destructive local seed
npm test             Vitest
npm run test:watch   Vitest watch
npm run smoke        scripts/smoke.mjs
npm run deploy       scripts/deploy-render.mjs
npm run check        typecheck + tests
```

## Data and migrations

Mongoose models define schemas; migrations own database validators and indexes.
Migrations are registered by side effects: each numbered file pushes into the
shared `migrations` array exported by `src/db/migrations/index.ts`.

The sequence covers initial menu collections, admin PIN, images, category and
cover images, availability/promotions, orders, order contract, table
sessions/service shifts, payment, category-name uniqueness, multiple sessions
per table, and daily offers.

Run `npm run db:migrate` before starting a production release. Do not rely on
Mongoose `autoIndex`.

## Documentation map

- [Architecture](docs/architecture.md)
- [Auth & RBAC](docs/auth.md)
- [API contracts](docs/api-contracts.md)
- [Data model & migrations](docs/data-model.md)
- [Ordering & offers](docs/ordering-offers.md)
- [Admin backoffice](docs/admin-backoffice.md)
- [Images & storage](docs/images-storage.md)
- [Realtime](docs/realtime.md)
- [Config & environment](docs/config-env.md)
- [Testing & CI](docs/testing-ci.md)
- [Known limitations & defects](docs/known-limitations.md)

`ROUTES.md` is a legacy file and is not the authoritative route reference.
