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

import { formatMarkdown } from '../utils/markdownFormatter';

type PostMessageParams = {
  channel: string;
  text: string;
  thread_ts?: string;
};

type PostMessageResponse = {
  ts: string; // Message timestamp (unique ID)
};

export async function postSlackMessage(params: PostMessageParams): Promise<PostMessageResponse> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }

  const slackParams = {
    ...params,
    text: formatMarkdown(params.text, 'slack'),
  };

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(slackParams),
  });

  const data = (await response.json()) as { ok: boolean; error?: string; ts?: string };

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return { ts: data.ts || "" };
}

export async function addSlackReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }

  const response = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      timestamp,
      name: emoji,
    }),
  });

  const data = (await response.json()) as { ok: boolean; error?: string };

  if (!data.ok && data.error !== "already_reacted") {
    throw new Error(`Slack reactions.add error: ${data.error}`);
  }
}

let cachedBotUserId: string | null = null;

export async function getBotUserId(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId;

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  try {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    const data = (await response.json()) as { ok: boolean; user_id?: string; error?: string };
    if (data.ok && data.user_id) {
      cachedBotUserId = data.user_id;
      console.log(`[SlackAPI] Cached bot user ID: ${cachedBotUserId}`);
      return cachedBotUserId;
    }
    console.warn(`[SlackAPI] auth.test failed: ${data.error}`);
    return null;
  } catch (error) {
    console.error(`[SlackAPI] Failed to get bot user ID:`, error);
    return null;
  }
}

export async function seedFeedbackReactions(channel: string, messageTs: string): Promise<void> {
  try {
    await Promise.all([
      addSlackReaction(channel, messageTs, "+1"),
      addSlackReaction(channel, messageTs, "-1"),
    ]);
    console.log(`[SlackAPI] Seeded feedback reactions on ${messageTs}`);
  } catch (error) {
    console.warn(`[SlackAPI] Failed to seed feedback reactions:`, error);
  }
}

type UploadFileParams = {
  channel: string;
  thread_ts?: string;
  filename: string;
  fileBuffer: Buffer;
  title?: string;
  initialComment?: string;
};

type UploadFileResponse = {
  fileId: string;
  permalink?: string;
};

type UpdateMessageParams = {
  channel: string;
  ts: string;
  text: string;
};

export async function updateSlackMessage(params: UpdateMessageParams): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }

  const slackParams = {
    ...params,
    text: formatMarkdown(params.text, 'slack'),
  };

  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(slackParams),
  });

  const data = (await response.json()) as { ok: boolean; error?: string };

  if (!data.ok) {
    console.error(`[SlackAPI] Failed to update message: ${data.error}`);
  }
}

export type ThreadMessage = {
  ts: string;
  user: string;
  text: string;
  isBot: boolean;
};

type ConversationsRepliesResponse = {
  ok: boolean;
  error?: string;
  messages?: Array<{
    ts: string;
    user?: string;
    bot_id?: string;
    text?: string;
  }>;
};

export async function fetchThreadHistory(
  channel: string,
  threadTs: string,
  limit: number = 10
): Promise<ThreadMessage[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }

  const response = await fetch(
    `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=${limit}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );

  const data = (await response.json()) as ConversationsRepliesResponse;

  if (!data.ok) {
    console.error(`[SlackAPI] Failed to fetch thread: ${data.error}`);
    return [];
  }

  return (data.messages || []).map(msg => ({
    ts: msg.ts,
    user: msg.user || msg.bot_id || "unknown",
    text: msg.text || "",
    isBot: !!msg.bot_id,
  }));
}

export async function uploadSlackFile(params: UploadFileParams): Promise<UploadFileResponse> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }

  const getUploadUrlResponse = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      filename: params.filename,
      length: params.fileBuffer.length.toString(),
    }),
  });

  const uploadUrlData = (await getUploadUrlResponse.json()) as {
    ok: boolean;
    error?: string;
    upload_url?: string;
    file_id?: string;
  };

  if (!uploadUrlData.ok || !uploadUrlData.upload_url || !uploadUrlData.file_id) {
    throw new Error(`Failed to get upload URL: ${uploadUrlData.error || 'Unknown error'}`);
  }

  const uploadResponse = await fetch(uploadUrlData.upload_url, {
    method: "POST",
    body: params.fileBuffer,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
  }

  const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      files: [{
        id: uploadUrlData.file_id,
        title: params.title || params.filename,
      }],
      channel_id: params.channel,
      thread_ts: params.thread_ts,
      initial_comment: params.initialComment,
    }),
  });

  const completeData = (await completeResponse.json()) as {
    ok: boolean;
    error?: string;
    files?: Array<{ id: string; permalink?: string }>;
  };

  if (!completeData.ok) {
    throw new Error(`Failed to complete file upload: ${completeData.error || 'Unknown error'}`);
  }

  return {
    fileId: uploadUrlData.file_id,
    permalink: completeData.files?.[0]?.permalink,
  };
}
