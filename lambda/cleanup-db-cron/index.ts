import { Context, EventBridgeEvent } from "aws-lambda";
import fs from "fs";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { DB } from "./types/database.types";

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

interface CleanupResult {
  deletedCount: number;
  status: "success" | "error";
  error?: string;
}

export const handler = async (
  event: EventBridgeEvent<string, any>,
  context: Context
): Promise<CleanupResult> => {
  console.log("Starting request cleanup process");
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const result = await cleanupOldRequests();

    console.log(
      `Cleanup completed successfully. Deleted ${result.deletedCount} requests`
    );

    return {
      deletedCount: result.deletedCount,
      status: "success",
    };
  } catch (error) {
    console.error("Cleanup process failed:", error);

    return {
      deletedCount: 0,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

const cleanupOldRequests = async (): Promise<{ deletedCount: number }> => {
  // Calculate the date 30 days ago
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  console.log(
    `Deleting successful requests older than: ${thirtyDaysAgo.toISOString()}`
  );

  try {
    // Delete requests with successful status (status_code 200-299) that are older than 30 days
    const result = await db
      .deleteFrom('requests')
      .where("code", ">=", 200)
      .where("code", "<", 300)
      .where("created_at", "<", thirtyDaysAgo)
      .execute();

    const deletedCount = result.length;

    console.log(`Successfully deleted ${deletedCount} old successful requests`);

    return { deletedCount };
  } catch (error) {
    console.error("Error deleting old requests:", error);
    throw error;
  }
};
