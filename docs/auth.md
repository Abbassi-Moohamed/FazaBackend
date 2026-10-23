# Auth & RBAC

## Roles

- `APP_ADMIN` - manages all coffee tenants (create/update/delete/reset PIN) and
  platform insights.
- `COFFEE_ADMIN` - scoped to the coffee bound in the token. Manages that
  coffee's menu, offers, orders, shifts, sessions, tables, and insights.

## PIN authentication

- App admin: `POST /api/v1/admin/auth/app` with `{ "pin": "..." }`. The PIN is
  compared against `env.APP_ADMIN_PIN` through the app-admin authenticator.
- Coffee admin: `POST /api/v1/admin/auth/coffee/:coffeeSlug` with
  `{ "pin": "..." }`. The backend resolves the coffee by slug and verifies the
  PIN against `coffee.adminPinHash`.
- PINs must be exactly four digits. They are stored as scrypt hashes
  (`src/auth/pin.ts`) and are never returned or logged.
- There are no staff PINs and no global PIN search.

## Tokens

- JWT HS256 issued by `src/auth/token.ts`, issuer `faza-backend`, payload
  `{ role, coffeeId? }`.
- Lifetime comes from `env.ADMIN_TOKEN_TTL` (default `12h`).
- `ADMIN_SECRET` must be at least 16 characters. The development default is
  rejected when `NODE_ENV=production`.
- Auth responses contain `{ token, role, coffeeId?, expiresIn }`.

## Middleware

- `requireAdmin` validates the bearer token and attaches
  `req.admin = { role, coffeeId? }`.
- `requireAppAdmin` requires role `APP_ADMIN`.
- `requireCoffeeAdmin` requires role `COFFEE_ADMIN` and a present `coffeeId`.
- Coffee-admin operations derive ownership from `req.admin.coffeeId`.
  Cross-coffee identifiers return 404 rather than exposing another tenant's
  data where appropriate.

## Session notes

- The frontend stores admin sessions in `sessionStorage` under
  `faza.admin.session`.
- Tokens are short-lived but there is no revocation mechanism.
- No login rate limiting exists in backend source (see
  [known-limitations.md](./known-limitations.md)).
