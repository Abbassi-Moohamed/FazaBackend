# Faza API Route Reference (legacy)

This file previously duplicated the route list and had drifted from the
implementation (offers, table sessions, shifts, tables, and aliases were
missing).

The authoritative, code-grounded reference is now:

- [`docs/api-contracts.md`](docs/api-contracts.md) — public and admin routes,
  envelopes, validation, and examples
- [`docs/admin-backoffice.md`](docs/admin-backoffice.md) — shifts, table
  sessions, tables, order transitions, and payment
- [`docs/realtime.md`](docs/realtime.md) — Socket.IO events and rooms

Local base URL: `http://localhost:4000`

Version prefix: `/api/v1`
