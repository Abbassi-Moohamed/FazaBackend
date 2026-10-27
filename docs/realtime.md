# Realtime

## Setup

- `initRealtime(server)` attaches Socket.IO to the HTTP server.
- The implementation is single-process; a Redis adapter is not configured.
- `closeRealtime()` runs during graceful shutdown.
- CORS uses the shared `corsOptions` derived from `FRONTEND_URL` and
  `CORS_ORIGINS`.

## Authentication

- Admin clients may supply a JWT during the Socket.IO handshake. A valid
  `COFFEE_ADMIN` token joins `coffee:{coffeeId}`.
- Anonymous clients are allowed but restricted to rooms they can prove
  ownership of.
- Invalid or expired admin tokens are rejected.

## Rooms

- `order:{orderId}` - updates for one order
- `session:{tableSessionId}` - updates for every order in one table session
- `coffee:{coffeeId}` - coffee-admin operational updates

## Events

Server to client:

- `order:new`
- `order:updated`

Both carry an `OrderDto`; public payloads do not expose the session token.

Client to server:

- `order:subscribe { orderId, sessionToken? }`
- `order:unsubscribe { orderId }`
- `session:subscribe { sessionToken }`
- `session:unsubscribe { sessionToken }`

Order subscriptions require the owning session token when the order belongs to
a table session. Session subscriptions validate the raw token against its
stored hash and join only that session's room.
