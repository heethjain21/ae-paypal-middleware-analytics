import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type { RequestStatus } from "./database.enums";

export type Request = {
    debug_id: string;
    site_url: string;
    status: RequestStatus;
    path: string;
    method: string;
    code: number;
    duration: number;
    paypal_request_id: string | null;
    raw_request: unknown | null;
    raw_response: unknown | null;
    error_code: string | null;
    error_message: string | null;
    error_stack: unknown | null;
    is_sandbox: Generated<boolean>;
    plugin_version: string;
    internal_request_id: string;
    created_at: Timestamp;
    updated_at: Generated<Timestamp>;
};
export type DB = {
    requests: Request;
};
