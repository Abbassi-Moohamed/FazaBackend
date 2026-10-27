# API Contracts

## Envelopes and base URL

- Local base URL: `http://localhost:4000`
- Version prefix: `/api/v1`
- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "message": "...", "details"?: ... }`

## System

- `GET /` - API overview
- `GET /health` - liveness (includes build info)
- `GET /health/ready` - readiness; 503 when MongoDB is unavailable

## Public menu

- `GET /api/v1/coffees/:coffeeSlug` - coffee and its own categories
- `GET /api/v1/categories/:categoryId/items` - items in one category
- `GET /api/v1/coffees/:coffeeSlug/offers` - purchasable offers

## Visitor orders

- `POST /api/v1/orders` - create an order. Requires `coffeeSlug`,
  `tableNumber` (1-10000), and at least one `items[]` or `offers[]` line.
  Items: `{ itemId, quantity }` (quantity 1-99, max 50 lines). Offers:
  `{ offerId, quantity }` (quantity 1-99, max 20 lines). Optional
  `sessionToken` (20-256 characters). The response includes `sessionToken`
  only when a session is created or accepted.
- `GET /api/v1/orders?sessionToken=...` - list the session's orders, newest
  first. `limit` defaults to 50 and is capped at 100. Includes session summary.
- `GET /api/v1/orders/:orderId` - read one order. A table-session token is
  required (query `sessionToken` or header `x-session-token`) when the order
  belongs to a session; only legacy orders without a session stay readable by
  id alone.

Order lines store immutable snapshots: item/offer name, image, unit price,
subtotal, and offer components. Totals are computed by the backend.

## Admin authentication

- `POST /api/v1/admin/auth/app` with `{ "pin": "3219" }` returns an
  `APP_ADMIN` token.
- `POST /api/v1/admin/auth/coffee/:coffeeSlug` with `{ "pin": "0000" }` returns
  a `COFFEE_ADMIN` token scoped to that coffee.

## App admin (`APP_ADMIN`)

- `GET /api/v1/admin/coffees` - list coffees with `categoryCount`
- `POST /api/v1/admin/coffees` - create a coffee with required, unique `name`
  and `slug`; sets default PIN `0000`. `logo` and `cover` are optional. Without
  a logo the backend stores `/images/coffee-placeholder.svg`.
- `GET /api/v1/admin/coffees/:coffeeId` - get one coffee
- `PATCH /api/v1/admin/coffees/:coffeeId` - update name/logo/cover/slug/image IDs
- `PATCH /api/v1/admin/coffees/:coffeeId/pin` - reset PIN to `0000`
- `DELETE /api/v1/admin/coffees/:coffeeId` - cascading delete
- `GET /api/v1/admin/coffees/:coffeeId/insights` - per-coffee insights
- `GET /api/v1/admin/insights` - platform insights

Insights queries accept `startDate`, `endDate`, `from`, `to`,
`serviceShiftId`, and the compatibility alias `shiftId`.

## Coffee admin (`COFFEE_ADMIN`)

All routes are scoped to `token.coffeeId`.

### Coffee and menu

- `GET/PATCH /api/v1/admin/my-coffee`
- `PATCH /api/v1/admin/my-coffee/pin` - body `{ currentPin, newPin }`
- `GET/POST /api/v1/admin/my-coffee/categories`
- `PATCH/DELETE /api/v1/admin/my-coffee/categories/:categoryId`
- `GET/POST /api/v1/admin/my-coffee/categories/:categoryId/items`
- `PATCH/DELETE /api/v1/admin/my-coffee/items/:itemId`

### Offers

- `GET/POST /api/v1/admin/my-coffee/offers`
- `PATCH/DELETE /api/v1/admin/my-coffee/offers/:offerId`
- `DELETE` archives the offer rather than hard-deleting it.

### Orders

- `GET /api/v1/admin/my-coffee/orders?status&paymentStatus&page&limit`
- `GET /api/v1/admin/my-coffee/orders/:orderId`
- `PATCH /api/v1/admin/my-coffee/orders/:orderId/status`
- `PATCH /api/v1/admin/my-coffee/orders/:orderId/payment`

### Shifts, sessions, and tables

- `GET /api/v1/admin/my-coffee/shifts/current`
- `POST /api/v1/admin/my-coffee/shifts/open`
- `POST /api/v1/admin/my-coffee/shifts/close`
- `GET /api/v1/admin/my-coffee/shifts`
- `GET /api/v1/admin/my-coffee/shifts/:shiftId`
- `GET /api/v1/admin/my-coffee/shifts/:shiftId/summary`
- `POST|PATCH /api/v1/admin/my-coffee/shifts/:shiftId/close`
- `GET /api/v1/admin/my-coffee/shifts/:shiftId/table-sessions`
- `GET /api/v1/admin/my-coffee/table-sessions`
- `GET /api/v1/admin/my-coffee/table-sessions/:sessionId`
- `PATCH /api/v1/admin/my-coffee/table-sessions/:sessionId/close`
- `GET /api/v1/admin/my-coffee/tables`
- `POST /api/v1/admin/my-coffee/tables/:tableNumber/close`

`/service-shifts/*` routes mirror `/shifts/*` as explicit resource-name
aliases.

### Insights

- `GET /api/v1/admin/my-coffee/insights`

## Images

- `POST /api/v1/admin/images` - `multipart/form-data` field `file`. Accepts
  JPEG/PNG/WebP/GIF, validated by declared MIME type and magic bytes. Maximum
  size is `IMAGE_UPLOAD_MAX_MB` (default 25 MB). Returns `{ imageId, url }`.
- `DELETE /api/v1/admin/images/:imageId` - owner or app admin only.

## Validation summary

- PIN: exactly four digits.
- Coffee slug: trimmed, lowercase, 1-80 chars, `[a-z0-9]` with `-` between
  segments.
- Object IDs: 24-character hex.
- Table number: 1-10000.
- Quantities: 1-99.
- Offers: 1-20 lines, unique items, stock 0-9999, price greater than zero,
  end date after start date.
- Item promotion must be lower than the regular price.
