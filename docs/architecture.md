# Backend Architecture

## Stack

- Node.js 22.x (ESM), TypeScript
- Express 5, Mongoose 9 (MongoDB)
- Socket.IO 4 (realtime)
- Zod 4, jsonwebtoken, pino/pino-http
- Multer + Cloudflare R2 (AWS S3 SDK)

## App structure

- `src/app.ts` - `createApp()` factory, separate from process startup so tests
  can run the API without listening. Middleware order: Helmet, CORS
  (`corsOptions`), JSON parser with a 10 KB limit, request logging via
  `pino-http` with safe serializers, `x-request-id`, routes under `/api`, 404
  handler, centralized error handler.
- `src/server.ts` - connects MongoDB, creates the HTTP server, calls
  `initRealtime(server)`, listens on `env.HOST:env.PORT`, and handles graceful
  shutdown (close realtime, close server, disconnect DB, force exit after
  10 seconds).
- `src/routes/index.ts` - central API router mounts `/v1`.
- `src/routes/v1/index.ts` and role routers under `src/routes/admin/` (auth,
  app-admin, coffee-admin, images).

## Routing layout

- Public: `GET /api/v1/coffees/:coffeeSlug`,
  `GET /api/v1/categories/:categoryId/items`,
  `GET /api/v1/coffees/:coffeeSlug/offers`, and `/api/v1/orders` endpoints.
- Admin auth: `POST /api/v1/admin/auth/app`,
  `POST /api/v1/admin/auth/coffee/:coffeeSlug` (PIN -> JWT).
- App admin: `/api/v1/admin/coffees/*` and `GET /api/v1/admin/insights`
  (requires `requireAdmin` + `requireAppAdmin`).
- Coffee admin: `/api/v1/admin/my-coffee/*` (requires `requireAdmin` +
  `requireCoffeeAdmin`, scoped to `token.coffeeId`).
- Images: `/api/v1/admin/images/*` (both roles, ownership enforced).
- System: `GET /`, `GET /health`, `GET /health/ready`.

## Layering

- Controllers serialize responses with `sendSuccess`/`sendCreated` and forward
  errors with `next(error)`.
- Services own business rules: pricing, stock reservation/compensation,
  shifts/sessions/tables, order transitions.
- Repositories own Mongo query composition and tenant scoping.
- Models define schemas, validators, and indexes.
- DTOs/types in `src/types/*` define API shapes.
- Zod schemas in `src/validators/*` are applied by the
  `validate({ params, body, query })` middleware.
- Ownership is always derived from the verified token for coffee-admin routes;
  client-supplied ownership is not trusted.
- Prices and totals are computed server-side. Order lines store snapshots.
- Migrations own database validators and indexes. Do not rely on Mongoose
  `autoIndex` for production deployment.

## Realtime

Socket.IO is attached to the HTTP server in a single process. Admin handshakes
may carry a JWT; anonymous clients may subscribe only to rooms they can prove
ownership of. Rooms are `order:{orderId}` and `session:{tableSessionId}`.
Server events are `order:new` and `order:updated`. See
[realtime.md](./realtime.md).

## Logging and errors

- Pino with `pino-http` and safe serializers; `x-request-id` is attached to
  responses.
- `ApiError(status, message, details?)` is the operational error type.
- The central error middleware maps `ApiError`, ZodError (400 with
  `{ field, message }[]`), Mongoose `CastError` (400 "Invalid identifier"),
  and Mongoose `ValidationError` (400 "Validation failed"). Stack traces are
  not exposed.
