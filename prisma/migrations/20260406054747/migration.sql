-- CreateTable
CREATE TABLE "payments_sandbox" (
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

    CONSTRAINT "payments_sandbox_pkey" PRIMARY KEY ("trxn_id","req_status")
);

-- CreateIndex
CREATE INDEX "payments_sandbox_merchant_id_created_at_idx" ON "payments_sandbox"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_sandbox_product_id_created_at_idx" ON "payments_sandbox"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_sandbox_trxn_type_created_at_idx" ON "payments_sandbox"("trxn_type", "created_at");
