# Data Model & Migrations

## Collections and key fields

- `coffees`: name, unique slug, logo, cover, logoImageId, coverImageId, and a
  select-false `adminPinHash`. Index `uq_coffees_slug`.
- `itemcategories`: coffeeId, name, image, imageId. Indexes
  `uq_itemcategories_coffee_name` and `idx_itemcategories_coffee`.
- `items`: itemCategoryId, name, description, price, image, imageId,
  `isAvailable` (default true), and nullable `promotion`.
- `images`: metadata for uploaded images. Used for ownership and cleanup; image
  binaries live in Cloudflare R2.
- `offers`: coffeeId, name, description, bundle `price`, `lines[]`
  (`itemId` + `quantity`), `stock`, image/imageId, nullable
  `startAt`/`endAt`, `isActive`, and nullable `archivedAt`.
- `orders`: coffeeId, tableNumber, item snapshots, offer snapshots (including
  component lines), total, status, payment status, paidAt/paidBy, and nullable
  tableSessionId/serviceShiftId.
- `tablesessions`: coffeeId, tableNumber, nullable serviceShiftId, unique
  hashed session token, status, order count, opened/closed timestamps.
- `serviceshifts`: coffeeId, optional name/type/label/notes, status,
  opened/closed timestamps, and actor fields.

## Relationships

```text
Coffee 1---N ItemCategory 1---N Item
Coffee 1---N Offer
Coffee 1---N Order N---1 TableSession
Coffee 1---N ServiceShift
Order N---1 ServiceShift (nullable, legacy-compatible)
```

Orders retain snapshots rather than live lookups, so later menu or offer edits
do not rewrite historical orders.

## Status values

- Order: `PENDING`, `CONFIRMED`, `REJECTED`
- Payment: `UNPAID`, `PAID`
- Table session: `ACTIVE`, `CLOSED`
- Service shift: `OPEN`, `CLOSED`
- Offer (derived, never stored): `ACTIVE`, `SCHEDULED`, `EXPIRED`, `SOLD_OUT`,
  `PAUSED`, `ARCHIVED`

## Indexes

Order indexes cover `{ coffeeId, createdAt }`, `{ coffeeId, status,
createdAt }`, `{ coffeeId, paymentStatus, createdAt }`,
`{ coffeeId, serviceShiftId, createdAt }`, and `{ tableSessionId,
createdAt }`.

Offer indexes: `{ coffeeId, archivedAt, isActive }` and
`{ coffeeId, createdAt }`.

## Migrations

Migrations are registered through side effects: each numbered file imports the
shared `migrations` array from `./index.js` and pushes its entry. The index file
exports the empty array.

Sequence:

1. `0001_init` - coffee/category/item collections, validators, indexes
2. `0002_admin` - `adminPinHash`
3. `0003_images` - images collection and image references
4. `0004_category_images`
5. `0005_coffee_cover_images`
6. `0006_item_availability_promotion`
7. `0007_orders`
8. `0008_order_contract`
9. `0009_table_sessions_service_shifts` - collections, nullable references,
   duplicate repair before unique partial indexes, query indexes
10. `0010_order_payment`
11. `0011_item_category_name_index`
12. `0012_multiple_sessions_per_table`
13. `0013_offers`

Run `npm run db:migrate` before a production release. Do not depend on Mongoose
`autoIndex`.

## Seed

`src/db/seed.ts` is destructive. It wipes orders, table sessions, service
shifts, offers, items, categories, and coffees, then recreates the sample
dataset from `seed-data.ts`. Every seeded coffee uses the hashed default PIN
`0000`.

## Deletion behavior

App-admin coffee deletion follows a deterministic dependency order:
items -> categories -> offers -> coffee. This keeps standalone MongoDB
deployments safe without requiring multi-document transactions.
