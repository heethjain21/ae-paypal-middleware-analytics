import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type Payment = {
    capture_id: string;
    site_url: string;
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
    plugin_version: string;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Request = {
    debug_id: string;
    site_url: string;
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
    plugin_version: string;
    internal_request_id: string | null;
    action_name: string | null;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type DB = {
    payments: Payment;
    requests: Request;
};
