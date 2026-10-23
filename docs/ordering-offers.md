# Ordering & Offers

## Order creation (`placeOrder`)

1. Resolve the coffee by slug.
2. Load requested items and verify they belong to the coffee. Reject
   unavailable items. Effective unit price is `promotion ?? price`. Build item
   snapshots and sum the items subtotal.
3. Load requested offers with `findPurchasableOffer` (active, inside window,
   not archived). Verify stock and component availability. Build offer
   snapshots that include component names, then sum the offers subtotal.
4. Require at least one item or offer. The request validator also rejects
   duplicate offer IDs.
5. Compute `total = round(itemsSubtotal + offersSubtotal)`.
6. Resolve the table session:
   - With a supplied token, verify hash, ACTIVE status, coffee ownership, and
     matching table number; otherwise return 401.
   - Without a token, generate a 256-bit token, store only its hash, and create
     a new session. A table can host multiple sessions, so an existing session
     is never adopted implicitly.
   - Link the session to the current service shift when one is open.
7. Reserve offer stock one document at a time. If a reservation fails, restore
   everything already reserved. If order creation fails after reservations,
   restore all reserved stock.
8. Create the order with snapshots and nullable session/shift references, touch
   the session, publish `order:new`, and return the DTO. `sessionToken` appears
   only when a session was created or accepted.

## Sessions and shifts

- A table session belongs to one party, not to the physical table.
- A service shift groups operational activity.
- New orders use the open shift when available. Ordering remains possible
  without a shift for compatibility; the session/order shift reference can be
  null.
- Closing a shift never deletes or rewrites sessions or orders.
- Closing a table closes every session on that table.
- A shift cannot be closed while tables remain open (`409`,
  `OPEN_TABLES_REMAIN`).
- A table cannot be closed while it has pending orders
  (`TABLE_PENDING_ORDERS`) or confirmed unpaid orders (`TABLE_UNPAID_ORDERS`).

## Order status and payment

- `PENDING -> CONFIRMED` or `PENDING -> REJECTED`; terminal states cannot be
  changed.
- Confirming requires an active service shift (`409 NO_ACTIVE_SERVICE`).
- Confirming also links the order's table session to the active shift.
- Rejecting a pending order restores stock reserved by its offer bundles.
- Payment is separate: only `CONFIRMED + UNPAID` can become `PAID`.
- Payment is manual/offline; no payment gateway is involved.

## Offer lifecycle

Offer status is derived from its fields and the clock:

1. `ARCHIVED` when `archivedAt` is set
2. `PAUSED` when `isActive` is false
3. `SCHEDULED` when `startAt` is in the future
4. `EXPIRED` when `endAt` is in the past
5. `SOLD_OUT` when stock is zero or less
6. Otherwise `ACTIVE`

Public offer reads expose only purchasable offers: active, inside the window,
in stock, and with every component available.

Prices are always recomputed from the live menu:

- Component unit price: `item.promotion ?? item.price`
- `originalPrice`: sum of component current prices
- `savings`: `max(0, originalPrice - offer.price)`

Admin deletion archives an offer. Orders snapshot the offer name, price,
quantity, subtotal, image, and component names so historical orders remain
stable.

## Offer validation

- 1-20 lines, each `{ itemId, quantity 1-99 }`
- Items must be unique and belong to the coffee
- Stock 0-9999
- Price greater than zero
- `endAt` must be after `startAt` when both are set
- Offer price must be lower than the sum of its component prices
