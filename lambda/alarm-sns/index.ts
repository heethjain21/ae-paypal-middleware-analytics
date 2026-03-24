import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const snsClient = new SNSClient({ region: process.env.AWS_REGION });
const logsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

// ===== CONFIGURATION =====
const PROJECT_PREFIXES = ["ae-prod-paypal-middleware"];


// Map alarm names to their log group and filter pattern
const ALARM_LOG_CONFIG = {
  "ae-prod-paypal-middleware-lambda-fatal-error": {
    logGroupName: "/aws/lambda/PayPalMerchantIntegration",
    filterPattern: "fatal_error",
    lookbackMinutes: 3,
  },
};
// =========================================================

export const handler = async (event) => {
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
async function fetchMatchingLogs(alarmName, alarmData) {
  const config = ALARM_LOG_CONFIG[alarmName];

  if (!config) {
    console.warn(`No log config found for alarm: ${alarmName}`);
    return null;
  }

  try {
    // Use the alarm's evaluation timestamp to anchor the query window
    const alarmTime = new Date(alarmData.state.timestamp).getTime();
    const startTime = alarmTime - config.lookbackMinutes * 60 * 1000;
    const endTime = alarmTime;

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

    const events = response.events || [];

    if (events.length === 0) {
      return "Log Details: No matching log entries found when querying in the past 3 minutes.";
    }


    const lines = events.map((evt) => {
      const parts = evt.message.split('\t');
      const lambdaRequestId = parts.length >= 2 ? parts[1] : 'N/A';

      // The JSON payload is typically the last tab-delimited part
      let internalRequestId = '';
      let logBody = parts.length >= 4 ? parts.slice(3).join('\t').trim() : evt.message;
      logBody = JSON.parse(logBody);

      try {
        internalRequestId = logBody?.requestId;
        logBody = JSON.stringify(logBody, null, 2);
      } catch {
        logBody = evt.message;
      }

      const logStreamUrl = buildCloudWatchUrl(config.logGroupName, evt.logStreamName, lambdaRequestId);

      return (
        `\n\nLog Details:` +
        `\n - Event Id: ${lambdaRequestId}` +
        `\n - Request Id: ${internalRequestId}` +
        `\n - Timestamp: ${evt.timestamp ? new Date().toISOString().split('T').join(' ') + ' UTC' : "N/A"}` +
        // `\n - Log Stream Name: ${evt.logStreamName}` +
        `\n - Log Stream: ${logStreamUrl}`
        // `\n - Raw Log: \n${logBody}`
      );
    });

    return lines.join('');
  } catch (error) {
    console.error(`Error fetching logs for ${alarmName}:`, error);
    return `Failed to fetch logs: ${error.message}`;
  }
}

function buildCloudWatchUrl(logGroupName, logStreamName, filterValue) {
  function encode(str) {
      return encodeURIComponent(str).replace(/%/g, '$25');
  }

  const region = process.env.AWS_REGION || 'us-east-2';
  const quotedFilter = `"${filterValue}"`;

  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encode(logGroupName)}/log-events/${encode(logStreamName)}?filterPattern=${encode(quotedFilter)}`;
}

function findMatchingPrefix(alarmName) {
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
