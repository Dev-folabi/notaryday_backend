-- Race-safe exclusive booking slots + client-facing timezone + booking ref.

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN "timezone" TEXT DEFAULT 'America/New_York';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_ref_key" ON "bookings"("ref");
