# Notary Day — Backend Intelligence File
> NestJS API | Node.js + TypeScript | PostgreSQL + Prisma | BullMQ + Redis
> Read the root CLAUDE.md first. This file adds backend-specific detail only.

---

## 1. Project Bootstrap

```bash
# Scaffold (already done if src/ exists)
nest new notaryday_backend --package-manager npm --language typescript

# Core dependencies
npm install @nestjs/config @nestjs/throttler @nestjs/schedule @nestjs/bull
npm install @nestjs/passport passport passport-local express-session
npm install @prisma/client prisma
npm install ioredis bullmq
npm install bcrypt class-validator class-transformer zod
npm install axios resend @lemonsqueezy/lemonsqueezy-js
npm install @aws-sdk/client-s3  # Cloudflare R2 is S3-compatible
npm install ical-generator      # .ics feed generation
npm install pdfkit               # Tax report PDF generation
npm install joi                  # Env var validation schema
npm install helmet               # Security headers
npm install csurf                # CSRF protection
npm install connect-redis        # Session store backed by Redis

# Dev dependencies
npm install -D @types/passport-local @types/express-session @types/bcrypt
npm install -D @types/csurf @types/pdfkit
```

---

## 2. Module Architecture

Every domain is a self-contained NestJS module. No cross-module direct imports of services — communicate via exported services or events only.

```
src/
├── main.ts                         ← Bootstrap, helmet, session, CSRF, global pipes
├── app.module.ts                   ← Root module, imports all domain modules
│
├── config/
│   ├── configuration.ts            ← Config factory (reads process.env)
│   ├── validation.schema.ts        ← Joi schema — ALL env vars validated here
│   └── redis.config.ts             ← ioredis connection factory (Upstash TLS)
│
├── common/
│   ├── guards/
│   │   ├── auth.guard.ts           ← Requires valid session
│   │   └── plan.guard.ts           ← @RequiresPro() decorator — checks user.plan
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── requires-pro.decorator.ts
│   ├── filters/
│   │   └── http-exception.filter.ts  ← Global exception filter, structured error responses
│   ├── interceptors/
│   │   └── transform.interceptor.ts  ← Wraps all responses in { data, meta } envelope
│   └── pipes/
│       └── zod-validation.pipe.ts    ← Generic Zod validation pipe for AI outputs
│
├── modules/
│   ├── auth/                       ← Register, login, logout, password reset
│   ├── users/                      ← Profile, settings (IRS rate, home base, signing defaults)
│   ├── jobs/                       ← CRUD, status transitions, all 4 entry methods
│   ├── citt/                       ← CITT engine (ORS + profitability + conflict check)
│   ├── geocoding/                  ← Nominatim calls + Redis cache (shared service)
│   ├── routing/                    ← ORS multi-stop optimisation, scanback blocking
│   ├── planner/                    ← Smart Day Planner: today view, gap finder
│   ├── booking/                    ← Public booking page, availability engine
│   ├── email-import/               ← Resend inbound webhook → BullMQ → OpenRouter
│   ├── screenshot-import/          ← R2 upload → BullMQ → OpenRouter vision
│   ├── invoicing/                  ← Invoice generation, pdfkit + Resend
│   ├── reports/                    ← Earnings, mileage, notarial journal, tax export
│   ├── calendar/                   ← Google OAuth, .ics feed
│   ├── notifications/              ← Resend transactional + @nestjs/schedule crons
│   └── billing/                    ← Lemon Squeezy subscription lifecycle, webhooks
│
├── queues/
│   ├── queue.constants.ts          ← Queue name constants (NEVER use raw strings)
│   └── queue.module.ts             ← BullMQ module registration
│
└── workers/
    ├── workers.module.ts           ← Separate entry point for worker process
    ├── email-import.processor.ts
    ├── screenshot-import.processor.ts
    ├── invoice.processor.ts
    └── notification.processor.ts
```

### Worker Process Separation

Run workers as a **separate process** from the API. Two entry points:

```typescript
// src/main.ts        → API server (port 4000)
// src/main-worker.ts → BullMQ worker process (no HTTP server)
```

```json
// package.json scripts
{
  "start:api": "nest start",
  "start:worker": "node dist/main-worker",
  "start:dev:api": "nest start --watch",
  "start:dev:worker": "ts-node src/main-worker.ts"
}
```

This prevents a slow AI parsing job from blocking API responses.

---

## 3. main.ts Bootstrap (Full Setup)

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as session from 'express-session';
import * as connectRedis from 'connect-redis';
import * as csurf from 'csurf';
import * as helmet from 'helmet';
import { createClient } from 'ioredis';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Security headers
  app.use(helmet());

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS — tighten in production
  app.enableCors({
    origin: config.get('APP_URL'),
    credentials: true,
  });

  // Session with Redis store (Upstash via ioredis)
  const RedisStore = connectRedis(session);
  const redisClient = new IORedis(config.get('UPSTASH_REDIS_URL'), {
    tls: { rejectUnauthorized: false },
  });

  app.use(
    session({
      store: new RedisStore({ client: redisClient }),
      secret: config.get('SESSION_SECRET'),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.get('NODE_ENV') === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24h default
        sameSite: 'lax',
      },
    }),
  );

  // CSRF — exclude inbound email webhook and Lemon Squeezy webhook (they use HMAC auth)
  app.use((req, res, next) => {
    const excluded = ['/api/v1/email-import/inbound', '/api/v1/billing/webhook'];
    if (excluded.includes(req.path)) return next();
    csurf({ cookie: false })(req, res, next);
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Lemon Squeezy unknown fields
      forbidNonWhitelisted: true,
      transform: true,           // Auto-transform to DTO types
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global response transform
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.listen(config.get('PORT') ?? 4000);
}
bootstrap();
```

---

## 4. Prisma — Usage Rules

- **Never** write raw SQL except for complex reporting queries. Use Prisma client everywhere else.
- **Always** use transactions (`prisma.$transaction`) when multiple tables are written atomically (e.g. job create + calendar event create).
- **Never** expose Prisma model objects directly in API responses. Always map to a DTO/response shape.
- Run migrations with `npx prisma migrate dev --name <description>`. Name migrations descriptively.
- Seed file lives at `prisma/seed.ts`. Run with `npx prisma db seed`.
- Generate client after every schema change: `npx prisma generate`.

---

## 5. Redis / Upstash — Cache Key Conventions

Connect with ioredis using the Upstash TLS URL. All keys follow this pattern:

```
{resource}:{userId}:{qualifier}
```

| Cache Key | TTL | Purpose |
|---|---|---|
| `geocode:{address_hash}` | 30 days | Geocoded lat/lng — never re-geocode same address |
| `route:{userId}:{date}` | 1 hour | Optimised route for a user's day |
| `citt:{userId}:{address_hash}:{time}` | 5 min | CITT result (short TTL — schedule changes) |
| `booking:slots:{username}:{date}` | 2 min | Available booking slots |
| `ors:matrix:{hash}` | 6 hours | ORS distance matrix result |
| `session:{sessionId}` | 24h / 30d | express-session store |

**Invalidation rules:**
- When any job on date D is created/edited/deleted for user U → `DEL route:{U}:{D}`
- When any job's status changes → `DEL route:{U}:{date_of_job}`
- Geocode cache is never invalidated (addresses don't change)

**Geocoding rate limit defence:** Nominatim allows 1 req/sec. The geocoding service MUST check Redis before any Nominatim call. A 90%+ cache hit rate is required after month 1. Log every cache miss.

---

## 6. BullMQ — Queue Definitions

```typescript
// queues/queue.constants.ts
export const QUEUE_EMAIL_IMPORT = 'email-import';
export const QUEUE_SCREENSHOT_IMPORT = 'screenshot-import';
export const QUEUE_INVOICE = 'invoice';
export const QUEUE_NOTIFICATION = 'notification';
export const QUEUE_CALENDAR_SYNC = 'calendar-sync';
```

**Queue configuration:**
```typescript
{
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,   // Keep last 100 completed jobs
    removeOnFail: 200,       // Keep last 200 failed jobs for debugging
  }
}
```

**Job data shapes (always typed with interfaces):**
```typescript
interface EmailImportJobData {
  userId: string;
  emailId: string;        // Resend message ID
  rawEmailText: string;
  fromAddress: string;
  receivedAt: string;
}

interface InvoiceJobData {
  userId: string;
  jobId: string;
  recipientEmail: string;
}

interface NotificationJobData {
  userId: string;
  type: 'reminder' | 'booking_received' | 'booking_confirmed' | 'eta';
  payload: Record<string, unknown>;
}
```

---

## 7. OpenRouter Integration (AI Parsing)

Use OpenRouter for all AI calls. Default to free models. Validate every response with Zod before touching the DB.

```typescript
// modules/email-import/openrouter.service.ts
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = process.env.OPENROUTER_DEFAULT_MODEL ?? 'mistralai/mistral-7b-instruct:free';

// Email parse prompt — always instruct to return JSON only
const EMAIL_PARSE_SYSTEM_PROMPT = `
You are a data extraction assistant. Extract signing appointment details from forwarded email confirmation text.
Return ONLY valid JSON matching this exact schema. No explanation, no markdown, no preamble.
{
  "address": string | null,
  "appointment_time": ISO8601 string | null,
  "signing_type": "general" | "loan_refi" | "hybrid" | "purchase_closing" | "field_inspection" | "apostille" | null,
  "fee": number | null,
  "platform_fee": number | null,
  "client_name": string | null,
  "platform_name": string | null,
  "notes": string | null
}
`;

// Zod schema for validation
const EmailParseResultSchema = z.object({
  address: z.string().nullable(),
  appointment_time: z.string().datetime().nullable(),
  signing_type: z.enum(['general','loan_refi','hybrid','purchase_closing','field_inspection','apostille']).nullable(),
  fee: z.number().min(0).max(10000).nullable(),
  platform_fee: z.number().min(0).max(1000).nullable(),
  client_name: z.string().max(200).nullable(),
  platform_name: z.string().max(100).nullable(),
  notes: z.string().max(1000).nullable(),
});
```

**Rules:**
- Always wrap OpenRouter calls in try/catch
- If parse fails validation → partial form shown, user completes manually (never silently discard)
- Log all AI calls with model, tokens used, and success/failure for cost tracking
- For screenshot import, use a vision-capable model: `google/gemini-flash-1.5` (check free tier availability on OpenRouter first)

---

## 8. ORS (OpenRouteService) Integration

```typescript
// Base URL
const ORS_BASE = 'https://api.openrouteservice.org/v2';

// Drive time (single leg — for CITT)
// GET /directions/driving-car?start={lng,lat}&end={lng,lat}
// Response: routes[0].summary.duration (seconds), distance (metres)

// Matrix (multi-stop optimisation)
// POST /matrix/driving-car
// Body: { locations: [[lng,lat], ...], metrics: ['duration', 'distance'] }

// Optimisation (multi-stop with time windows)
// POST /optimization (uses Vroom internally)
// Body: { jobs: [...], vehicles: [...] }
```

**Fallback behaviour:** If ORS returns 5xx or times out:
- For CITT: return error state "Drive time check unavailable — please try again shortly". Do NOT show CITT result without drive time.
- For route optimisation: fall back to time-ordered sequence. Show "Route optimisation temporarily unavailable — showing time order" banner.
- Log every ORS failure with request details for debugging.

**Rate limit awareness:** ORS free tier: 2,000 req/day total, 500 matrix req/day. Cache aggressively. Never call ORS for the same address pair within the same hour.

---

## 9. Auth Module Details

```typescript
// Strategy: Passport local (email + password)
// Session: express-session backed by Redis (connect-redis)

// User identification in session: req.session.userId (UUID string)

// Password reset flow:
// 1. User requests reset → generate UUID token, hash it, store in PasswordResetToken table with 1h expiry
// 2. Send Resend email with reset URL: {APP_URL}/reset-password?token={raw_token}
// 3. User submits new password → find token by hash, verify not expired, update password, delete token

// Route guards:
// @UseGuards(AuthGuard)     → requires valid session
// @RequiresPro()            → additionally requires user.plan === 'pro' or 'pro_annual'
```

---

## 10. API Endpoint Reference (Complete)

All endpoints prefixed with `/api/v1/`.

```
AUTH
POST   /auth/register               Public
POST   /auth/login                  Public
POST   /auth/logout                 Auth
POST   /auth/forgot-password        Public
POST   /auth/reset-password         Public
GET    /auth/me                     Auth → returns session user

USERS / SETTINGS
GET    /users/profile               Auth
PATCH  /users/profile               Auth
GET    /users/settings              Auth
PATCH  /users/settings              Auth   (IRS rate, home base, signing durations, notification prefs)
GET    /users/username-check/:slug  Public (onboarding uniqueness check)

JOBS
GET    /jobs                        Auth   (?date, ?status, ?page, ?limit)
POST   /jobs                        Auth
GET    /jobs/:id                    Auth
PATCH  /jobs/:id                    Auth
DELETE /jobs/:id                    Auth
PATCH  /jobs/:id/status             Auth   (status transition)
POST   /jobs/:id/invoice            Auth   Pro — trigger invoice generation

CITT
POST   /citt/check                  Auth   (free tier — unlimited)

PLANNER (Pro)
GET    /planner/today               Auth   (?date defaults to today)
POST   /planner/optimise            Auth   Pro
GET    /planner/gaps                Auth   Pro (?date)

BOOKING (Pro — notary config)
GET    /booking/settings            Auth   Pro
PATCH  /booking/settings            Auth   Pro

PUBLIC BOOKING PAGE
GET    /book/:username              Public → served by Next.js, not API
GET    /book/:username/slots        Public (?date)
POST   /book/:username/request      Public (create pending_review job)

BOOKINGS (notary review)
GET    /bookings                    Auth   Pro (?status=pending_review)
GET    /bookings/:id                Auth   Pro
PATCH  /bookings/:id/approve        Auth   Pro
PATCH  /bookings/:id/decline        Auth   Pro

EMAIL IMPORT
POST   /email-import/inbound        Public (Resend webhook — HMAC verified, no CSRF)

SCREENSHOT IMPORT (Pro)
POST   /screenshot-import/upload    Auth   Pro (multipart, saves to R2, enqueues job)

REPORTS
GET    /reports/earnings            Auth   (?from, ?to, ?groupBy)
GET    /reports/mileage             Auth   (?year)
GET    /reports/tax                 Auth   Pro (?year) → PDF download
GET    /reports/journal             Auth   (?from, ?to)
POST   /reports/journal             Auth   (add journal entry)

CALENDAR (Pro)
GET    /calendar/auth/google        Auth   Pro (OAuth redirect)
GET    /calendar/auth/google/callback Auth Pro
DELETE /calendar/disconnect         Auth   Pro
GET    /calendar/:token/feed.ics    Public (ICS feed — token is per-user secret)

BILLING
POST   /billing/subscribe           Auth   (returns LS checkout URL → frontend redirects)
POST   /billing/cancel              Auth
GET    /billing/portal              Auth   (returns LS customer portal URL)
POST   /billing/webhook             Public (Lemon Squeezy webhook — HMAC verified, no CSRF)

INVOICING
POST   /jobs/:id/invoice            Auth   Pro — generate PDF + send via Resend
GET    /invoices/:id                Auth   Pro — view invoice details
PATCH  /invoices/:id/mark-paid      Auth   Pro — manually mark invoice as paid
GET    /invoices                    Auth   Pro — list all invoices (?status=paid|unpaid)

NOTIFICATIONS
GET    /notifications               Auth
PATCH  /notifications/:id/read      Auth
```

---

## 11. Response Envelope

All API responses follow this shape (enforced by `TransformInterceptor`):

```typescript
// Success
{
  "success": true,
  "data": { ... } | [ ... ],
  "meta": { "timestamp": "2026-04-01T10:00:00Z" }
}

// Paginated
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "timestamp": "...",
    "page": 1,
    "limit": 20,
    "total": 145,
    "totalPages": 8
  }
}

// Error (from HttpExceptionFilter)
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "address is required",
    "statusCode": 400,
    "timestamp": "..."
  }
}
```

---

## 12. Testing Standards

- Unit test every service method that contains business logic (CITT engine, profitability formula, gap finder, availability engine).
- Use Jest. File naming: `{name}.service.spec.ts`.
- Mock all external calls (ORS, Nominatim, OpenRouter, Resend, Lemon Squeezy) — never hit real APIs in tests.
- Test CITT scanback conflict detection with explicit time scenarios.
- Test availability engine with edge cases: scanback after last job, no confirmed jobs (use home base), gap too small.
- Coverage target: 80%+ on `modules/citt`, `modules/routing`, `modules/planner`, `modules/booking`.

---

## 13. Signing Type Defaults (Seed Data)

These are the default durations. Users can override per-type in Settings, and per-job in the job form.

| Signing Type | Default Signing Duration | Default Scanback Duration | Total Block |
|---|---|---|---|
| general | 30 min | 0 min | 30 min |
| loan_refi | 60 min | 20 min | 80 min |
| hybrid | 75 min | 18 min | 93 min |
| purchase_closing | 90 min | 28 min | 118 min |
| field_inspection | 45 min | 0 min | 45 min |
| apostille | 20 min | 0 min | 20 min |

Scanback is 0 for general, field_inspection, and apostille — they require no document scanning.

## 14. Invoice Generation (No Payment Gateway)

### How It Works
1. Notary marks job as complete (status → complete)
2. Auto-trigger: QUEUE_INVOICE job enqueued
3. Worker generates PDF invoice via pdfkit
4. PDF emailed to recipient via Resend
5. Invoice record created in DB (is_paid: false)
6. Notary taps "Mark as paid" when payment arrives → is_paid: true, paid_at: now()

### Invoice PDF Contents
- Notary's full name, phone, email, NNA credentials
- Invoice number (INV-YYYY-NNNN — sequential per user)
- Job date, address, signing type, duration
- Itemised fees: base fee, travel fee (if applicable)
- Total due
- Notary's payment details block (from UserSettings.payment_info)
- "Payment due upon receipt" note

### UserSettings additions needed for invoicing
payment_info: Json   // { zelle?: string, venmo?: string, paypal?: string, 
                     //   bank_name?: string, account_last4?: string, 
                     //   routing_last4?: string, other?: string }
invoice_notes: String?  // Default note printed on every invoice e.g. 
                        // "Thank you for your business"
invoice_due_days: Int   @default(0)  // 0 = due on receipt, 30 = net 30

### Lemon Squeezy Webhook Events to Handle
- order_created       → plan activated (one-time — not subscription)
- subscription_created → plan set to PRO or PRO_ANNUAL
- subscription_updated → handle plan changes, renewal
- subscription_cancelled → schedule downgrade at period end
- subscription_expired → set plan back to FREE
- subscription_payment_failed → email notary, retain access until expiry