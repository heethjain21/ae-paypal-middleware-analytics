import { Context, SQSEvent, SQSRecord } from "aws-lambda";
import fs from "fs";
import { Insertable, Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { DB, Request as RequestTable } from "./types/database.types";
import { RequestStatus } from "./types/database.enums";

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
      connectionTimeoutMillis: 2000,

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
  // IMPORTANT for Lambda + DB pools
  context.callbackWaitsForEmptyEventLoop = false;

  console.log(`Processing ${event.Records.length} SQS messages`);

  const failedMessages: BatchItemFailure[] = [];
  const requestItems: Array<{ record: SQSRecord; message: SQSMessage }> = [];
  

  for (const record of event.Records) {
    try {
      if (!record.body) throw new Error("Message body is empty");

      const messageData = JSON.parse(record.body) as SQSMessage;

      if (!messageData.table || !messageData.operation || !messageData.data) {
        throw new Error(
          "Invalid message format: missing table, operation, or data",
        );
      }

      if (messageData.table === "requests") {
        requestItems.push({ record, message: messageData });
      } else {
        throw new Error(`Unknown table: ${messageData.table}`);
      }
    } catch (error) {
      console.error(`Failed to parse message ${record.messageId}:`, error);
      failedMessages.push({ itemIdentifier: record.messageId });
    }
  }

  if (requestItems.length > 0) {
    const failures = await batchUpsertRequests(requestItems);
    failedMessages.push(...failures);
  }

  console.log(
    `Processed ${
      event.Records.length - failedMessages.length
    } successfully, ${failedMessages.length} failed`,
  );

  return { batchItemFailures: failedMessages };
};

const toJson = (value: any) => {

  if (Array.isArray(value)) return toJson(value[0]);

  if (value === null || value === undefined) return null;

  if (typeof value === "string") return { body: value };
  
  else if (typeof value === "object") return value;
  else
    return {
      body: value,
    };
};

const buildRequestRow = (rawData: RequestData): Insertable<RequestTable> => {
  const responseStatusCode = Number(rawData.response_status_code);

  const status =
    responseStatusCode >= 200 && responseStatusCode < 300
      ? RequestStatus.SUCCESS
      : RequestStatus.FAILED;

  const debugId =
    rawData.response_headers?.["paypal-debug-id"] ??
    rawData.request_headers?.["PayPal-Request-Id"] ??
    rawData.request_id ??
    crypto.randomUUID();

  return {
    debug_id: debugId,

    site_url: rawData.metadata.wp_home,
    status,

    path: rawData.request_url,
    method: rawData.request_method,
    code: responseStatusCode,
    duration: Number(rawData.duration) || 0,

    paypal_request_id: rawData.request_headers?.["PayPal-Request-Id"] ?? null,

    raw_request: toJson(rawData.request_body),
    raw_response: toJson(rawData.response_body),

    error_code: null,
    error_message: null,
    error_stack: null,

    is_sandbox: rawData.metadata.test_mode === "yes",
    plugin_version: rawData.metadata.plugin_version,
    internal_request_id: rawData.request_id,

    created_at: new Date(rawData.created_at),
  };
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
        code: sql`excluded.code`,
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

const batchUpsertRequests = async (
  items: Array<{ record: SQSRecord; message: SQSMessage }>,
): Promise<BatchItemFailure[]> => {
  const rows = items.map(({ message }) => buildRequestRow(message.data));

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
      items.map(async ({ record, message }) => {
        try {
          await upsertRequestsQuery([buildRequestRow(message.data)]).execute();
        } catch (err) {
          console.error(`Failed to process message ${record.messageId}:`, err);
          console.log("error message: ", JSON.stringify(buildRequestRow(message.data), null, 2));
          failures.push({ itemIdentifier: record.messageId });
        }
      }),
    );

    return failures;
  }
};
