-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "requests" (
    "debug_id" VARCHAR(64) NOT NULL,
    "site_url" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "paypal_request_id" TEXT,
    "raw_request" JSONB,
    "raw_response" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "error_stack" JSONB,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "plugin_version" TEXT NOT NULL,
    "internal_request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("debug_id")
);

-- CreateIndex
CREATE INDEX "requests_paypal_request_id_created_at_idx" ON "requests"("paypal_request_id", "created_at");

-- CreateIndex
CREATE INDEX "requests_site_url_created_at_idx" ON "requests"("site_url", "created_at");

-- CreateIndex
CREATE INDEX "requests_status_created_at_idx" ON "requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "requests_path_created_at_idx" ON "requests"("path", "created_at");

-- CreateIndex
CREATE INDEX "requests_created_at_idx" ON "requests"("created_at");

-- CreateIndex
CREATE INDEX "requests_is_sandbox_created_at_idx" ON "requests"("is_sandbox", "created_at");
