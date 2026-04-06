/*
  Warnings:

  - You are about to drop the column `is_sandbox` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `is_sandbox` on the `payments_sandbox` table. All the data in the column will be lost.
  - You are about to drop the `all_payments` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "payments_correlation_id_idx";

-- DropIndex
DROP INDEX "payments_debug_id_idx";

-- DropIndex
DROP INDEX "payments_is_sandbox_idx";

-- DropIndex
DROP INDEX "payments_merchant_id_req_status_created_at_idx";

-- DropIndex
DROP INDEX "payments_product_id_req_status_created_at_idx";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "is_sandbox";

-- AlterTable
ALTER TABLE "payments_sandbox" DROP COLUMN "is_sandbox";

-- DropTable
DROP TABLE "all_payments";

-- CreateIndex
CREATE INDEX "payments_merchant_id_created_at_idx" ON "payments"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_product_id_created_at_idx" ON "payments"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_trxn_type_created_at_idx" ON "payments"("trxn_type", "created_at");
