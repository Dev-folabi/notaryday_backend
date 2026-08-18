# Notary Day Backend

Notary Day is an operations platform for mobile notaries and loan signing agents. This repository contains the NestJS API that turns a notary's schedule, travel time, scanback obligations, and business costs into practical decisions.

The API is designed around a real operational constraint: after many loan signings, the notary must remain at the signing location to scan and return documents. That scanback window is treated as part of the appointment rather than an afterthought.

## What the API Provides

- **CITT, Can I Take This?** Calculates travel feasibility, scanback conflicts, net earnings, and effective hourly rate before a job is accepted.
- **Job management** Supports manual jobs, imported jobs, booking requests, status transitions, profitability fields, and pagination.
- **Smart planning** Produces a day view, route suggestions, scanback blocks, drive-time details, and gap opportunities.
- **Public booking availability** Shows clients only the time slots a notary can genuinely accept without exposing private schedule data.
- **Job import** Accepts inbound email and uploaded source material for asynchronous extraction into reviewable job data.
- **Business operations** Includes invoices, expense tracking, earnings and mileage reporting, notarial journal entries, notifications, and email templates.
- **Calendar integration** Supports Google Calendar connections and public ICS feeds.
- **Subscription billing** Integrates Lemon Squeezy checkout, customer portal, cancellation, and webhook lifecycle events.

## Architecture

The backend is organized as focused NestJS modules with dependency injection, shared infrastructure, and explicit domain boundaries.

| Layer | Implementation |
| --- | --- |
| API | NestJS 11 with TypeScript |
| Authentication | JWT Bearer tokens with Passport and bcrypt password hashing |
| Persistence | PostgreSQL with Prisma 7 and migrations |
| Caching and queues | Redis through ioredis and BullMQ |
| Geocoding and routing | Nominatim geocoding and OpenRouteService travel calculations |
| AI extraction | OpenRouter with Zod validation before persistence |
| Email | Resend for transactional and inbound email workflows |
| File storage | Cloudflare R2 through the S3-compatible SDK |
| Billing | Lemon Squeezy |
| Documents and calendars | PDFKit and ical-generator |
| Observability | Sentry and PostHog integrations |
| API documentation | Swagger in development |

### Domain Modules

The source tree includes modules for authentication, users, jobs, CITT, geocoding, planning, booking, job import, reports, calendar, notifications, billing, expenses, journal entries, invoices, email templates, analytics, and health checks.

### API and Worker Processes

The HTTP API and background workers have separate entry points. The API handles authenticated requests and enqueues long-running work. The worker process consumes BullMQ jobs for imports, invoice processing, notifications, and calendar synchronization. This keeps AI extraction and document generation away from request latency.

Redis is used for operational caching and queue coordination. The API can degrade gracefully when Redis is unavailable in development, while production requires a configured Redis connection.

## Core Business Logic

### CITT Decision Engine

The CITT workflow combines several signals into one actionable result:

1. Resolve the prospective address through the geocoding service and cache.
2. Select the previous confirmed appointment or the user's home base as the origin.
3. Retrieve travel distance and duration through OpenRouteService.
4. Calculate mileage cost, net earnings, total working time, and effective hourly earnings.
5. Check whether signing and scanback time can be completed before the next anchored appointment.
6. Return a `TAKE_IT`, `RISKY`, or `DECLINE` verdict with supporting details.

The profitability model is intentionally transparent:

- Net earnings = fee minus round-trip mileage cost minus platform fee.
- Effective hourly rate = net earnings divided by drive, signing, and scanback time.

### Planning and Availability

Confirmed jobs retain their appointment times as hard constraints. The planner accounts for travel between jobs, signing duration, scanback duration, and configurable buffers. When route optimization is unavailable, the backend can return a time-ordered fallback with an explicit degraded result.

The public booking engine applies the same constraints without revealing private appointments, addresses, client names, or route details.

### Asynchronous Import Processing

Inbound job information is queued for processing rather than parsed during the HTTP request. OpenRouter output is validated with Zod before it can become job data. Invalid or incomplete extraction results remain reviewable so the user can correct them manually.

## API Conventions

All routes are prefixed with `/api/v1`.

- Authenticated routes use the `Authorization: Bearer <token>` header.
- Public routes explicitly opt out of the global authentication guard.
- Successful responses use a consistent `{ success, data, meta }` envelope.
- Errors use `{ success: false, error }` with a stable status code and message.
- DTOs are validated and unknown input is rejected or stripped according to the endpoint contract.
- Pagination metadata includes the current page, limit, total, and total pages where applicable.
- Pro-only functionality is enforced through feature guards and structured errors. Data is not deleted or hidden when a plan changes.

## Repository Layout

Important backend directories include:

- `src/modules`: domain modules and controllers
- `src/common`: guards, decorators, filters, interceptors, pipes, and shared services
- `src/config`: environment, Redis, and Prisma configuration
- `src/queues`: BullMQ registration and queue constants
- `src/workers`: background processors
- `prisma`: schema, migrations, and seed data
- `generated`: Prisma client output used by the build process

## Requirements

- Node.js 20 or newer
- PostgreSQL
- Redis or Upstash Redis
- API credentials for the external services used by the features you enable

The main integrations are OpenRouteService, OpenRouter, Resend, Cloudflare R2, Google Calendar, and Lemon Squeezy. Environment variables are validated with Joi during startup. Review `.env.example` for the complete configuration surface.

## Local Development

From this repository:

1. Install dependencies with `npm install`.
2. Create `.env` from `.env.example` and provide the required values.
3. Generate the Prisma client with `npx prisma generate`.
4. Apply migrations with `npx prisma migrate dev`.
5. Seed default signing type data with `npx prisma db seed`.
6. Start the API with `npm run start:dev`.
7. Start the worker in a second terminal with `npm run start:dev:worker` when using import, invoice, notification, or calendar jobs.

The API runs on port `4000` by default. Swagger is available at `/docs` in development.

For a production-style local run, use `npm run build`, then run `npm run start:prod` for the API and `npm run start:worker` for background processing.

## Verification

- `npm run lint` runs ESLint with automatic fixes.
- `npm test` runs the Jest suite.
- `npm run test:cov` generates coverage output.
- `npm run test:e2e` runs end-to-end tests.
- `npm run build` generates Prisma artifacts, compiles NestJS, and copies runtime assets into `dist`.

Tests isolate external services such as OpenRouteService, Nominatim, OpenRouter, Resend, and Lemon Squeezy. The highest-value scenarios cover CITT verdicts, profitability, scanback conflicts, planner behavior, public booking availability, and worker-driven workflows.

## Engineering Highlights

- Domain logic is isolated in testable NestJS services.
- Prisma provides typed persistence and migration history.
- Redis caching reduces repeated geocoding and route requests.
- BullMQ separates slow or retryable work from the request path.
- AI extraction is treated as untrusted input and validated before database writes.
- Public booking responses preserve schedule privacy by returning availability rather than internal calendar data.
- Global response and exception handling gives the frontend a predictable API contract.

## License

This project is private and not licensed for redistribution.

Built by [Yusuf Afolabi](https://github.com/Dev-folabi) for [notaryday.app](https://notaryday.app).
