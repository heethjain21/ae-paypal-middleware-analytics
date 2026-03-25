import { Context, SQSEvent, SQSRecord } from "aws-lambda";
import fs from "fs";
import { Insertable, Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import {
  DB,
  All_Payment as AllPaymentTable,
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

interface AllPaymentData {
  trxn_id: string;
  site_url: string | null;
  merchant_id: string | null;
  req_status: string;
  gross_amount: string;
  currency: string | null;
  correlation_id: string | null;
  trxn_type: string | null;
  product_id: string | null;
  is_sandbox: boolean;
  created_at: number | string;
}

interface SQSMessage {
  table: "all_payments";
  operation: "upsert";
  data: AllPaymentData;
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

const toProductId = (value: string | number | null | undefined): number | null => {
  if (value == null || value === '-') return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  return isNaN(n) ? null : n;
};

const toNullableString = (value: string | null | undefined): string | null => {
  if (value == null || value === '-') return null;
  return value;
};

const buildAllPaymentRow = (
  rawData: AllPaymentData,
): Insertable<AllPaymentTable> => {
  let createdAt: Date;
  if (typeof rawData.created_at === 'number') {
    createdAt = new Date(rawData.created_at * 1000);
  } else {
    createdAt = new Date(rawData.created_at);
  }

  return {
    trxn_id: rawData.trxn_id,
    site_url: toNullableString(rawData.site_url),
    merchant_id: toNullableString(rawData.merchant_id),
    req_status: toNullableString(rawData.req_status),
    gross_amount: toAmount(rawData.gross_amount),
    currency: toNullableString(rawData.currency) ?? null,
    correlation_id: toNullableString(rawData.correlation_id),
    trxn_type: toNullableString(rawData.trxn_type),
    product_id: toProductId(rawData.product_id),
    is_sandbox: rawData.is_sandbox ?? false,
    created_at: createdAt,
  };
};

const upsertAllPaymentsQuery = (rows: Insertable<AllPaymentTable>[]) =>
  db
    .insertInto("all_payments")
    .values(rows)
    .onConflict((oc) =>
      oc.column("trxn_id").doUpdateSet({
        site_url: sql`excluded.site_url`,
        merchant_id: sql`excluded.merchant_id`,
        req_status: sql`excluded.req_status`,
        gross_amount: sql`excluded.gross_amount`,
        currency: sql`excluded.currency`,
        correlation_id: sql`excluded.correlation_id`,
        trxn_type: sql`excluded.trxn_type`,
        product_id: sql`excluded.product_id`,
        is_sandbox: sql`excluded.is_sandbox`,
        created_at: sql`excluded.created_at`,
      }),
    );

const batchUpsertAllPayments = async (
  items: Array<{ record: SQSRecord; message: SQSMessage }>,
): Promise<BatchItemFailure[]> => {
  const rows = items.map(({ message }) =>
    buildAllPaymentRow(message.data),
  );

  try {
    await upsertAllPaymentsQuery(rows).execute();
    console.log(`Successfully batch upserted ${rows.length} all_payments`);
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
          await upsertAllPaymentsQuery([
            buildAllPaymentRow(message.data),
          ]).execute();
        } catch (err) {
          console.error(`Failed to process message ${record.messageId}:`, err);
          console.log(
            "error message: ",
            JSON.stringify(buildAllPaymentRow(message.data), null, 2),
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
      } catch(err) {
        const sanitizedBody = record.body.replace(/\\\\"/g, '\\"');
        messageData = JSON.parse(sanitizedBody);
      }

      if (!messageData.table || !messageData.operation || !messageData.data) {
        throw new Error(
          "Invalid message format: missing table, operation, or data",
        );
      }

      if (messageData.table === "all_payments") {
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
    const failures = await batchUpsertAllPayments(paymentItems);
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
