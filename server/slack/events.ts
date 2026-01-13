import type { Request, Response } from "express";
import { verifySlackSignature } from "./verify";
import { postSlackMessage } from "./slackApi";
import { createMCP } from "../mcp/createMCP";
import { makeMCPContext } from "../mcp/context";

function cleanMention(text: string): string {
  return text.replace(/^<@\w+>\s*/, "").trim();
}

// Simple in-memory dedupe
const seenEventIds = new Set<string>();

export async function slackEventsHandler(req: Request, res: Response) {
  console.log("[Slack] Received event request");
  try {
    // Handle body in multiple formats:
    // - Buffer (from express.raw middleware)
    // - Object (if express.json already parsed it)
    // - String
    let payload;
    if (Buffer.isBuffer(req.body)) {
      const bodyString = req.body.toString("utf8");
      try {
        payload = JSON.parse(bodyString);
      } catch (parseErr) {
        console.error("Failed to parse Slack payload:", parseErr);
        return res.status(400).send("Invalid JSON");
      }
    } else if (typeof req.body === "object" && req.body !== null) {
      // Already parsed by express.json
      payload = req.body;
    } else {
      console.error("Unexpected body type:", typeof req.body);
      return res.status(400).send("Invalid request body");
    }

    // 1. URL verification handshake (do this FIRST, before signature check)
    if (payload.type === "url_verification") {
      console.log("Received URL verification challenge");
      return res.status(200).json({ challenge: payload.challenge });
    }

    // 2. Verify Slack signature for all other requests
    if (!verifySlackSignature(req)) {
      console.error("Invalid Slack signature");
      return res.status(401).send("Invalid Slack signature");
    }

    // 3. ACK immediately (Slack requires response within 3 seconds)
    res.status(200).send();

    // 4. Only handle event callbacks
    console.log("Slack payload type:", payload.type);

    if (payload.type !== "event_callback") {
      console.log("Not an event_callback");
      return;
    }

    console.log("Event type:", payload.event?.type);

    if (payload.event?.type !== "app_mention") {
      console.log("Not an app_mention");
      return;
    }
    // 5. Dedupe events
    const eventId = String(payload.event_id || "");
    if (eventId && seenEventIds.has(eventId)) return;
    if (eventId) seenEventIds.add(eventId);

    const event = payload.event;
    if (!event || event.type !== "app_mention") return;

    const channel = String(event.channel);
    const threadTs = String(event.ts);
    const text = cleanMention(String(event.text || ""));
    const userId = String(event.user || "");

    console.log(`Processing mention: "${text}" in channel ${channel}`);

    // 6. Send immediate acknowledgment (UX improvement - reduces perceived latency)
    const ackMessage = userId
      ? `On it, <@${userId}> — let me check that for you.`
      : `On it — let me check that for you.`;

    await postSlackMessage({
      channel,
      text: ackMessage,
      thread_ts: threadTs,
    });

    // 7. Process with MCP (async after ack)
    const ctx = makeMCPContext();
    const mcp = createMCP(ctx);

    try {
      const result = await mcp.runFromText(text);

      // Format result - handle both string and object responses
      let responseText: string;
      if (typeof result === "string") {
        responseText = result;
      } else if (result && typeof result === "object") {
        // RAG responses have { answer, citations }
        responseText = result.answer || JSON.stringify(result, null, 2);
      } else {
        responseText = String(result);
      }

      await postSlackMessage({
        channel,
        text: responseText,
        thread_ts: threadTs,
      });
    } catch (err) {
      console.error("MCP execution failed:", err);

      await postSlackMessage({
        channel,
        text: "Sorry — I hit an internal error while processing that request.",
        thread_ts: threadTs,
      });
    }
  } catch (err) {
    console.error("Slack event handler error:", err);
    // If we haven't responded yet, send error
    if (!res.headersSent) {
      res.status(500).send("Internal error");
    }
  }
}