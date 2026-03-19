import { Context, SQSEvent, SQSRecord } from "aws-lambda";
import fs from "fs";
import { Insertable, Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import {
  DB,
  Request as RequestTable,
  Payment as PaymentTable,
} from "./types/database.types";

/**
 * IMPORTANT:
 * Pool size MUST be small for Lambda or you will exhaust Postgres connections.
 */
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({
      user: process.env.AWS_RDS_DB_USER,
      password: process.env.AWS_RDS_DB_PASSWORD,
      host: process.env.AWS_RDS_DB_URL,
      database: process.env.AWS_RDS_DB_NAME,
      port: 5432,

      max: 3, // SAFE for Lambda
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,

      ssl: {
        rejectUnauthorized: true,
        ca: fs.readFileSync("rds-us-east-2-bundle.pem").toString(),
      },
    }),
  }),
});

interface RequestData {
  request_id: string;

  metadata: {
    test_mode: "yes" | "no";
    wp_home: string;
    plugin_version: string;
  };

  request_url: string;
  request_headers: any;
  request_method: string;
  request_body: any;
  request_action_name: string;

  response_headers: any;
  response_body: any;
  response_status_code: string;

  duration: string;
  created_at: string;
}

interface ExtractedFinancials {
  capture_id: string;
  net_amount: number | null;
  paypal_fee: number | null;
  gross_amount: number | null;
  platform_fee: number | null;
  currency: string | null;
  status: string | null;
  merchant_id: string | null;
  custom_id: string | null;
  invoice_id: string | null;
  paypal_create_time: Date | null;
  paypal_update_time: Date | null;
}

interface SQSMessage {
  table: "requests";
  operation: "upsert" | "delete";
  data: RequestData;
}

interface BatchItemFailure {
  itemIdentifier: string;
}

interface LambdaResponse {
  batchItemFailures: BatchItemFailure[];
}

export const handler = async (
  event: SQSEvent,
  context: Context,
): Promise<LambdaResponse> => {

  let skipped = 0;

  // IMPORTANT for Lambda + DB pools
  context.callbackWaitsForEmptyEventLoop = false;

  console.log(`Processing ${event.Records.length} SQS messages`);

  const failedMessageIds = new Set<string>();
  const requestItems: Array<{
    record: SQSRecord;
    message: SQSMessage;
    debugId: string;
  }> = [];
  const paymentItems: Array<{
    record: SQSRecord;
    message: SQSMessage;
    debugId: string;
  }> = [];

  for (const record of event.Records) {
    try {
      if (!record.body) throw new Error("Message body is empty");

      const messageData = JSON.parse(record.body) as SQSMessage;

      if (!messageData.table || !messageData.operation || !messageData.data) {
        throw new Error(
          "Invalid message format: missing table, operation, or data",
        );
      }

      // Many calls might just be for dns / ip related checks, and it returns body as an IP address
      if (messageData.table === "requests") {
        const responseBody = messageData.data.response_body;
        if (typeof responseBody === "string") {
          try {
            JSON.parse(responseBody.trim());
          } catch {
            // If JSON parse failed, it means its not a JSON string and some regular string
            // Now, we check if its an IP addres like request, and if it is, its confirmed we can skip it
            if (responseBody.trim().length < 25 && responseBody.split(".").length === 4) {
              skipped++;
              continue;
            }
          }
        }

        const debugId = getDebugId(messageData.data);
        requestItems.push({ record, message: messageData, debugId });
        const method = messageData.data.request_method;
        const code = Number(messageData.data.response_status_code);
        if (
          isPaymentPath(messageData.data.request_url) &&
          method === "POST" && code > 200 && code < 300
        ) {
          paymentItems.push({ record, message: messageData, debugId });
        }
      } else {
        throw new Error(`Unknown table: ${messageData.table}`);
      }
    } catch (error) {
      console.error(`Failed to parse message ${record.messageId}:`, error);
      failedMessageIds.add(record.messageId);
    }
  }

  if (requestItems.length > 0) {
    const failures = await batchUpsertRequests(requestItems);
    failures.forEach((f) => failedMessageIds.add(f.itemIdentifier));
  }

  if (paymentItems.length > 0) {
    const failures = await batchUpsertPayments(paymentItems);
    failures.forEach((f) => failedMessageIds.add(f.itemIdentifier));
  }

  console.log(
    `Processed ${
      event.Records.length - failedMessageIds.size
    } successfully, ${failedMessageIds.size} failed, ${skipped} skipped`,
  );

  return {
    batchItemFailures: Array.from(failedMessageIds).map((id) => ({
      itemIdentifier: id,
    })),
  };
};

const toJson = (value: any) => {
  if (Array.isArray(value)) return toJson(value[0]);
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return { body: value };
  else if (typeof value === "object") return value;
  else return { body: value };
};

// Amounts stored as NUMERIC(19,4) — exact value as PayPal sends, no conversion needed.
const toAmount = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return isNaN(n) ? null : n;
};

const toDate = (value: string | null | undefined): Date | null => {
  if (value == null) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const getPath = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

const extractError = (
  statusCode: number,
  responseBody: any,
): {
  error_code: string | null;
  error_message: string | null;
  error_stack: any;
} => {
  if (statusCode < 400 || !responseBody) {
    return { error_code: null, error_message: null, error_stack: null };
  }

  if (statusCode === 404 && Object.keys(responseBody).length === 0) {
    return {
      error_code: "NOT_FOUND",
      error_message: "The requested resource could not be found.",
      error_stack: null,
    };
  }

  const stack = responseBody.details ?? null;

  return {
    error_code: responseBody.name ?? responseBody.error ?? null,
    error_message:
      responseBody.message ?? responseBody.error_description ?? null,
    error_stack: stack && Array.isArray(stack) ? { stack } : null,
  };
};

const getDebugId = (rawData: RequestData): string =>
  rawData.response_headers?.["paypal-debug-id"] ?? crypto.randomUUID();

const isPaymentPath = (path: string): boolean => {
  try {
    const segments = new URL(path).pathname.split("/").filter(Boolean);
    const action = segments.at(-1);
    const resource = segments.at(-3);
    return (
      (resource === "orders" && action === "capture") ||
      (resource === "authorizations" && action === "capture") ||
      (resource === "captures" && action === "refund")
    );
  } catch {
    return false;
  }
};

const buildRequestRow = (
  rawData: RequestData,
  debugId: string,
): Insertable<RequestTable> => {
  const responseStatusCode = Number(rawData.response_status_code);

  const status =
    responseStatusCode >= 200 && responseStatusCode < 300 ? "SUCCESS" : "FAILED";

  return {
    debug_id: debugId,

    site_url: rawData.metadata.wp_home,
    status,

    path: getPath(rawData.request_url),
    method: rawData.request_method,
    status_code: responseStatusCode,
    duration: Number(rawData.duration) || 0,

    paypal_request_id: rawData.request_headers?.["PayPal-Request-Id"] ?? null,

    raw_request: toJson(rawData.request_body),
    raw_response: toJson(rawData.response_body),

    ...extractError(responseStatusCode, toJson(rawData.response_body)),

    is_sandbox: rawData.metadata.test_mode === "yes",
    plugin_version: rawData.metadata.plugin_version,
    internal_request_id: rawData.request_id,
    action_name: rawData.request_action_name,

    created_at: new Date(rawData.created_at),
  };
};

const buildPaymentRows = (
  rawData: RequestData,
  debugId: string,
): Insertable<PaymentTable>[] => {
  const financialsList = extractFinancials(
    rawData.request_url,
    toJson(rawData.response_body),
  );

  return financialsList.map((financials) => ({
    debug_id: debugId,
    site_url: rawData.metadata?.wp_home,
    path: getPath(rawData.request_url),
    duration: Number(rawData.duration) || 0,
    ...financials,
    is_sandbox: rawData.metadata.test_mode === "yes",
    plugin_version: rawData.metadata?.plugin_version,
  }));
};

const upsertRequestsQuery = (rows: Insertable<RequestTable>[]) =>
  db
    .insertInto("requests")
    .values(rows)
    .onConflict((oc) =>
      oc.column("debug_id").doUpdateSet({
        site_url: sql`excluded.site_url`,
        status: sql`excluded.status`,
        path: sql`excluded.path`,
        method: sql`excluded.method`,
        status_code: sql`excluded.status_code`,
        duration: sql`excluded.duration`,
        paypal_request_id: sql`excluded.paypal_request_id`,
        raw_request: sql`excluded.raw_request`,
        raw_response: sql`excluded.raw_response`,
        error_code: sql`excluded.error_code`,
        error_message: sql`excluded.error_message`,
        error_stack: sql`excluded.error_stack`,
        is_sandbox: sql`excluded.is_sandbox`,
        plugin_version: sql`excluded.plugin_version`,
        internal_request_id: sql`excluded.internal_request_id`,
        created_at: sql`excluded.created_at`,
      }),
    );

const upsertPaymentsQuery = (rows: Insertable<PaymentTable>[]) =>
  db
    .insertInto("payments")
    .values(rows)
    .onConflict((oc) =>
      oc.column("capture_id").doUpdateSet({
        debug_id: sql`excluded.debug_id`,
        path: sql`excluded.path`,
        site_url: sql`excluded.site_url`,
        duration: sql`excluded.duration`,
        net_amount: sql`excluded.net_amount`,
        paypal_fee: sql`excluded.paypal_fee`,
        gross_amount: sql`excluded.gross_amount`,
        platform_fee: sql`excluded.platform_fee`,
        currency: sql`excluded.currency`,
        status: sql`excluded.status`,
        merchant_id: sql`excluded.merchant_id`,
        custom_id: sql`excluded.custom_id`,
        invoice_id: sql`excluded.invoice_id`,
        paypal_create_time: sql`excluded.paypal_create_time`,
        paypal_update_time: sql`excluded.paypal_update_time`,
      }),
    );

const batchUpsertRequests = async (
  items: Array<{ record: SQSRecord; message: SQSMessage; debugId: string }>,
): Promise<BatchItemFailure[]> => {
  const rows = items.map(({ message, debugId }) =>
    buildRequestRow(message.data, debugId),
  );

  try {
    await upsertRequestsQuery(rows).execute();
    console.log(`Successfully batch upserted ${rows.length} requests`);
    return [];
  } catch (error) {
    console.error(
      "Batch upsert failed, falling back to individual inserts:",
      error,
    );

    const failures: BatchItemFailure[] = [];

    await Promise.all(
      items.map(async ({ record, message, debugId }) => {
        try {
          await upsertRequestsQuery([
            buildRequestRow(message.data, debugId),
          ]).execute();
        } catch (err) {
          console.error(`Failed to process message ${record.messageId}:`, err);
          console.log(
            "error message: ",
            JSON.stringify(buildRequestRow(message.data, debugId), null, 2),
          );
          failures.push({ itemIdentifier: record.messageId });
        }
      }),
    );

    return failures;
  }
};

const batchUpsertPayments = async (
  items: Array<{ record: SQSRecord; message: SQSMessage; debugId: string }>,
): Promise<BatchItemFailure[]> => {
  // One message can produce multiple rows (multiple captures / purchase_units)
  const rowItems = items.flatMap(({ record, message, debugId }) =>
    buildPaymentRows(message.data, debugId).map((row) => ({ record, row })),
  );

  if (rowItems.length === 0) return [];

  const rows = rowItems.map(({ row }) => row);

  try {
    await upsertPaymentsQuery(rows).execute();
    console.log(`Successfully batch upserted ${rows.length} payments`);
    return [];
  } catch (error) {
    console.error(
      "Payments batch upsert failed, falling back to individual inserts:",
      error,
    );

    const failures: BatchItemFailure[] = [];
    const failedMessageIds = new Set<string>();

    await Promise.all(
      rowItems.map(async ({ record, row }) => {
        try {
          await upsertPaymentsQuery([row]).execute();
        } catch (err) {
          console.error(
            `Failed to process payment for message ${record.messageId}:`,
            err,
          );
          if (!failedMessageIds.has(record.messageId)) {
            failedMessageIds.add(record.messageId);
            failures.push({ itemIdentifier: record.messageId });
          }
        }
      }),
    );

    return failures;
  }
};

const extractFinancials = (
  path: string,
  rawResponse: any,
): ExtractedFinancials[] => {
  if (!rawResponse || typeof rawResponse !== "object") return [];

  const segments = new URL(path).pathname.split("/").filter(Boolean);

  const action = segments.at(-1);
  const resource = segments.at(-3);

  // /v2/checkout/orders/{id}/capture
  // Can have multiple purchase_units, each with multiple captures
  if (resource === "orders" && action === "capture") {
    const results: ExtractedFinancials[] = [];

    for (const purchaseUnit of rawResponse.purchase_units ?? []) {
      const merchantId = purchaseUnit.payee?.merchant_id ?? null;

      for (const capture of purchaseUnit.payments?.captures ?? []) {
        
        // Skip failed captures
        if (!capture.id || capture.status === "FAILED") continue;

        const currency = capture.amount?.currency_code ?? null;
        const breakdown = capture.seller_receivable_breakdown;
        results.push({
          capture_id: capture.id,
          net_amount: toAmount(breakdown?.net_amount?.value),
          paypal_fee: toAmount(breakdown?.paypal_fee?.value),
          gross_amount: breakdown
            ? toAmount(breakdown?.gross_amount?.value)
            : toAmount(capture.amount?.value), // for pending/partial completed trxn, we only have gross_amount and no seller_receivable_breakdown
          platform_fee: toAmount(breakdown?.platform_fees?.[0]?.amount?.value),
          currency,
          status: capture.status ?? null,
          merchant_id: merchantId,
          custom_id: capture.custom_id ?? null,
          invoice_id: capture.invoice_id ?? null,
          paypal_create_time: toDate(capture.create_time),
          paypal_update_time: toDate(capture.update_time),
        });
      }
    }

    return results;
  }

  // /v2/payments/authorizations/{id}/capture
  if (resource === "authorizations" && action === "capture") {
    if (!rawResponse.id || rawResponse.status === "FAILED") return [];

    const currency = rawResponse.amount?.currency_code ?? null;
    const breakdown = rawResponse.seller_receivable_breakdown;
    return [
      {
        capture_id: rawResponse.id,
        net_amount: toAmount(breakdown?.net_amount?.value),
        paypal_fee: toAmount(breakdown?.paypal_fee?.value),
        gross_amount: breakdown
          ? toAmount(breakdown?.gross_amount?.value)
          : toAmount(rawResponse.amount?.value), // for pending/partial completed trxn, we only have gross_amount and no seller_receivable_breakdown
        platform_fee: toAmount(breakdown?.platform_fees?.[0]?.amount?.value),
        currency,
        status: rawResponse.status ?? null,
        merchant_id: rawResponse.payee?.merchant_id ?? null,
        custom_id: rawResponse.custom_id ?? null,
        invoice_id: rawResponse.invoice_id ?? null,
        paypal_create_time: toDate(rawResponse.create_time),
        paypal_update_time: toDate(rawResponse.update_time),
      },
    ];
  }

  // /v2/payments/captures/{id}/refund
  if (resource === "captures" && action === "refund") {
    if (!rawResponse.id || rawResponse.status === "FAILED") return [];

    const currency = rawResponse.amount?.currency_code ?? null;
    const refundAmount = toAmount(rawResponse.amount?.value);
    return [
      {
        capture_id: rawResponse.id,
        net_amount: null,
        paypal_fee: null,
        gross_amount: refundAmount != null ? refundAmount * -1 : null,
        platform_fee: null,
        currency,
        status: rawResponse.status ?? null,
        merchant_id: null,
        custom_id: null,
        invoice_id: null,
        paypal_create_time: null,
        paypal_update_time: null,
      },
    ];
  }

  return [];
};
