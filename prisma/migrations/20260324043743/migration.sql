BEGIN;

-- Rename tables (preserves all data)
ALTER TABLE "requests" RENAME TO "ppcp_requests";
ALTER TABLE "payments" RENAME TO "ppcp_payments";

-- Make site_url and plugin_version nullable in both tables
ALTER TABLE "ppcp_requests" ALTER COLUMN "site_url" DROP NOT NULL;
ALTER TABLE "ppcp_requests" ALTER COLUMN "plugin_version" DROP NOT NULL;

ALTER TABLE "ppcp_payments" ALTER COLUMN "site_url" DROP NOT NULL;
ALTER TABLE "ppcp_payments" ALTER COLUMN "plugin_version" DROP NOT NULL;

-- Rename primary key constraints
ALTER INDEX "requests_pkey" RENAME TO "ppcp_requests_pkey";
ALTER INDEX "payments_pkey" RENAME TO "ppcp_payments_pkey";

-- Rename indexes for ppcp_requests
ALTER INDEX "requests_site_url_status_created_at_idx" RENAME TO "ppcp_requests_site_url_status_created_at_idx";
ALTER INDEX "requests_path_status_created_at_idx" RENAME TO "ppcp_requests_path_status_created_at_idx";
ALTER INDEX "requests_created_at_idx" RENAME TO "ppcp_requests_created_at_idx";
ALTER INDEX "requests_is_sandbox_idx" RENAME TO "ppcp_requests_is_sandbox_idx";

-- Rename indexes for ppcp_payments
ALTER INDEX "payments_site_url_status_created_at_idx" RENAME TO "ppcp_payments_site_url_status_created_at_idx";
ALTER INDEX "payments_path_status_created_at_idx" RENAME TO "ppcp_payments_path_status_created_at_idx";
ALTER INDEX "payments_debug_id_idx" RENAME TO "ppcp_payments_debug_id_idx";
ALTER INDEX "payments_is_sandbox_idx" RENAME TO "ppcp_payments_is_sandbox_idx";

COMMIT;