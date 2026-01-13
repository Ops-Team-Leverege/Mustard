/**
 * Slack integration layer.
 *
 * Responsibilities:
 * - Receive and verify Slack events
 * - Invoke MCP capabilities
 * - Format responses for Slack UI
 *
 * This file MUST NOT:
 * - Contain business logic
 * - Perform data retrieval
 * - Call LLMs directly
 *
 * Layer: Integration (I/O only)
 */

type PostMessageParams = {
  channel: string;
  text: string;
  thread_ts?: string;
};

export async function postSlackMessage(params: PostMessageParams) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });

  const data = (await response.json()) as { ok: boolean; error?: string };

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
}
