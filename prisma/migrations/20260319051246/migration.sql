/*
  Warnings:

  - You are about to drop the column `internal_request_id` on the `payments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "payments" DROP COLUMN "internal_request_id";
