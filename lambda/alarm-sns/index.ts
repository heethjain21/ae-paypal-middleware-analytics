import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  type FilteredLogEvent,
} from "@aws-sdk/client-cloudwatch-logs";

const snsClient = new SNSClient({ region: process.env.AWS_REGION });
const logsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

// ===== CONFIGURATION =====
const PROJECT_PREFIXES: string[] = ["ae-prod-paypal-middleware"];

interface AlarmLogConfig {
  service: Service;
  logGroupName: string;
  filterPattern: string;
  lookbackMinutes: number;
  correlatedLogGroup?: string; // When set, also searches this log group using IDs extracted from primary logs
}

enum Service {
  API_GATEWAY = "API_GATEWAY",
  LAMBDA = "LAMBDA",
}

// Map alarm names to their log group and filter pattern
const ALARM_LOG_CONFIG: Record<string, AlarmLogConfig> = {
  "ae-prod-paypal-middleware-lambda-fatal-error": {
    service: Service.LAMBDA,
    logGroupName: "/aws/lambda/PayPalMerchantIntegration",
    filterPattern: "fatal_error",
    lookbackMinutes: 3,
  },
  "ae-prod-paypal-middleware-apigw-5xx-error": {
    service: Service.API_GATEWAY,
    logGroupName: "API-Gateway-Execution-Logs_zpyql2kd39/production",
    filterPattern: '?"Execution failed" ?"execution failed"',
    lookbackMinutes: 3,
    correlatedLogGroup: "/aws/lambda/PayPalMerchantIntegration",
  },
};
// =========================================================

interface AlarmState {
  timestamp: string;
  [key: string]: unknown;
}

interface AlarmConfiguration {
  description?: string;
  [key: string]: unknown;
}

interface AlarmData {
  alarmName: string;
  state: AlarmState;
  configuration: AlarmConfiguration;
  [key: string]: unknown;
}

interface CloudWatchAlarmEvent {
  alarmData: AlarmData;
  [key: string]: unknown;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
}

export const handler = async (
  event: CloudWatchAlarmEvent,
): Promise<HandlerResponse> => {
  try {
    console.log(
      "Received CloudWatch Alarm event:",
      JSON.stringify(event, null, 2),
    );

    const data = event.alarmData;

    // Extract alarm details
    const alarmName = data.alarmName;
    const alarmDescription =
      data.configuration.description || "No description provided";

    if (!alarmName) {
      throw new Error("AlarmName not found in event");
    }

    console.log("Processing alarm:", alarmName);

    // Find matching SNS topic name from alarm name
    const snsTopicName = findMatchingPrefix(alarmName);

    if (!snsTopicName) {
      throw new Error(
        `No matching prefix found for alarm: ${alarmName}\n` +
          `Available prefixes: ${PROJECT_PREFIXES.join(", ")}`,
      );
    }

    // Construct SNS Topic ARN
    const snsTopicArn = `arn:aws:sns:us-east-2:555709313202:${snsTopicName}`;

    console.log("Routing to SNS topic:", snsTopicArn);

    // Build base message
    let message = "Alarm Name: " + alarmName + "\n\n" + alarmDescription;

    // Fetch log details if this alarm is configured for it
    if (Object.keys(ALARM_LOG_CONFIG).includes(alarmName)) {
      const logDetails = await fetchMatchingLogs(alarmName, data);
      if (logDetails) {
        message += logDetails;
      }
    }

    const command = new PublishCommand({
      TopicArn: snsTopicArn,
      Subject: `AWS Alert - Cloudwatch Alarm`,
      Message: message,
    });

    const response = await snsClient.send(command);

    console.log("Successfully published to SNS:", {
      messageId: response.MessageId,
      snsTopicArn: snsTopicArn,
      alarmName: alarmName,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Alarm forwarded to SNS",
        snsTopicArn: snsTopicArn,
        messageId: response.MessageId,
      }),
    };
  } catch (error) {
    console.error("Error processing alarm:", error);
    throw error;
  }
};

/**
 * Fetch recent log events matching the alarm's filter pattern
 */
async function fetchMatchingLogs(
  alarmName: string,
  alarmData: AlarmData,
): Promise<string | null> {
  const config = ALARM_LOG_CONFIG[alarmName];

  if (!config) {
    console.warn(`No log config found for alarm: ${alarmName}`);
    return null;
  }

  try {
    const bufferMs = 60 * 1000;
    const alarmTime = new Date(alarmData.state.timestamp).getTime();
    const startTime = alarmTime - config.lookbackMinutes * 60 * 1000 - bufferMs;
    const endTime = alarmTime + bufferMs;

    console.log(
      `Fetching logs from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`,
    );

    const command = new FilterLogEventsCommand({
      logGroupName: config.logGroupName,
      startTime: startTime,
      endTime: endTime,
      filterPattern: config.filterPattern,
      limit: 10,
    });

    const response = await logsClient.send(command);
    const events: FilteredLogEvent[] = response.events || [];

    if (events.length === 0) {
      return "\n\nLog Details: No matching log entries found when querying in the past 3 minutes.";
    }

    if (config.service === Service.API_GATEWAY) {
      return formatApiGatewayLogs(events, config, startTime, endTime);
    } else if (config.service === Service.LAMBDA) {
      return formatLambdaLogs(events, config.logGroupName);
    }
    return null;
  } catch (error) {
    console.error(`Error fetching logs for ${alarmName}:`, error);
    return `Failed to fetch logs: ${(error as Error).message}`;
  }
}

function formatLambdaLogs(
  events: FilteredLogEvent[],
  logGroupName: string,
): string {
  const lines = events.map((evt) => {
    const parts = (evt.message ?? "").split("\t");
    const lambdaRequestId = parts.length >= 2 ? parts[1] : "N/A";

    // The JSON payload is typically the last tab-delimited part
    let internalRequestId = "";
    let logBody: string =
      parts.length >= 4
        ? parts.slice(3).join("\t").trim()
        : (evt.message ?? "");
    let parsedLog: Record<string, unknown>;

    try {
      parsedLog = JSON.parse(logBody) as Record<string, unknown>;
      internalRequestId = (parsedLog?.requestId as string) ?? "";
      logBody = JSON.stringify(parsedLog, null, 2);
    } catch {
      logBody = evt.message ?? "";
    }

    const logStreamUrl = buildCloudWatchUrl(
      logGroupName,
      evt.logStreamName ?? "",
      lambdaRequestId,
    );

    return (
      `\n\nLog Details (Lambda):` +
      `\n - Event Id: ${lambdaRequestId}` +
      (internalRequestId !== ""
        ? `\n - Request Id: ${internalRequestId}`
        : "") +
      `\n - Timestamp: ${evt.timestamp ? new Date().toISOString().split("T").join(" ") + " UTC" : "N/A"}` +
      `\n - Log Stream: ${logStreamUrl}`
    );
  });

  return lines.join("");
}

async function formatApiGatewayLogs(
  events: FilteredLogEvent[],
  config: AlarmLogConfig,
  startTime: number,
  endTime: number,
): Promise<string> {
  const lines = await Promise.all(
    events.map(async (evt) => {
      // API GW execution log format: (requestId) message
      const match = (evt.message ?? "").match(/^\(([^)]+)\)/);
      const apiGwEventId = match ? match[1] : "N/A";

      const logStreamUrl = buildCloudWatchUrl(
        config.logGroupName,
        evt.logStreamName ?? "",
        apiGwEventId,
      );

      let result =
        `\n\nLog Details (API Gateway):` +
        `\n - Event Id: ${apiGwEventId}` +
        `\n - Timestamp: ${evt.timestamp ? new Date(evt.timestamp).toISOString().split("T").join(" ") + " UTC" : "N/A"}` +
        `\n - Log Stream: ${logStreamUrl}`;

      if (config.correlatedLogGroup && apiGwEventId !== "N/A") {
        result += await fetchCorrelatedLambdaLog(
          apiGwEventId,
          config.logGroupName,
          config.correlatedLogGroup,
          startTime,
          endTime,
        );
      }

      return result;
    }),
  );

  return lines.join("");
}

async function fetchCorrelatedLambdaLog(
  apiGwEventId: string,
  apiGwLogGroup: string,
  lambdaLogGroup: string,
  startTime: number,
  endTime: number,
): Promise<string> {
  try {
    // Step 1: Find the Extended Request Id for this API GW request
    const extIdCommand = new FilterLogEventsCommand({
      logGroupName: apiGwLogGroup,
      startTime,
      endTime,
      filterPattern: `"${apiGwEventId}" "Extended Request Id"`,
      limit: 1,
    });

    const extIdResponse = await logsClient.send(extIdCommand);
    const extIdEvent = (extIdResponse.events ?? [])[0];

    if (!extIdEvent?.message) {
      return (
        `\n - Extended Request Id: Not found` +
        `\n\n - Log Details (Lambda): Not Found`
      );
    }

    // Format: (requestId) Extended Request Id: baYZfF0ziYcEH4Q=
    const extIdMatch = extIdEvent.message.match(/Extended Request Id:\s*(\S+)/);
    const extendedRequestId = extIdMatch ? extIdMatch[1] : null;

    if (!extendedRequestId) {
      return (
        `\n - Extended Request Id: Could not parse` +
        `\n\n - Log Details (Lambda): Not Found`
      );
    }

    // Step 2: Search Lambda logs for the Extended Request Id
    const lambdaCommand = new FilterLogEventsCommand({
      logGroupName: lambdaLogGroup,
      startTime,
      endTime,
      filterPattern: `"${extendedRequestId}"`,
      limit: 5,
    });

    const lambdaResponse = await logsClient.send(lambdaCommand);
    const lambdaEvents = lambdaResponse.events ?? [];

    if (lambdaEvents.length === 0) {
      return (
        `\n - Extended Request Id: ${extendedRequestId}` +
        `\n\n - Log Details (Lambda): Not Found`
      );
    }

    return (
      `\n - Extended Request Id: ${extendedRequestId}` +
      formatLambdaLogs(lambdaEvents, lambdaLogGroup)
    );
  } catch (error) {
    console.error(
      `Error fetching correlated Lambda log for API GW request ${apiGwEventId}:`,
      error,
    );
    return `\n - Lambda Log: Failed to fetch (${(error as Error).message})`;
  }
}

function buildCloudWatchUrl(
  logGroupName: string,
  logStreamName: string,
  filterValue: string,
): string {
  function encode(str: string): string {
    return encodeURIComponent(str).replace(/%/g, "$25");
  }

  const region = process.env.AWS_REGION || "us-east-2";
  const quotedFilter = `"${filterValue}"`;

  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encode(logGroupName)}/log-events/${encode(logStreamName)}?filterPattern=${encode(quotedFilter)}`;
}

function findMatchingPrefix(alarmName: string): string | null {
  const sortedPrefixes = [...PROJECT_PREFIXES].sort(
    (a, b) => b.length - a.length,
  );

  for (const prefix of sortedPrefixes) {
    if (alarmName.startsWith(prefix)) {
      console.log(`Matched prefix: ${prefix}`);
      return prefix;
    }
  }

  console.error("No matching prefix found for alarm:", alarmName);
  return null;
}
