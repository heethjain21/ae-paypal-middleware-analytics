import type { ColumnType } from "kysely";
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type Payment = {
  trxn_id: string;
  req_status: string;
  site_url: string | null;
  merchant_id: string | null;
  net_amount: number | null;
  paypal_fee: number | null;
  gross_amount: number | null;
  platform_fee: number | null;
  currency: string | null;
  correlation_id: string | null;
  trxn_type: string | null;
  custom_id: string | null;
  invoice_id: string | null;
  debug_id: string | null;
  meta_data: unknown | null;
  product_id: number | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
};
export type Payment_Sandbox = {
  trxn_id: string;
  req_status: string;
  site_url: string | null;
  merchant_id: string | null;
  net_amount: number | null;
  paypal_fee: number | null;
  gross_amount: number | null;
  platform_fee: number | null;
  currency: string | null;
  correlation_id: string | null;
  trxn_type: string | null;
  custom_id: string | null;
  invoice_id: string | null;
  debug_id: string | null;
  meta_data: unknown | null;
  product_id: number | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
};
export type PPCP_Payment = {
  capture_id: string;
  site_url: string | null;
  path: string;
  duration: number;
  net_amount: number | null;
  paypal_fee: number | null;
  gross_amount: number | null;
  platform_fee: number | null;
  currency: string | null;
  status: string | null;
  merchant_id: string | null;
  custom_id: string | null;
  invoice_id: string | null;
  paypal_create_time: Timestamp | null;
  paypal_update_time: Timestamp | null;
  debug_id: string;
  is_sandbox: Generated<boolean>;
  plugin_version: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
};
export type PPCP_Request = {
  debug_id: string;
  site_url: string | null;
  status: string;
  path: string;
  method: string;
  status_code: number;
  duration: number;
  paypal_request_id: string | null;
  raw_request: unknown | null;
  raw_response: unknown | null;
  error_code: string | null;
  error_message: string | null;
  error_stack: unknown | null;
  is_sandbox: Generated<boolean>;
  plugin_version: string | null;
  internal_request_id: string | null;
  action_name: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
};
export type DB = {
  payments: Payment;
  payments_sandbox: Payment_Sandbox;
  ppcp_payments: PPCP_Payment;
  ppcp_requests: PPCP_Request;
};
