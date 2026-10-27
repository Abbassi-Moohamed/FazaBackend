# Known Limitations & Defects

These are findings from code inspection, recorded rather than fixed.

## Data and analytics

- **Promotion history unavailable**: orders do not snapshot the item's regular
  price, so historical discount amounts remain unavailable instead of being
  estimated.

## Security

- **Static app-admin PIN**: `APP_ADMIN_PIN` is a shared env-based gate, not real
  identity management.
- **No login rate limiting**: no rate limiter exists on admin auth endpoints in
  source.
- **Stale artifact**: `dist/auth/login-rate-limit.js` exists with no source
  counterpart, which can mislead code searches.
- **No JWT revocation**: tokens remain valid until expiry.
- **Documentation drift**: `enhancementNeeded.md` says login rate limiting
  exists and references a `coffee_default_language` migration; neither exists
  in this checkout.
- **Secrets present locally**: `backend/.env` and `frontend/.env` exist. Their
  values must never be committed or shared.

## Consistency and reliability

- **No order idempotency**: retries of `POST /orders` can create duplicate
  orders.
- **No multi-document transactions for all flows**: standalone MongoDB does not
  support them. Offer stock uses per-document updates plus compensation;
  cascading deletes use deterministic ordering.
- **Basic health/metrics**: liveness and readiness exist, but there is no
  detailed metrics endpoint.
- **Video trimming is local**: over-long videos are re-encoded by the bundled
  `ffmpeg-static` binary (GPL-3.0-or-later). The host must allow the install
  script to download the binary and provide a writable temp directory; if the
  binary is missing, over-long uploads return 503 while short videos still work.
  Offloading the encode to a queue/worker is the scalable next step.

## Documentation

- Root README previously claimed `Coffee.defaultLanguage`, customer language
  switching, and staff PINs. None are implemented: the Coffee model has no
  `defaultLanguage`; UI copy is French-only; auth has only app and coffee admin
  PINs.
- `backend/README.md` previously began mid-sentence and had stale route/content
  references; it now summarizes the implementation and links to this directory.
- `backend/ROUTES.md` had drifted from the current route set. It is now a
  pointer to `docs/api-contracts.md`.
