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

type PostMessageResponse = {
  ts: string; // Message timestamp (unique ID)
};

export async function postSlackMessage(params: PostMessageParams): Promise<PostMessageResponse> {
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

  const data = (await response.json()) as { ok: boolean; error?: string; ts?: string };

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return { ts: data.ts || "" };
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
