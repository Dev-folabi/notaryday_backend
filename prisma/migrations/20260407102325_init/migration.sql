-- CreateEnum
CREATE TYPE "SigningType" AS ENUM ('GENERAL', 'LOAN_REFI', 'HYBRID', 'PURCHASE_CLOSING', 'FIELD_INSPECTION', 'APOSTILLE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PENDING_REVIEW', 'CONFIRMED', 'IN_PROGRESS', 'SCANNING', 'COMPLETE', 'CANCELLED', 'DECLINED');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('MANUAL', 'EMAIL_IMPORT', 'SCREENSHOT', 'BOOKING_PAGE', 'CSV');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PRO', 'PRO_ANNUAL', 'TEAM');

-- CreateEnum
CREATE TYPE "NavApp" AS ENUM ('GOOGLE_MAPS', 'APPLE_MAPS', 'WAZE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'DECLINED', 'CANCELLED_BY_CLIENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BOOKING_RECEIVED', 'BOOKING_CONFIRMED', 'BOOKING_DECLINED', 'JOB_REMINDER', 'CLIENT_ETA', 'INVOICE_SENT', 'PAYMENT_RECEIVED', 'PLAN_UPGRADED', 'PLAN_CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MILEAGE', 'SUPPLIES', 'EDUCATION', 'INSURANCE', 'EQUIPMENT', 'MARKETING', 'SOFTWARE', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETE', 'FAILED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "full_name" TEXT,
    "phone" TEXT,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "plan_expires_at" TIMESTAMPTZ,
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_step" INTEGER NOT NULL DEFAULT 1,
    "nna_certified" BOOLEAN NOT NULL DEFAULT false,
    "bio" TEXT,
    "credentials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "home_base_address" TEXT,
    "home_base_lat" DECIMAL(10,7),
    "home_base_lng" DECIMAL(10,7),
    "irs_rate_per_mile" DECIMAL(5,4) NOT NULL DEFAULT 0.72,
    "vehicle_type" TEXT,
    "min_acceptable_net" DECIMAL(8,2) NOT NULL DEFAULT 20.00,
    "booking_page_enabled" BOOLEAN NOT NULL DEFAULT false,
    "booking_page_bio" TEXT,
    "service_area_miles" INTEGER NOT NULL DEFAULT 25,
    "booking_buffer_mins" INTEGER NOT NULL DEFAULT 15,
    "booking_page_active_hours" JSONB,
    "booking_page_services" JSONB,
    "payment_info" JSONB,
    "invoice_notes" TEXT,
    "invoice_due_days" INTEGER NOT NULL DEFAULT 0,
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_lead_mins" INTEGER NOT NULL DEFAULT 60,
    "client_eta_enabled" BOOLEAN NOT NULL DEFAULT true,
    "preferred_nav_app" "NavApp" NOT NULL DEFAULT 'GOOGLE_MAPS',
    "ics_feed_token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_type_defaults" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "signing_type" "SigningType" NOT NULL,
    "signing_duration_mins" INTEGER NOT NULL,
    "scanback_duration_mins" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "signing_type_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "appointment_time" TIMESTAMPTZ NOT NULL,
    "signing_duration_mins" INTEGER NOT NULL,
    "scanback_duration_mins" INTEGER NOT NULL DEFAULT 0,
    "signing_ends_at" TIMESTAMPTZ,
    "scanback_ends_at" TIMESTAMPTZ,
    "signing_type" "SigningType" NOT NULL DEFAULT 'GENERAL',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "source" "JobSource" NOT NULL DEFAULT 'MANUAL',
    "fee" DECIMAL(8,2) NOT NULL,
    "platform_fee" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "mileage_miles" DECIMAL(8,2),
    "mileage_cost" DECIMAL(8,2),
    "net_earnings" DECIMAL(8,2),
    "effective_hourly" DECIMAL(8,2),
    "client_name" TEXT,
    "client_phone" TEXT,
    "client_email" TEXT,
    "platform_name" TEXT,
    "signer_count" INTEGER NOT NULL DEFAULT 1,
    "booking_id" TEXT,
    "email_import_id" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "scanning_started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "notes" TEXT,
    "route_sequence" INTEGER,
    "drive_from_prev_mins" INTEGER,
    "drive_from_prev_miles" DECIMAL(8,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "notary_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_email" TEXT NOT NULL,
    "client_phone" TEXT,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "service_type" "SigningType" NOT NULL,
    "requested_time" TIMESTAMPTZ NOT NULL,
    "document_type" TEXT,
    "notes" TEXT,
    "base_fee" DECIMAL(8,2) NOT NULL,
    "travel_fee_estimate" DECIMAL(8,2),
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "declined_reason" TEXT,
    "alternative_times" TIMESTAMPTZ[],
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_imports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resend_message_id" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT,
    "raw_text" TEXT NOT NULL,
    "raw_html" TEXT,
    "parsed_address" TEXT,
    "parsed_appointment_time" TIMESTAMPTZ,
    "parsed_signing_type" "SigningType",
    "parsed_fee" DECIMAL(8,2),
    "parsed_platform_fee" DECIMAL(8,2),
    "parsed_client_name" TEXT,
    "parsed_platform_name" TEXT,
    "parsed_notes" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "error_message" TEXT,
    "ai_model_used" TEXT,
    "ai_tokens_used" INTEGER,
    "received_at" TIMESTAMPTZ NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "subtotal" DECIMAL(8,2) NOT NULL,
    "travel_fee" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(8,2) NOT NULL,
    "payment_method_used" TEXT,
    "pdf_url" TEXT,
    "sent_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "resend_email_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(8,2) NOT NULL,
    "description" TEXT NOT NULL,
    "expense_date" DATE NOT NULL,
    "receipt_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT,
    "entry_date" DATE NOT NULL,
    "act_type" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_id_type" TEXT,
    "signer_id_number" TEXT,
    "document_type" TEXT,
    "address" TEXT,
    "fee_charged" DECIMAL(8,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "google_access_token" TEXT,
    "google_refresh_token" TEXT,
    "google_calendar_id" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ,
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lemonsqueezy_events" (
    "id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lemonsqueezy_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "job_id" TEXT,
    "booking_id" TEXT,
    "action_url" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geocode_cache" (
    "id" TEXT NOT NULL,
    "address_normalised" TEXT NOT NULL,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'nominatim',
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_subscription_id_key" ON "users"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_ics_feed_token_key" ON "user_settings"("ics_feed_token");

-- CreateIndex
CREATE UNIQUE INDEX "signing_type_defaults_user_id_signing_type_key" ON "signing_type_defaults"("user_id", "signing_type");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_booking_id_key" ON "jobs"("booking_id");

-- CreateIndex
CREATE INDEX "jobs_user_id_appointment_time_idx" ON "jobs"("user_id", "appointment_time");

-- CreateIndex
CREATE INDEX "jobs_user_id_status_idx" ON "jobs"("user_id", "status");

-- CreateIndex
CREATE INDEX "jobs_user_id_appointment_time_status_idx" ON "jobs"("user_id", "appointment_time", "status");

-- CreateIndex
CREATE INDEX "bookings_notary_id_status_idx" ON "bookings"("notary_id", "status");

-- CreateIndex
CREATE INDEX "bookings_notary_id_requested_time_idx" ON "bookings"("notary_id", "requested_time");

-- CreateIndex
CREATE UNIQUE INDEX "email_imports_resend_message_id_key" ON "email_imports"("resend_message_id");

-- CreateIndex
CREATE INDEX "email_imports_user_id_status_idx" ON "email_imports"("user_id", "status");

-- CreateIndex
CREATE INDEX "email_imports_user_id_received_at_idx" ON "email_imports"("user_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_job_id_key" ON "invoices"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_user_id_created_at_idx" ON "invoices"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "expenses_user_id_expense_date_idx" ON "expenses"("user_id", "expense_date");

-- CreateIndex
CREATE INDEX "expenses_user_id_category_idx" ON "expenses"("user_id", "category");

-- CreateIndex
CREATE INDEX "journal_entries_user_id_entry_date_idx" ON "journal_entries"("user_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_user_id_provider_key" ON "calendar_connections"("user_id", "provider");

-- CreateIndex
CREATE INDEX "lemonsqueezy_events_event_name_processed_idx" ON "lemonsqueezy_events"("event_name", "processed");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "geocode_cache_address_normalised_key" ON "geocode_cache"("address_normalised");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_type_defaults" ADD CONSTRAINT "signing_type_defaults_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_email_import_id_fkey" FOREIGN KEY ("email_import_id") REFERENCES "email_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_notary_id_fkey" FOREIGN KEY ("notary_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_imports" ADD CONSTRAINT "email_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
