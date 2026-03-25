-- CreateTable
CREATE TABLE "all_payments" (
    "trxn_id" TEXT NOT NULL,
    "site_url" TEXT,
    "merchant_id" TEXT,
    "req_status" TEXT,
    "gross_amount" DECIMAL(19,4),
    "currency" VARCHAR(3),
    "correlation_id" TEXT,
    "trxn_type" TEXT,
    "product_id" SMALLINT,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "all_payments_pkey" PRIMARY KEY ("trxn_id")
);

-- CreateIndex
CREATE INDEX "all_payments_merchant_id_req_status_created_at_idx" ON "all_payments"("merchant_id", "req_status", "created_at");

-- CreateIndex
CREATE INDEX "all_payments_product_id_req_status_created_at_idx" ON "all_payments"("product_id", "req_status", "created_at");

-- CreateIndex
CREATE INDEX "all_payments_correlation_id_idx" ON "all_payments"("correlation_id");

-- CreateIndex
CREATE INDEX "all_payments_is_sandbox_idx" ON "all_payments"("is_sandbox");
