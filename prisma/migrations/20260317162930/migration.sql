-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "action_name" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "debug_id" VARCHAR(64) NOT NULL,
    "site_url" TEXT NOT NULL,
    "req_status" "RequestStatus" NOT NULL,
    "path" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "paypal_request_id" TEXT,
    "net_amount" DOUBLE PRECISION,
    "paypal_fee" DOUBLE PRECISION,
    "gross_amount" DOUBLE PRECISION,
    "platform_fee" DOUBLE PRECISION,
    "currency" VARCHAR(3),
    "trxn_status" VARCHAR(32),
    "merchant_id" VARCHAR(64),
    "custom_id" VARCHAR(127),
    "invoice_id" VARCHAR(127),
    "paypal_create_time" TIMESTAMP(3),
    "paypal_update_time" TIMESTAMP(3),
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "plugin_version" TEXT NOT NULL,
    "internal_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("debug_id")
);

-- CreateIndex
CREATE INDEX "payments_debug_id_idx" ON "payments"("debug_id");

-- CreateIndex
CREATE INDEX "payments_site_url_created_at_idx" ON "payments"("site_url", "created_at");

-- CreateIndex
CREATE INDEX "payments_req_status_created_at_idx" ON "payments"("req_status", "created_at");

-- CreateIndex
CREATE INDEX "payments_path_created_at_idx" ON "payments"("path", "created_at");

-- CreateIndex
CREATE INDEX "payments_trxn_status_created_at_idx" ON "payments"("trxn_status", "created_at");

-- CreateIndex
CREATE INDEX "payments_is_sandbox_created_at_idx" ON "payments"("is_sandbox", "created_at");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");
