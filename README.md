order response. The client should retain it and send it on later orders:

```json
{
  "coffeeSlug": "cafe-el-manzah",
  "tableNumber": 12,
  "sessionToken": "returned-by-the-server",
  "items": [{ "itemId": "<item-object-id>", "quantity": 2 }]
}
```

The token is checked against the coffee, table, and active-session state; it
is never logged or returned by public order reads. Supplying an invalid token
returns `401`. `GET /api/v1/orders/:orderId` remains backward compatible
without a token; an optional `sessionToken` query value is validated when
provided. Orders store nullable `tableSessionId` and `serviceShiftId` links,
so historical orders and installations that predate this feature remain
readable.

When a shift is open, new orders use that shift. When no shift is open,
ordering remains enabled for compatibility: a new table session gets a
nullable shift link. An active table session is not closed or moved when a
shift changes; later orders can retain that session while linking to the new
active shift. Closing a shift never deletes or rewrites sessions or orders.
Sessions are closed only by an explicit future session-management operation,
so the same physical table can start a new session after the current one is
closed without treating table numbers as customer identity.

### Coffee-admin shift APIs

All routes are scoped to the coffee ID in the `COFFEE_ADMIN` bearer token.
`/service-shifts` is an explicit resource-name alias for `/shifts`.

| Method            | Endpoint                                                  | Purpose                                                       |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `POST`            | `/api/v1/admin/my-coffee/shifts/open`                     | Open one shift (`name?`, `type?`, `label?`, `notes?`)         |
| `GET`             | `/api/v1/admin/my-coffee/shifts/current`                  | Current open shift and aggregate summary                      |
| `GET`             | `/api/v1/admin/my-coffee/shifts`                          | List shifts (`status`, `page`, `limit`)                       |
| `GET`             | `/api/v1/admin/my-coffee/shifts/:shiftId`                 | Shift detail and aggregate summary                            |
| `GET`             | `/api/v1/admin/my-coffee/shifts/:shiftId/summary`         | Same detail/summary representation                            |
| `POST` or `PATCH` | `/api/v1/admin/my-coffee/shifts/:shiftId/close`           | Close an open shift                                           |
| `GET`             | `/api/v1/admin/my-coffee/shifts/:shiftId/table-sessions`  | Sessions belonging to a shift                                 |
| `GET`             | `/api/v1/admin/my-coffee/table-sessions`                  | List sessions (`serviceShiftId`, `status`, `page`, `limit`)   |
| `GET`             | `/api/v1/admin/my-coffee/table-sessions/:sessionId`       | Session detail and aggregate summary                          |
| `PATCH`           | `/api/v1/admin/my-coffee/table-sessions/:sessionId/close` | Close the active session so a later group can start a new one |

Shift and table-session summaries are MongoDB aggregation results. They
include total/pending/confirmed/rejected order counts, pending amount,
confirmed revenue, average confirmed order value, confirmed item quantity,
tables served, table/session breakdowns, lifecycle timestamps, and the
session's current order count. No order or session document is returned
outside the authenticated coffee scope.

### Analytics shift filtering

The existing coffee and platform insights endpoints accept
`serviceShiftId` (or the compatibility alias `shiftId`) in addition to their
date filters:

```text
GET /api/v1/admin/my-coffee/insights?serviceShiftId=<shift-id>&from=2026-09-01&to=2026-09-15
GET /api/v1/admin/coffees/<coffee-id>/insights?shiftId=<shift-id>
```

The service verifies that the selected shift exists and belongs to the
requested coffee before aggregation. Current and comparison periods use the
same shift filter. Historical orders with a null `serviceShiftId` are still
included in unfiltered analytics and are excluded from a specific shift
filter, which prevents assigning history to a shift retroactively.

### Migration and security notes

Migration `0009_table_sessions_service_shifts` creates the two collections,
adds the nullable order references, repairs duplicate legacy active rows
before installing unique partial indexes, and adds order/session/shift query
indexes. Runtime Mongoose `autoIndex` remains disabled; production
deployments must run `npm run db:migrate`.

Session tokens have 256-bit server entropy and are hashed before persistence.
The raw token is returned only in the order response that creates or accepts
the session; it is never persisted or logged. The unique
MongoDB indexes, rather than an application-level check, serialize concurrent
session/shift creation. Admin routes use the existing JWT middleware plus
coffee ownership checks, and invalid cross-coffee shift/session identifiers
return `404` rather than disclosing another coffee's data.

## Architectural Decisions

- MongoDB/Mongoose is the primary persistence layer; migrations own indexes and
  database validators while repositories own query composition.
- Public menu reads and visitor order creation do not require authentication to
  preserve QR-code usability.
- Coffee ownership is enforced server-side from the verified token and the
  category relationship; client-supplied ownership claims are not trusted.
- The backend calculates effective prices, subtotals, and totals. Order lines
  store snapshots to preserve historical pricing and names.
- Promotion is an effective unit price only when lower than the regular price;
  availability is checked again at order creation.
- R2 stores image binaries; MongoDB stores delivery URLs and managed object
  keys. External image URLs remain supported.
- Versioned routing is centralized under `/api/v1`; controllers do not embed
  persistence logic, and services do not register routes.
- The app factory is separate from process startup so the HTTP API can be
  tested without a listening server.

## CI/CD

`.github/workflows/ci-cd.yml` runs on every push to `main`, on every pull
request, and on demand (`workflow_dispatch`):

| Job      | What it does                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| `verify` | `npm ci`, typecheck, lint, format check, tests, build. Pull requests stop here.                              |
| `deploy` | Creates a Render deploy for the pushed commit (`scripts/deploy-render.mjs`) and waits for its status.        |
| `smoke`  | Checks the live API (`scripts/smoke.mjs`): the critical routes must exist and the build must be the new one. |

The smoke job is the important one: the API and the frontend are deployed
independently, so a route missing from the live build is invisible in the
repository and only shows up in the browser as a `404`. Every check treats a
`404` carrying "Route not found" as a failure, while an authenticated `401`
or a domain `404` proves the route exists.

### Repository secrets and variables

| Name                     | Kind     | Required | Purpose                                                                |
| ------------------------ | -------- | -------- | ---------------------------------------------------------------------- |
| `RENDER_API_KEY`         | secret   | yes¹     | Render workspace API key (Render → Account Settings → API Keys)        |
| `RENDER_SERVICE_ID`      | secret   | yes¹     | Service id of the API service (the service URL ends with `/svc/<id>`)  |
| `RENDER_DEPLOY_HOOK_URL` | secret   | no¹      | Deploy hook used when the API key is not available                     |
| `DATABASE_URL`           | secret   | no²      | Production MongoDB URI, used to apply the migrations                   |
| `PRODUCTION_API_URL`     | variable | no       | API origin to smoke test (default `https://menuscanapis.onrender.com`) |

¹ Set either `RENDER_API_KEY` + `RENDER_SERVICE_ID` (preferred: the deploy
status is polled, so a failed build fails the workflow) or
`RENDER_DEPLOY_HOOK_URL`.

² The migrations are idempotent, so they can run from the workflow or from
the Render build command (`npm run db:migrate && npm run build`). Keep one of
the two in place: a deploy that skips a migration ships code that expects
indexes the database does not have.

`/health` reports the deployed commit (`buildSha`) and the build time
(`builtAt`), so a release can be traced back to its commit and the smoke job
can wait for the exact build it triggered. The commit is baked into the
artifact by `scripts/write-build-info.mjs` (run by `npm run build`) from
`RENDER_GIT_COMMIT`/`GIT_SHA`, so the identity survives independently of the
runtime environment variables.

### Render service settings

| Setting       | Value                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Build command | `npm run build` (add `npm run db:migrate &&` in front to migrate on deploy) |
| Start command | `npm start`                                                                 |
| Health check  | `/health/ready`                                                             |
| Branch        | `main`                                                                      |
| Auto-deploy   | off, when the workflow deploys the service                                  |

### Local commands

```bash
npm run check                 # typecheck + tests
npm run smoke -- --url https://menuscanapis.onrender.com
npm run deploy -- --sha "$(git rev-parse HEAD)" --dry-run
```

If Render's own "auto-deploy" is enabled in the dashboard, disable it so the
service is only deployed by this workflow.

## Future Development Handoff

- Add new routes to the appropriate versioned router under `src/routes/` and
  mount the router from `src/routes/v1/index.ts` or the role-specific admin
  router.
- Keep request schemas in `src/validators/`, HTTP serialization in
  `src/controllers/`, business rules in `src/services/`, and Mongo queries in
  `src/repositories/`.
- Add or change models in `src/models/` together with a new ordered migration
  in `src/db/migrations/`; update DTOs in `src/types/` and focused tests.
- For protected resources, use `requireAdmin` plus the narrowest role
  middleware and scope every repository lookup by `req.admin.coffeeId` for
  Coffee Admin operations.
- Reuse `ApiError`, `sendSuccess`, `validate`, logging, and centralized error
  handling rather than creating endpoint-specific envelopes.
- For new image-backed fields, preserve the URL/object-key pairing and cleanup
  behavior in `image.service.ts`/`cloudflare-images.service.ts`.
- Do not add client-trusted prices, coffee IDs, authorization state, or direct
  database calls to controllers. Do not duplicate ownership checks in only the
  frontend.
- Update this README in the same task as every meaningful backend feature or
  architectural change.

## Recent Changes

- Added visitor order creation, public order lookup, item snapshots, totals,
  and pending/confirmed/rejected status lifecycle.
- Added Coffee Admin order listing, filtering, lookup, and status updates.
- Added item promotions and availability validation across admin and ordering.
- Added Cloudflare R2-backed image metadata, uploads, and managed cleanup.
- Added role-scoped JWT authorization and coffee ownership checks.
- Added migrations for order contract, images, category/cover images, and
  item availability/promotion.
