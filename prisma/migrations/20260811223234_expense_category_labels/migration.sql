/*
  Warnings:

  - Changed the type of `category` on the `expenses` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "expenses" DROP COLUMN "category",
ADD COLUMN     "category" VARCHAR(50) NOT NULL;

-- DropEnum
DROP TYPE "ExpenseCategory";

-- CreateIndex
CREATE INDEX "expenses_user_id_category_idx" ON "expenses"("user_id", "category");
