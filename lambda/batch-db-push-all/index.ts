import { Context, SQSEvent, SQSRecord } from "aws-lambda";
import fs from "fs";
import { Insertable, Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { DB, Payment as PaymentTable } from "./types/database.types";

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

interface PaymentData {
  trxn_id: string;
  site_url: string | null;
  merchant_id: string | null;
  req_status: string;
  net_amount: string | null;
  paypal_fee: string | null;
  gross_amount: string | null;
  platform_fee: string | null;
  currency: string | null;
  correlation_id: string | null;
  trxn_type: string | null;
  custom_id: string | null;
  invoice_id: string | null;
  debug_id: string | null;
  meta_data: object | null;
  product_id: string | null;
  is_sandbox: boolean;
  created_at: number | string;
}

interface SQSMessage {
  table: "all_payments" | "payments";
  operation: "upsert";
  data: PaymentData;
}

interface BatchItemFailure {
  itemIdentifier: string;
}

interface LambdaResponse {
  batchItemFailures: BatchItemFailure[];
}

// Amounts stored as NUMERIC(19,4)
const toAmount = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return isNaN(n) ? null : n;
};

const toProductId = (
  value: string | number | null | undefined,
): number | null => {
  if (value == null || value === "-") return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  return isNaN(n) ? null : n;
};

const toNullableString = (value: string | null | undefined): string | null => {
  if (value == null || value === "-") return null;
  return value;
};

const toJson = (value: any) => {
  if (value === "-" || value === null || value === undefined) return null;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return { body: value };
    }
  } else if (typeof value === "object") return value;
  else {
    return { body: value };
  }
};

const buildPaymentRow = (rawData: PaymentData): Insertable<PaymentTable> => {
  let createdAt: Date;
  if (typeof rawData.created_at === "number") {
    createdAt = new Date(rawData.created_at * 1000);
  } else {
    createdAt = new Date(rawData.created_at);
  }

  return {
    trxn_id: rawData.trxn_id,
    req_status: rawData.req_status,
    site_url: toNullableString(rawData.site_url),
    merchant_id: toNullableString(rawData.merchant_id),
    net_amount: toAmount(rawData.net_amount),
    paypal_fee: toAmount(rawData.paypal_fee),
    gross_amount: toAmount(rawData.gross_amount),
    platform_fee: toAmount(rawData.platform_fee),
    currency: toNullableString(rawData.currency),
    correlation_id: toNullableString(rawData.correlation_id),
    trxn_type: toNullableString(rawData.trxn_type),
    custom_id: toNullableString(rawData.custom_id),
    invoice_id: toNullableString(rawData.invoice_id),
    debug_id: toNullableString(rawData.debug_id),
    meta_data: toJson(rawData.meta_data) ?? null,
    product_id: toProductId(rawData.product_id),
    is_sandbox: rawData.is_sandbox ?? false,
    created_at: createdAt,
  };
};

const upsertPaymentsQuery = (rows: Insertable<PaymentTable>[]) =>
  db
    .insertInto("payments")
    .values(rows)
    .onConflict((oc) =>
      oc.columns(["trxn_id", "req_status"]).doUpdateSet({
        site_url: sql`excluded.site_url`,
        merchant_id: sql`excluded.merchant_id`,
        net_amount: sql`excluded.net_amount`,
        paypal_fee: sql`excluded.paypal_fee`,
        gross_amount: sql`excluded.gross_amount`,
        platform_fee: sql`excluded.platform_fee`,
        currency: sql`excluded.currency`,
        correlation_id: sql`excluded.correlation_id`,
        trxn_type: sql`excluded.trxn_type`,
        custom_id: sql`excluded.custom_id`,
        invoice_id: sql`excluded.invoice_id`,
        debug_id: sql`excluded.debug_id`,
        meta_data: sql`excluded.meta_data`,
        product_id: sql`excluded.product_id`,
        is_sandbox: sql`excluded.is_sandbox`,
        created_at: sql`excluded.created_at`,
      }),
    );

const batchUpsertPayments = async (
  items: Array<{ record: SQSRecord; message: SQSMessage }>,
): Promise<BatchItemFailure[]> => {
  const rows = items.map(({ message }) => buildPaymentRow(message.data));

  try {
    await upsertPaymentsQuery(rows).execute();
    console.log(`Successfully batch upserted ${rows.length} payments`);
    return [];
  } catch (error) {
    console.error(
      "Batch upsert failed, falling back to individual inserts:",
      error,
    );

    const failures: BatchItemFailure[] = [];

    await Promise.all(
      items.map(async ({ record, message }) => {
        try {
          await upsertPaymentsQuery([buildPaymentRow(message.data)]).execute();
        } catch (err) {
          console.error(`Failed to process message ${record.messageId}:`, err);
          console.log(
            "error message: ",
            JSON.stringify(buildPaymentRow(message.data), null, 2),
          );
          failures.push({ itemIdentifier: record.messageId });
        }
      }),
    );

    return failures;
  }
};

export const handler = async (
  event: SQSEvent,
  context: Context,
): Promise<LambdaResponse> => {
  // IMPORTANT for Lambda + DB pools
  context.callbackWaitsForEmptyEventLoop = false;

  console.log(`Processing ${event.Records.length} SQS messages`);

  const failedMessageIds = new Set<string>();
  const paymentItems: Array<{
    record: SQSRecord;
    message: SQSMessage;
  }> = [];

  for (const record of event.Records) {
    try {
      if (!record.body) throw new Error("Message body is empty");

      let messageData;
      try {
        messageData = JSON.parse(record.body);
      } catch (err) {
        const sanitizedBody = record.body.replace(/\\\\"/g, '\\"');
        messageData = JSON.parse(sanitizedBody);
      }

      if (!messageData.table || !messageData.operation || !messageData.data) {
        throw new Error(
          "Invalid message format: missing table, operation, or data",
        );
      }

      if (
        messageData.table === "payments" ||
        messageData.table === "all_payments"
      ) {
        paymentItems.push({ record, message: messageData });
      } else {
        throw new Error(`Unknown table: ${messageData.table}`);
      }
    } catch (error) {
      console.error(`Failed to parse message ${record.messageId}:`, error);
      failedMessageIds.add(record.messageId);
    }
  }

  let failedPayments: string[] = [];

  if (paymentItems.length > 0) {
    const failures = await batchUpsertPayments(paymentItems);
    failures.forEach((f) => {
      failedPayments.push(f.itemIdentifier);
      failedMessageIds.add(f.itemIdentifier);
    });
  }

  console.log(
    JSON.stringify({
      msg: "processing_result",
      total_messages: event.Records.length,
      payments_to_save: paymentItems.length,
      payments_actually_saved: paymentItems.length - failedPayments.length,
      total_failed_messages: failedMessageIds.size,
    }),
  );

  return {
    batchItemFailures: Array.from(failedMessageIds).map((id) => ({
      itemIdentifier: id,
    })),
  };
};
