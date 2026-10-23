# Admin Backoffice

## App admin (`APP_ADMIN`)

- Full coffee CRUD: list, create, read, update, delete.
- Reset any coffee's admin PIN to `0000`.
- Platform insights at `GET /api/v1/admin/insights`, optionally filtered by
  coffee and service shift.
- Coffee creation hashes the default PIN `0000`.

## Coffee admin (`COFFEE_ADMIN`)

All operations are scoped to `token.coffeeId`. Cross-coffee identifiers return
404 rather than leaking another tenant's data.

### Menu

- Read/update own coffee and change its PIN (`currentPin`, `newPin`).
- Category CRUD; deleting a category cascades its items.
- Item CRUD with name, description, price, image, availability, and promotion.
  A promotion must be lower than the item's regular price.
- Offer CRUD and archive (see [ordering-offers.md](./ordering-offers.md)).

### Orders

- List with `status`, `paymentStatus`, `page`, and `limit` filters.
- Read a single order.
- Change status: `PENDING -> CONFIRMED | REJECTED`; confirming requires an
  active shift.
- Mark a confirmed unpaid order as paid.

### Shifts

- Open a shift with optional `name`, `type` (`MORNING`, `AFTERNOON`,
  `CUSTOM`), `label`, and `notes`.
- Read current shift and summary.
- List shifts with `status`, `page`, `limit`.
- Read a shift/summary and its table sessions.
- Close the current shift or a specific shift. Closing is refused while any
  table remains open.

### Sessions and tables

- List table sessions with `serviceShiftId`, `status`, `page`, `limit`.
- Read a session summary and close an active session.
- List tables grouped by table number, with orders and bill.
- Close a table, which closes every session on it. Refused while a pending or
  confirmed-unpaid order remains.

### Insights

- `GET /api/v1/admin/my-coffee/insights` with date and shift filters.
- The current insights service includes a hard-coded discount rate
  (`0.2051`) and synthetic promotion fields; see
  [known-limitations.md](./known-limitations.md).

## Route aliases

`/api/v1/admin/my-coffee/service-shifts/*` mirrors `/shifts/*` as an explicit
resource-name alias. Both sets are implemented in
`src/routes/admin/coffee-admin.routes.ts`.
