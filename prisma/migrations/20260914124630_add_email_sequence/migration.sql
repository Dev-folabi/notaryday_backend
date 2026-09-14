-- CreateTable
CREATE TABLE "email_sequences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequenceType" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day0SentAt" TIMESTAMPTZ,
    "day1SentAt" TIMESTAMPTZ,
    "day2SentAt" TIMESTAMPTZ,
    "day3SentAt" TIMESTAMPTZ,
    "day4SentAt" TIMESTAMPTZ,
    "currentDay" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_sequences_userId_key" ON "email_sequences"("userId");

-- AddForeignKey
ALTER TABLE "email_sequences" ADD CONSTRAINT "email_sequences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
