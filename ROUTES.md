# Faza — API Route Reference

Complete list of every HTTP route registered by the backend.

- **Base URL** (local): `http://localhost:4000`
- **Envelope**: successes `{ "success": true, "data": … }`, errors `{ "success": false, "message": …, "details"? }`
- **Admin access**: everything under `/api/v1/admin/*` (except the auth endpoints) requires
  `Authorization: Bearer <token>` obtained from the admin auth routes. See the "Admin access" section.

---

## 1. System

| Method | Route           | Auth | Description                                                                 |
| ------ | --------------- | ---- | --------------------------------------------------------------------------- |
| `GET`  | `/`             | —    | API overview (name, version, endpoint links)                                |
| `GET`  | `/health`       | —    | Liveness probe → `{ "status": "ok" }`                                       |
| `GET`  | `/health/ready` | —    | Readiness probe → `{ "status": "ok", "database": "up" }` (503 when DB down) |

---

## 2. Public menu (no auth)

| Method | Route                                  | Auth | Description                             |
| ------ | -------------------------------------- | ---- | --------------------------------------- |
| `GET`  | `/api/v1/coffees/:coffeeSlug`          | —    | Coffee by slug + **its own** categories |
| `GET`  | `/api/v1/categories/:categoryId/items` | —    | Items of **one** category               |

Examples:

```http
GET /api/v1/coffees/cafe-el-manzah
GET /api/v1/categories/6aa5df5707f936c6faa35ca6/items
```

---

## 3. Admin authentication (PIN → bearer token)

| Method | Route                                   | Auth | Description                                                                    |
| ------ | --------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| `POST` | `/api/v1/admin/auth/app`                | —    | App-admin PIN (`3219`) → `APP_ADMIN` token                                     |
| `POST` | `/api/v1/admin/auth/coffee/:coffeeSlug` | —    | Coffee-admin PIN (default `0000`) → `COFFEE_ADMIN` token scoped to that coffee |

```http
POST /api/v1/admin/auth/app
Content-Type: application/json

{ "pin": "3219" }
```

## 3.5 Visitor orders

| Method | Route                     | Auth | Description                                          |
| ------ | ------------------------- | ---- | ---------------------------------------------------- |
| `POST` | `/api/v1/orders`          | —    | Create an order from the selected coffee menu        |
| `GET`  | `/api/v1/orders`          | —    | List every order of a table session (`sessionToken`) |
| `GET`  | `/api/v1/orders/:orderId` | —    | Read the current status of an order                  |

The request must include `coffeeSlug`, a positive table number (1–10000), and
one or more `{ "itemId", "quantity" }` lines. The server verifies that
every item belongs to that coffee, is available, and calculates the total from
the current menu price (including an active promotion). Order lines store
immutable item id, name, quantity, unit price and line subtotal snapshots.

### Table sessions

A **table session** is the customer sitting at a table, not the table itself:
a table can host several concurrent sessions (two parties sharing a table
never share a bill). The session token returned by the first order is the only
credential of that session.

- `POST /api/v1/orders` without `sessionToken` opens a new session and returns
  its `sessionToken`; with a `sessionToken` the order is appended to that
  session.
- `GET /api/v1/orders?sessionToken=…` returns the whole history of one session
  (newest first, `limit` up to 100) plus a summary of the session. The history
  stays readable after the session is closed.
- Realtime: `session:subscribe { sessionToken }` joins the `session:{id}` room
  and streams `order:new` / `order:updated` for that session only.

```json
{
  "coffeeSlug": "cafe-el-manzah",
  "tableNumber": 12,
  "items": [{ "itemId": "…", "quantity": 2 }],
  "notes": "No sugar"
}
```

```json
{ "success": true, "data": { "token": "eyJ…", "role": "APP_ADMIN", "expiresIn": "12h" } }
```

```http
POST /api/v1/admin/auth/coffee/cafe-el-manzah
Content-Type: application/json

{ "pin": "0000" }
```

```json
{ "success": true, "data": { "token": "eyJ…", "role": "COFFEE_ADMIN", "coffeeId": "…", "expiresIn": "12h" } }
```

---

## 4. Application admin — coffees (token role `APP_ADMIN`)

| Method   | Route                                 | Auth        | Description                                            |
| -------- | ------------------------------------- | ----------- | ------------------------------------------------------ |
| `GET`    | `/api/v1/admin/coffees`               | `APP_ADMIN` | List all coffees (with `categoryCount`)                |
| `POST`   | `/api/v1/admin/coffees`               | `APP_ADMIN` | Create a coffee (default PIN `0000`)                   |
| `GET`    | `/api/v1/admin/coffees/:coffeeId`     | `APP_ADMIN` | Get one coffee                                         |
| `PATCH`  | `/api/v1/admin/coffees/:coffeeId`     | `APP_ADMIN` | Update name / logo / slug                              |
| `PATCH`  | `/api/v1/admin/coffees/:coffeeId/pin` | `APP_ADMIN` | Reset that coffee's admin PIN to `0000`                |
| `DELETE` | `/api/v1/admin/coffees/:coffeeId`     | `APP_ADMIN` | Delete coffee (cascades categories → items)            |
| `GET`    | `/api/v1/admin/insights`              | `APP_ADMIN` | Platform-wide analytics, optionally filtered by coffee |

```http
POST /api/v1/admin/coffees
Authorization: Bearer <app-admin-token>
Content-Type: application/json

{ "name": "Café Ternat", "logo": "https://example.com/ternat-logo.png" }
```

`slug` is optional — auto-generated from `name` when omitted (`café ternat` → `cafe-ternat`).

---

## 5. Coffee admin — own coffee (token role `COFFEE_ADMIN`)

All routes below act on the coffee bound to the token. Supplying another coffee's
`categoryId` / `itemId` returns `404` — never modifies that coffee.

| Method   | Route                                                     | Auth           | Description                                         |
| -------- | --------------------------------------------------------- | -------------- | --------------------------------------------------- |
| `GET`    | `/api/v1/admin/my-coffee`                                 | `COFFEE_ADMIN` | Own coffee info                                     |
| `PATCH`  | `/api/v1/admin/my-coffee`                                 | `COFFEE_ADMIN` | Update own name / logo / slug                       |
| `PATCH`  | `/api/v1/admin/my-coffee/pin`                             | `COFFEE_ADMIN` | Change own PIN `{ "currentPin", "newPin" }`         |
| `GET`    | `/api/v1/admin/my-coffee/categories`                      | `COFFEE_ADMIN` | List own categories                                 |
| `POST`   | `/api/v1/admin/my-coffee/categories`                      | `COFFEE_ADMIN` | Create category `{ "name" }`                        |
| `PATCH`  | `/api/v1/admin/my-coffee/categories/:categoryId`          | `COFFEE_ADMIN` | Rename own category                                 |
| `DELETE` | `/api/v1/admin/my-coffee/categories/:categoryId`          | `COFFEE_ADMIN` | Delete own category (cascades its items)            |
| `GET`    | `/api/v1/admin/my-coffee/categories/:categoryId/items`    | `COFFEE_ADMIN` | List items of own category                          |
| `POST`   | `/api/v1/admin/my-coffee/categories/:categoryId/items`    | `COFFEE_ADMIN` | Create item in own category                         |
| `PATCH`  | `/api/v1/admin/my-coffee/items/:itemId`                   | `COFFEE_ADMIN` | Update own item                                     |
| `DELETE` | `/api/v1/admin/my-coffee/items/:itemId`                   | `COFFEE_ADMIN` | Delete own item                                     |
| `GET`    | `/api/v1/admin/my-coffee/orders`                          | `COFFEE_ADMIN` | List own orders (`status`, `page`, `limit` filters) |
| `GET`    | `/api/v1/admin/my-coffee/orders/:orderId`                 | `COFFEE_ADMIN` | Get one own order                                   |
| `PATCH`  | `/api/v1/admin/my-coffee/orders/:orderId/status`          | `COFFEE_ADMIN` | Move an own order through its valid workflow        |
| `PATCH`  | `/api/v1/admin/my-coffee/orders/:orderId/payment`         | `COFFEE_ADMIN` | Mark one confirmed unpaid order as manually paid    |
| `GET`    | `/api/v1/admin/my-coffee/insights`                        | `COFFEE_ADMIN` | Analytics for the own coffee                        |
| `GET`    | `/api/v1/admin/my-coffee/shifts/current`                  | `COFFEE_ADMIN` | Current service shift and summary                   |
| `POST`   | `/api/v1/admin/my-coffee/shifts/open`                     | `COFFEE_ADMIN` | Open a service shift                                |
| `POST`   | `/api/v1/admin/my-coffee/shifts/close`                    | `COFFEE_ADMIN` | Close the current service shift                     |
| `GET`    | `/api/v1/admin/my-coffee/shifts`                          | `COFFEE_ADMIN` | List service shifts                                 |
| `GET`    | `/api/v1/admin/my-coffee/shifts/:shiftId`                 | `COFFEE_ADMIN` | Get a shift and summary                             |
| `PATCH`  | `/api/v1/admin/my-coffee/shifts/:shiftId/close`           | `COFFEE_ADMIN` | Close one shift                                     |
| `GET`    | `/api/v1/admin/my-coffee/table-sessions`                  | `COFFEE_ADMIN` | List table sessions                                 |
| `GET`    | `/api/v1/admin/my-coffee/table-sessions/:sessionId`       | `COFFEE_ADMIN` | Get a table-session summary                         |
| `PATCH`  | `/api/v1/admin/my-coffee/table-sessions/:sessionId/close` | `COFFEE_ADMIN` | Close an active table session                       |
| `GET`    | `/api/v1/admin/my-coffee/tables`                          | `COFFEE_ADMIN` | List the open tables with their orders and bill     |
| `POST`   | `/api/v1/admin/my-coffee/tables/:tableNumber/close`       | `COFFEE_ADMIN` | Close a table and every session running on it       |

Table view: the backoffice settles tables, not client sessions. A table can
host several sessions (one per party); `GET /tables` groups them and returns,
for each table, its orders (with their date) and its bill. Closing a table
closes all of its sessions at once, and is refused with `409` while an order
is still pending (`TABLE_PENDING_ORDERS`) or confirmed but unpaid
(`TABLE_UNPAID_ORDERS`).

Closing a service is refused with `409` (`OPEN_TABLES_REMAIN`) while a table
of the coffee is still open — the payload lists the open tables with their
number of orders and their revenue, so the admin can settle them first. Every
open table blocks the close, including a table opened outside the service
shift: an order can only be confirmed while a service is open, so such a table
would otherwise stay open with orders nobody could settle anymore.

Order workflow: `PENDING → CONFIRMED` or `PENDING → REJECTED`. Terminal states
cannot be changed. Payment is a separate workflow:
`CONFIRMED + UNPAID → CONFIRMED + PAID`. Pending and rejected orders cannot be
marked paid. Order queries are always scoped to the coffee in the bearer
token. Add `paymentStatus=PAID` or `paymentStatus=UNPAID` to the order list
query to filter payment state.

```http
POST /api/v1/admin/my-coffee/categories
Authorization: Bearer <coffee-admin-token>
Content-Type: application/json

{ "name": "Snacks" }
```

```http
POST /api/v1/admin/my-coffee/categories/:categoryId/items
Authorization: Bearer <coffee-admin-token>
Content-Type: application/json

{ "name": "Croissant", "description": "Feuilleté pur beurre", "price": 2.0, "image": "https://…" }
```

Item body: `name` (required), `price` (required, ≥ 0), `description`?, `image`?.
On `PATCH`, every field is optional but at least one must be present.

---

## 6. Image upload (both admin roles, Cloudflare R2)

| Method   | Route                           | Auth                         | Description                                     |
| -------- | ------------------------------- | ---------------------------- | ----------------------------------------------- |
| `POST`   | `/api/v1/admin/images`          | `APP_ADMIN` / `COFFEE_ADMIN` | Upload an image → `{ "imageId", "url" }` (§6.1) |
| `DELETE` | `/api/v1/admin/images/:imageId` | `APP_ADMIN` / `COFFEE_ADMIN` | Delete an image (§6.2)                          |

### 6.1 `POST /api/v1/admin/images`

`multipart/form-data`, field name **`file`**:

```http
POST /api/v1/admin/images
Authorization: Bearer <admin-token>
Content-Type: multipart/form-data

file=@logo.png
```

- Accepted types: `image/jpeg`, `image/png`, `image/webp`, `image/gif` — validated by declared
  MIME type **and** magic bytes (content must actually be that image format). The maximum size
  is configured by `IMAGE_UPLOAD_MAX_MB` (25 MB by default, up to 100 MB).
- The binary is uploaded to **Cloudflare R2**; MongoDB stores only metadata. No binary is
  ever written to the database.
- Returns `201` with only `{ "imageId", "url" }` (the delivery URL) — credentials are never
  exposed:

```json
{
  "success": true,
  "data": {
    "imageId": "uploads/2026-09-14/<uuid>.webp",
    "url": "https://cdn.example.com/uploads/2026-09-14/<uuid>.webp"
  }
}
```

The returned `url` can be passed directly as `logo` / `image` when creating/updating coffees,
categories… items. Assigning a delivery URL records the `imageId` on that row so the image is
tracked for cleanup.

### 6.2 `DELETE /api/v1/admin/images/:imageId`

```http
DELETE /api/v1/admin/images/c0ffee-…
Authorization: Bearer <admin-token>
```

- Removes the image from Cloudflare and its metadata row.
- **Ownership**: a `COFFEE_ADMIN` may only delete images uploaded by their own coffee (or still
  referenced by their own coffee/items). Deleting another coffee's image → `403`. The app admin
  may delete any image.
- Images still referenced by one of the blocked coffee's rows are never deleted automatically
  here — cleanup happens when the referencing item/coffee is removed or replaced.
- Errors: `400` bad id, `401` no token, `403` not owner, `404` unknown image, `503` Cloudflare
  not configured / unreachable.

---

## 7. Status codes

| Code  | Meaning                                                                    |
| ----- | -------------------------------------------------------------------------- |
| `200` | OK                                                                         |
| `201` | Created                                                                    |
| `400` | Validation failed / malformed body or id                                   |
| `401` | Unauthorized — missing/invalid/expired token, or wrong PIN                 |
| `403` | Forbidden — authenticated with the wrong admin role, or CORS origin denied |
| `404` | Route / coffee / category / item / image not found                         |
| `409` | Conflict — slug or category name already taken                             |
| `413` | Request body too large                                                     |
| `500` | Internal server error                                                      |
| `502` | Cloudflare R2 request failed (bad gateway)                                 |
| `503` | Cloudflare R2 not configured / unreachable                                 |

## 8. Validation rules

| Field                                 | Rule                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `pin` (all auth + PIN routes)         | exactly 4 decimal digits                                    |
| `coffeeSlug`                          | lowercase, 1–80 chars, `[a-z0-9]` with `-` between segments |
| `coffee` / `category` / `item` `name` | required, trimmed, ≤ 120 / 80 / 120 chars                   |
| `logo` / `image`                      | valid URL                                                   |
| `price`                               | number ≥ 0                                                  |
| `coffeeId` / `categoryId` / `itemId`  | 24-char hex MongoDB ObjectId                                |
