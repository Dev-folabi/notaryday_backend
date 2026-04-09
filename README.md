# Notary Day — Backend API

<div align="center">

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-FF6B6B?style=for-the-badge&logo=redis&logoColor=white)

**Production-grade REST API powering a smart scheduling and business OS for mobile notaries in the United States.**

[Architecture](#architecture) · [Features](#features) · [API Reference](#api-reference) · [Getting Started](#getting-started) · [Testing](#testing)

</div>

---

## What Is This?

This is the backend for **Notary Day** — a SaaS product targeting full-time loan signing agents (LSAs) in the US. The product solves a scheduling problem no competitor has addressed: after every loan signing, notaries must spend 20–45 minutes scanning and electronically sending documents back to the title company (called a **scanback**). No existing tool accounts for this mandatory window when scheduling or accepting new jobs.

The backend powers five core capabilities:

1. **CITT Engine** ("Can I Take This?") — Given a prospective job's address, time, and type, instantly calculates: can the notary physically get there, what are their real net earnings after mileage, and does the scanback create a conflict with their next appointment. Delivers a verdict in < 3 seconds.
2. **Route Optimisation** — Multi-stop geographic sequencing of a notary's confirmed jobs for the day, with automatic scanback time-blocking inserted after qualifying signing types.
3. **Gap Finder** — Scans the notary's pending job queue and surfaces jobs that fit open windows in their confirmed schedule, ranked by net earnings.
4. **Smart Booking Page** — Public availability engine that calculates which time slots a notary can genuinely accept, factoring in drive time from their previous appointment and scanback clearance. Clients only ever see slots the notary can actually take.
5. **AI Job Import** — Processes forwarded confirmation emails and screenshots from 80+ signing platforms via OpenRouter API, extracts structured job data, and creates draft jobs for one-tap confirmation.

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Next.js)                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS + Session Cookie
┌─────────────────────────▼───────────────────────────────────────┐
│                    NestJS API  (:3001)                          │
│                                                                 │
│   AuthGuard → PlanGuard → Controller → Service → Prisma       │
│                                                                 │
│   Modules: auth · users · jobs · citt · routing · planner      │
│            booking · email-import · invoicing · billing        │
│            reports · calendar · notifications                  │
└──────┬──────────────┬───────────────────────┬───────────────────┘
       │              │                       │
┌──────▼──────┐ ┌─────▼──────┐ ┌─────────────▼───────────────────┐
│ PostgreSQL  │ │   Upstash  │ │        BullMQ Workers           │
│  (Prisma)   │ │   Redis    │ │                                 │
│             │ │            │ │  email-import · screenshot      │
│  14 models  │ │  Sessions  │ │  invoice · notification        │
│  migrations │ │  Cache     │ │  calendar-sync                 │
│  relations  │ │  Queues    │ │                                 │
└─────────────┘ └────────────┘ └─────────────────────────────────┘
                                          │
              ┌───────────────────────────┼─────────────────────┐
              │                           │                     │
    ┌─────────▼──────┐         ┌──────────▼──────┐  ┌──────────▼──────┐
    │ OpenRouteService│         │  OpenRouter API │  │     Resend      │
    │ (routing + ORS) │         │  (AI parsing)   │  │  (email + inbound)│
    └─────────────────┘         └─────────────────┘  └─────────────────┘
```

### Key Architectural Decisions

**NestJS over Express** — The domain complexity of Notary Day (14 distinct bounded contexts, shared guards, cross-cutting concerns) justified the NestJS module system and dependency injection from the start. Each domain module is self-contained and testable in isolation.

**Worker Process Separation** — BullMQ workers run as a separate Node process (`main-worker.ts`) from the API server. A slow AI parsing job (up to 15 seconds) never blocks API response times. The API enqueues and forgets; the worker processes asynchronously and notifies via the notification module.

**Redis as the Performance Layer** — Nominatim (the geocoding API) enforces a strict 1 request/second rate limit. Without aggressive caching, a notary entering 10 job addresses would take 10+ seconds. All geocoded coordinates are cached in Redis with a 30-day TTL, targeting a >90% cache hit rate. Route optimisation results are cached per user per date (1-hour TTL), invalidated on any job mutation for that date.

**Session-Based Auth over JWT** — For a server-rendered browser product, sessions are simpler, more secure (no client-side token storage), and instantly revocable. express-session backed by Redis via Upstash. JWT would add complexity with no benefit for this use case.

**Zod Validation on AI Outputs** — All OpenRouter API responses are validated against a strict Zod schema before any database write. The AI is a data extraction tool, not a trusted source. If validation fails, a partial form is shown and the user completes the missing fields manually. The system never silently creates bad data from a malformed AI response.

---

## Features

### Core Domain Logic

#### CITT (Can I Take This?) Engine
The heart of the product. Given a prospective job, runs three parallel checks:

```typescript
// Simplified illustration of the core algorithm
async runCITT(userId: string, dto: RunCITTDto): Promise<CITTResult> {
  // 1. Geocode prospective address (Redis cache first)
  const { lat, lng, distanceMiles } = await this.geocodingService.geocode(dto.address);

  // 2. Get origin: last confirmed job or home base
  const origin = await this.getOrigin(userId, dto.appointmentTime);

  // 3. ORS drive time call
  const { durationMins } = await this.orsService.getDriveTime(origin, { lat, lng });

  // 4. Profitability calculation
  const mileageCost = (distanceMiles * 2) * user.settings.irsRatePerMile;
  const netEarnings = dto.fee - mileageCost - (dto.platformFee ?? 0);
  const totalTimeHrs = (durationMins + signingMins + scanbackMins) / 60;
  const effectiveHourly = netEarnings / totalTimeHrs;

  // 5. Scanback conflict check
  const conflict = await this.conflictService.checkScanbackConflict(
    userId, dto.appointmentTime, signingMins, scanbackMins, durationMins
  );

  // 6. Verdict
  return this.verdictService.calculate({ durationMins, netEarnings, conflict });
}
```

**Verdict thresholds:**
- `TAKE_IT` — Schedule fits (≥10 min buffer) AND net earnings ≥ $20
- `RISKY` — Gap < 10 min buffer OR net earnings $10–$19
- `DECLINE` — Schedule conflict OR net earnings < $10

#### Route Optimisation Engine
Accepts all confirmed jobs for a date, calls OpenRouteService's optimisation endpoint (which uses Vroom internally for TSP solving), respects all appointment times as hard constraints, then automatically inserts scanback time blocks after qualifying signing types.

**Fallback chain:**
1. ORS optimisation → cached result
2. ORS unavailable → time-ordered sequence with cached drive times + "optimisation unavailable" banner
3. No cached drive times → time-ordered sequence only

#### Gap Finder
Post-optimisation, scans pending jobs against each open window in the confirmed schedule:

```
gap_start    = job_A.end + job_A.scanback + 10min_buffer
gap_end      = job_B.time - drive(gap_region → job_B) - 10min_buffer
time_needed  = drive(job_A → candidate) + candidate.signing
             + candidate.scanback + drive(candidate → job_B)

Surface if: time_needed ≤ (gap_end - gap_start)
Rank by:    net_earnings DESC
```

#### Booking Page Availability Engine
Computes available slots for a given date without ever exposing the notary's actual schedule to the client:

```
earliest_start = prev_job.end
               + prev_job.scanback_mins
               + ORS(prev_job_address → booking_address)
               + user.settings.bookingBufferMins

slot_available = requested_time ≥ earliest_start
              AND (booking_end + booking_scanback
                   + ORS(booking → next_job)) ≤ next_job.appointment_time
```

### Infrastructure & Cross-Cutting Concerns

**Global Exception Filter** — Catches all unhandled exceptions, logs with context, returns a consistent error envelope. NestJS's `HttpException` hierarchy maps to appropriate HTTP status codes. Unexpected errors return 500 with a sanitised message.

**Transform Interceptor** — Wraps all successful responses in `{ data: ..., meta: { timestamp } }`. Pagination responses include `page`, `limit`, `total`, `totalPages`.

**Rate Limiting** — `@nestjs/throttler` applied to all public endpoints: CITT (if called unauthenticated), booking page availability, and all auth routes. Configurable per-route via decorator.

**CSRF Protection** — `csurf` middleware on all POST/PUT/DELETE routes. The booking page and email import webhook are explicitly excluded (they use HMAC signature verification instead).

**Plan Guard** — `@RequiresPro()` decorator applies a guard that checks `req.user.plan` against `['PRO', 'PRO_ANNUAL']`. Returns 403 with a structured error the frontend uses to render the upgrade overlay. Never redirects.

---

## Project Structure

```
src/
├── main.ts                    # Bootstrap: helmet, session, CSRF, global pipes
├── main-worker.ts             # Worker process entry point (separate from API)
├── app.module.ts
│
├── config/
│   ├── configuration.ts       # Config factory
│   ├── validation.schema.ts   # Joi schema — all env vars validated at startup
│   └── redis.config.ts        # ioredis factory (Upstash TLS)
│
├── common/
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   └── plan.guard.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── requires-pro.decorator.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── transform.interceptor.ts
│   └── pipes/
│       └── zod-validation.pipe.ts
│
├── modules/
│   ├── auth/                  # Register, login, logout, password reset
│   ├── users/                 # Profile, settings, signing type defaults
│   ├── jobs/                  # CRUD, status machine, 4 entry methods
│   ├── citt/                  # CITT engine (ORS + profitability + conflict)
│   ├── geocoding/             # Nominatim + Redis cache (shared service)
│   ├── routing/               # ORS multi-stop, scanback blocking, fallback
│   ├── planner/               # Today view, gap finder
│   ├── booking/               # Public availability engine
│   ├── email-import/          # Resend inbound → BullMQ → OpenRouter
│   ├── screenshot-import/     # R2 upload → BullMQ → OpenRouter vision
│   ├── invoicing/             # PDF generation, Resend send, mark-paid
│   ├── reports/               # Earnings, mileage, journal, tax export
│   ├── calendar/              # Google OAuth, .ics feed generation
│   ├── notifications/         # @nestjs/schedule crons + Resend
│   └── billing/               # Lemon Squeezy subscription lifecycle
│
├── queues/
│   ├── queue.constants.ts
│   └── queue.module.ts
│
└── workers/
    ├── email-import.processor.ts
    ├── screenshot-import.processor.ts
    ├── invoice.processor.ts
    └── notification.processor.ts
```

---

## Database Schema

14 models across 3 concern layers. Full schema at `prisma/schema.prisma`.

**User & Settings Layer**
- `User` — authentication, plan tier, onboarding state, profile
- `UserSettings` — home base, IRS rate, booking page config, notification prefs, payment info
- `SigningTypeDefault` — per-user duration overrides for each of 6 signing types

**Core Operations Layer**
- `Job` — the central entity. 14 status values, 6 signing types, 5 source types. Stores computed profitability fields (net_earnings, effective_hourly) after route calculation. Compound indexes on `(user_id, appointment_time, status)` for Today view queries.
- `Booking` — client-submitted booking requests. Drives the `pending_review` → `confirmed` | `declined` flow.
- `EmailImport` — raw email + AI parse results + import status. Retained for debugging and duplicate detection.

**Business Operations Layer**
- `Invoice` — generated PDFs, payment tracking, mark-paid
- `Expense` — categorised business expenses with receipt storage
- `JournalEntry` — notarial journal (IRS-compliant act logging)
- `CalendarConnection` — Google OAuth tokens (encrypted at rest)
- `LemonSqueezyEvent` — idempotent webhook event log (prevents duplicate processing)
- `Notification` — in-app notification store
- `PasswordResetToken` — hashed, single-use, 1-hour expiry
- `GeocodeCache` — DB-layer geocode cache (Redis primary, this is warm-up and fallback)

**Enums:** `SigningType` (6 values) · `JobStatus` (8 values) · `JobSource` (5 values) · `PlanTier` (4 values) · `BookingStatus` (4 values) · `NotificationType` (9 values) · `ExpenseCategory` (8 values) · `ImportStatus` (5 values)

---

## API Reference

All endpoints prefixed `/api/v1/`. Full list of 45+ endpoints across 12 domains.

### Auth
```
POST   /auth/register
POST   /auth/login
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
GET    /auth/me
```

### CITT
```
POST   /citt/check              # Free tier — unlimited. The core acquisition hook.
```

### Jobs
```
GET    /jobs                    # ?date, ?status, ?page, ?limit
POST   /jobs
GET    /jobs/:id
PATCH  /jobs/:id
DELETE /jobs/:id
PATCH  /jobs/:id/status         # Status machine transitions
POST   /jobs/:id/invoice        # Pro — trigger invoice generation
```

### Smart Day Planner (Pro)
```
GET    /planner/today           # ?date — optimised sequence + scanback blocks + gap candidates
POST   /planner/optimise        # Trigger ORS optimisation for a date
GET    /planner/gaps            # ?date — gap finder results
```

### Public Booking Page
```
GET    /book/:username/slots    # ?date — available slots (no auth)
POST   /book/:username/request  # Submit booking (no auth)
```

### Billing
```
POST   /billing/subscribe       # Returns Lemon Squeezy checkout URL
POST   /billing/cancel
GET    /billing/portal          # Returns Lemon Squeezy customer portal URL
POST   /billing/webhook         # Lemon Squeezy webhook (HMAC verified)
```

### Response Envelope
```json
{
  "data": { },
  "meta": { "timestamp": "2026-04-15T10:00:00Z" }
}
```

```json
{
  "error": {
    "code": "PLAN_REQUIRED",
    "message": "This feature requires a Pro subscription",
    "statusCode": 403,
    "timestamp": "2026-04-15T10:00:00Z"
  }
}
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- An [Upstash](https://upstash.com) Redis database (free tier)
- An [OpenRouteService](https://openrouteservice.org) API key (free)
- A [Resend](https://resend.com) account (free tier)
- An [OpenRouter](https://openrouter.ai) API key (free models available)
- A [Lemon Squeezy](https://lemonsqueezy.com) store

### Installation

```bash
# From the repo root
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed signing type defaults
npx prisma db seed
```

### Environment Variables

Copy `.env.example` to `.env` and fill in all values. All variables are validated at startup via Joi — the server will refuse to start with a descriptive error if any required variable is missing.

```bash
cp .env.example .env
```

Key variables:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/notaryday
UPSTASH_REDIS_URL=rediss://...          # TLS URL from Upstash dashboard
SESSION_SECRET=...                       # Random 64-char string
ORS_API_KEY=...
OPENROUTER_API_KEY=...
OPENROUTER_DEFAULT_MODEL=mistralai/mistral-7b-instruct:free
RESEND_API_KEY=...
LEMONSQUEEZY_API_KEY=...
LEMONSQUEEZY_WEBHOOK_SECRET=...
APP_URL=http://localhost:3000
NODE_ENV=development
PORT=3001
```

### Running

```bash
# Start PostgreSQL (Docker)
docker-compose up -d

# Development — API server
npm run start:dev:api

# Development — Worker process (separate terminal)
npm run start:dev:worker

# Production
npm run build
npm run start:api
npm run start:worker
```

---

## Testing

```bash
# Unit tests
npm run test

# Unit tests with coverage
npm run test:cov

# E2E tests
npm run test:e2e
```

### Test Strategy

Unit tests cover all service methods containing business logic. External dependencies (ORS, Nominatim, OpenRouter, Resend, Lemon Squeezy) are fully mocked — no real API calls in the test suite.

**Critical test coverage targets:**

- `citt.service` — All verdict permutations (Take It / Risky / Decline), scanback conflict edge cases, ORS failure fallback
- `routing.service` — Multi-stop sequencing, hard constraint respect, scanback block insertion, ORS fallback
- `planner.service` (gap finder) — Gap window calculation, candidate ranking, empty schedule edge case
- `booking.service` (availability engine) — Slot availability with and without prior jobs, scanback clearance, buffer enforcement

Coverage target: 80%+ on the four modules above.

---

## Performance

| Operation | Target | Strategy |
|---|---|---|
| CITT response | < 3s | Redis geocode cache + ORS p95 latency |
| Route optimisation | < 3s | Redis route cache (1hr TTL) + ORS |
| Booking slot calculation | < 2s | Redis slot cache (2min TTL) |
| Email import parse | < 15s | Async BullMQ worker — does not block API |
| Geocoding cache hit rate | > 90% | 30-day Redis TTL + DB fallback |
| Page load (4G) | < 2.5s | Lean response payloads, no N+1 queries |

---

## Security

- **Passwords** — bcrypt, minimum 12 salt rounds
- **Sessions** — express-session backed by Upstash Redis. 24h default, 30d with remember-me. Secure + HttpOnly + SameSite=Lax cookies in production.
- **CSRF** — csurf middleware on all state-mutating routes
- **Helmet** — Security headers on all responses
- **Input validation** — class-validator + class-transformer on all DTOs. Whitelist mode: unknown fields stripped automatically.
- **AI output validation** — Zod schema on all OpenRouter responses before DB write
- **Webhook verification** — HMAC signature check on Lemon Squeezy and Resend inbound webhooks
- **Env validation** — Joi schema at startup. Missing variables crash the process with a clear error message rather than failing silently at runtime.
- **Booking page privacy** — The availability engine never exposes job addresses, client names, or schedule details. Clients see only boolean slot availability.
- **Rate limiting** — @nestjs/throttler on all public-facing endpoints
- **Password reset tokens** — UUID, hashed before storage, 1-hour expiry, single-use

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| Framework | NestJS | 10 |
| Language | TypeScript | 5 |
| Database | PostgreSQL | 16 |
| ORM | Prisma | 5 |
| Cache / Sessions | Redis (Upstash) via ioredis | 5 |
| Queue | BullMQ | 5 |
| Auth | Passport.js local + express-session | — |
| Routing API | OpenRouteService | v2 |
| Geocoding | Nominatim (OSM) | — |
| AI Parsing | OpenRouter API | — |
| Email | Resend | — |
| File Storage | Cloudflare R2 (S3-compatible) | — |
| Billing | Lemon Squeezy | — |
| PDF Generation | pdfkit | — |
| Calendar | Google Calendar API + ical-generator | — |
| Validation | class-validator + Zod | — |
| Security | helmet + csurf + bcrypt | — |
| Testing | Jest | 29 |

---

## Deployment

Designed for deployment on **Railway** or **Render**. Both support:
- Multiple services from a single repo (API process + Worker process)
- PostgreSQL managed database
- Automatic deploys from GitHub
- Environment variable management

The API and worker are deployed as separate services pointing at the same database and Upstash Redis instance. No additional infrastructure required.

---

<div align="center">
  <sub>Built by <a href="https://github.com/Dev-folabi">Yusuf Afolabi</a> · notaryday.app</sub>
</div>