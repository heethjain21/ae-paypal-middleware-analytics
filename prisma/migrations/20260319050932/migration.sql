/*
  Warnings:

  - You are about to drop the column `internal_request_id` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `req_status` on the `payments` table. All the data in the column will be lost.
  - Added the required column `reference_id` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "payments_req_status_created_at_idx";

-- AlterTable
BEGIN;

ALTER TABLE "payments"
RENAME COLUMN "req_status" TO "reference_id";

ALTER TABLE "payments"
ALTER COLUMN "reference_id" TYPE text
USING "reference_id"::text;

COMMIT;