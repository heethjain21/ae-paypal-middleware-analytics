-- CreateTable
CREATE TABLE "requests" (
    "debug_id" TEXT NOT NULL,
    "site_url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status_code" SMALLINT NOT NULL,
    "duration" INTEGER NOT NULL,
    "paypal_request_id" TEXT,
    "raw_request" JSONB,
    "raw_response" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "error_stack" JSONB,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "plugin_version" TEXT NOT NULL,
    "internal_request_id" TEXT,
    "action_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("debug_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "capture_id" TEXT NOT NULL,
    "site_url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "net_amount" DECIMAL(19,4),
    "paypal_fee" DECIMAL(19,4),
    "gross_amount" DECIMAL(19,4),
    "platform_fee" DECIMAL(19,4),
    "currency" VARCHAR(3),
    "status" TEXT,
    "merchant_id" TEXT,
    "custom_id" TEXT,
    "invoice_id" TEXT,
    "paypal_create_time" TIMESTAMPTZ(3),
    "paypal_update_time" TIMESTAMPTZ(3),
    "debug_id" TEXT NOT NULL,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "plugin_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("capture_id")
);

-- CreateIndex
CREATE INDEX "requests_site_url_status_created_at_idx" ON "requests"("site_url", "status", "created_at");

-- CreateIndex
CREATE INDEX "requests_path_status_created_at_idx" ON "requests"("path", "status", "created_at");

-- CreateIndex
CREATE INDEX "requests_created_at_idx" ON "requests"("created_at");

-- CreateIndex
CREATE INDEX "requests_is_sandbox_idx" ON "requests"("is_sandbox");

-- CreateIndex
CREATE INDEX "payments_site_url_status_created_at_idx" ON "payments"("site_url", "status", "created_at");

-- CreateIndex
CREATE INDEX "payments_path_status_created_at_idx" ON "payments"("path", "status", "created_at");

-- CreateIndex
CREATE INDEX "payments_debug_id_idx" ON "payments"("debug_id");

-- CreateIndex
CREATE INDEX "payments_is_sandbox_idx" ON "payments"("is_sandbox");
