-- CreateTable
CREATE TABLE "mileage_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "miles_date" TIMESTAMPTZ NOT NULL,
    "miles" DECIMAL(8,2) NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "mileage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mileage_entries_user_id_miles_date_idx" ON "mileage_entries"("user_id", "miles_date");

-- AddForeignKey
ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
