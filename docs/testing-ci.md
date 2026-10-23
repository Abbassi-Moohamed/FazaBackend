# Testing & CI

## Backend tests

- Runner: Vitest, Node environment (`backend/vitest.config.ts`).
- Location: `backend/tests/*.test.ts`.
- Helpers: `backend/tests/helpers.ts`, using mongodb-memory-server, Supertest,
  and socket.io-client.
- Configuration runs test files without parallelism and allows long timeouts
  for database startup.
- Coverage areas: admin, API, coffee tables, image upload, insights, offers,
  orders, realtime, session orders, and table-session shifts.

## Frontend tests

- Runner: Vitest, jsdom (`frontend/vitest.config.mts`).
- Scope: `frontend/src/**/*.test.ts`.
- Alias: `@` -> `frontend/src`.
- Coverage areas: admin tables, cart, insights, orders, session history, and
  session orders.

## Commands

Backend:

```text
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run check
```

Frontend:

```text
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run check
```

## Scripts

Backend: `dev`, `build`, `start`, `db:migrate`, `db:seed`, `smoke`, and
`deploy` (`scripts/deploy-render.mjs`).

Frontend: `dev`, `build`, `start`, `smoke`
(`frontend/scripts/smoke.mjs`).

## CI/CD status

The backend workflow lives at `backend/.github/workflows/ci-cd.yml`. It runs on
pushes and pull requests to `main`, with verify, deploy, and smoke jobs. The
verify job runs `npm ci`, typecheck, lint, format check, tests, and build. Deploy
applies migrations when `DATABASE_URL` is configured, triggers Render through
the API key/service ID or deploy hook, and the smoke job checks the live API
against the pushed commit.

## Deployment notes

- Apply migrations before starting production.
- Build both apps independently; they do not share a root workspace.
- The backend exposes `/health` and `/health/ready` for platform checks.
- Never commit secrets; provide them through the hosting platform.
