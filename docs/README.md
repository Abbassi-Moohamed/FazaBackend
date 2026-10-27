# Backend Documentation Index

This directory contains code-grounded documentation for the Faza backend
(Express + Mongoose, Node 22).

- [Architecture](./architecture.md) - App factory, middleware, routing, bootstrapping, realtime
- [Auth & RBAC](./auth.md) - PIN auth, JWT, roles, ownership checks
- [API Contracts](./api-contracts.md) - Routes, envelopes, validators, errors
- [Data Model & Migrations](./data-model.md) - Models, indexes, migrations, lifecycle
- [Ordering & Offers](./ordering-offers.md) - Cart validation, sessions/shifts, offers, stock/compensation
- [Admin Backoffice](./admin-backoffice.md) - App admin, Coffee admin, tables/shifts/sessions, insights
- [Media & Storage](./images-storage.md) - Uploads, video trimming, Cloudflare R2, ownership/cleanup
- [Realtime](./realtime.md) - Socket.IO rooms/events/auth
- [Config & Environment](./config-env.md) - Env schema, defaults, CORS, build info
- [Testing & CI](./testing-ci.md) - Tests, smoke, deploy, workflows
- [Known Limitations & Defects](./known-limitations.md) - Findings from code review
