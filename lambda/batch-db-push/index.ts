import { Context, SQSEvent, SQSRecord } from "aws-lambda";
import fs from "fs";
import { Insertable, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { DB, Request as RequestTable } from "./types/database.types";
import { RequestStatus } from "./types/database.enums";

// Initialize database connection
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({
      user: process.env.AWS_RDS_DB_USER,
      password: process.env.AWS_RDS_DB_PASSWORD,
      host: process.env.AWS_RDS_DB_URL, // db_url.rds.amazonaws.com
      database: process.env.AWS_RDS_DB_NAME,
      port: 5432,
      max: 100, // Maximum number of connections in the pool
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
  console.log(`Processing ${event.Records.length} SQS messages`);

  const failedMessages: BatchItemFailure[] = [];

  // Process each message individually to handle partial failures

  await Promise.all(
    event.Records.map(async (record) => {
      try {
        await processMessage(record);
        console.log(`Successfully processed message: ${record.messageId}`);
      } catch (error) {
        console.error(`Failed to process message ${record.messageId}:`, error);
        failedMessages.push({
          itemIdentifier: record.messageId,
        });
      }
    }),
  );

  console.log(
    `Processed ${event.Records.length - failedMessages.length} successfully, ${
      failedMessages.length
    } failed`,
  );

  return {
    batchItemFailures: failedMessages,
  };
};

const processMessage = async (record: SQSRecord): Promise<void> => {
  if (!record.body) {
    throw new Error("Message body is empty");
  }

  let messageData: SQSMessage;
  try {
    messageData = JSON.parse(record.body) as unknown as SQSMessage;
  } catch (error) {
    throw new Error(`Failed to parse message body: ${error}`);
  }

  // Validate message structure
  if (!messageData.table || !messageData.operation || !messageData.data) {
    throw new Error(
      "Invalid message format: missing table, operation, or data",
    );
  }

  console.log(
    `Processing ${messageData.operation} operation for table: ${messageData.table}`,
  );

  switch (messageData.table) {
    case "requests":
      await processRequestMessage(messageData);
      break;
    default:
      throw new Error(`Unknown table: ${messageData.table}`);
  }
};

const processRequestMessage = async (
  messageData: SQSMessage,
): Promise<void> => {
  const rawData = messageData.data;

  const responseStatusCode = Number(rawData.response_status_code)
  const status =
    responseStatusCode >= 200 && responseStatusCode < 300
      ? RequestStatus.SUCCESS
      : RequestStatus.FAILED;

  const data: Insertable<RequestTable> = {
    debug_id: rawData.response_headers["paypal-debug-id"],

    site_url: rawData.metadata.wp_home,
    status: status,

    path: rawData.request_url,
    method: rawData.request_method,
    code: Number(rawData.response_status_code),
    duration: Math.round(Number(rawData.duration) / 1000),

    paypal_request_id: rawData.request_headers["PayPal-Request-Id"] ?? null,

    raw_request: rawData.request_body,
    raw_response: rawData.request_body,

    error_code: null,
    error_message: null,
    error_stack: null,

    is_sandbox: rawData.metadata.test_mode === "yes",
    plugin_version: rawData.metadata.plugin_version,
    internal_request_id: rawData.request_id,

    created_at: new Date(rawData.created_at),
  };

  try {
    await db
      .insertInto("requests")
      .values(data)
      .onConflict((oc) =>
        oc
          .column("debug_id")
          .doUpdateSet({
            status: data.status,

            raw_request: data.raw_request,
            raw_response: data.raw_response,

            error_code: data.error_code,
            error_message: data.error_message,
            error_stack: data.error_stack,
          })
          .where("requests.created_at", "<", data.created_at),
      )
      .execute();

    console.log(`Successfully upserted request: ${data.debug_id}`);
  } catch (error) {
    console.error("Error upserting request:", error);
    throw error;
  }
};
