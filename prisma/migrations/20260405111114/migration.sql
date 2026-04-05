-- CreateTable
CREATE TABLE "payments" (
    "trxn_id" TEXT NOT NULL,
    "req_status" TEXT NOT NULL,
    "site_url" TEXT,
    "merchant_id" TEXT,
    "net_amount" DECIMAL(19,4),
    "paypal_fee" DECIMAL(19,4),
    "gross_amount" DECIMAL(19,4),
    "platform_fee" DECIMAL(19,4),
    "currency" VARCHAR(3),
    "correlation_id" TEXT,
    "trxn_type" TEXT,
    "custom_id" TEXT,
    "invoice_id" TEXT,
    "debug_id" TEXT,
    "meta_data" JSONB,
    "product_id" SMALLINT,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("trxn_id","req_status")
);

-- CreateIndex
CREATE INDEX "payments_merchant_id_req_status_created_at_idx" ON "payments"("merchant_id", "req_status", "created_at");

-- CreateIndex
CREATE INDEX "payments_product_id_req_status_created_at_idx" ON "payments"("product_id", "req_status", "created_at");

-- CreateIndex
CREATE INDEX "payments_correlation_id_idx" ON "payments"("correlation_id");

-- CreateIndex
CREATE INDEX "payments_debug_id_idx" ON "payments"("debug_id");

-- CreateIndex
CREATE INDEX "payments_is_sandbox_idx" ON "payments"("is_sandbox");
