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
  try {
    // Parse the raw body
    const bodyString = req.body.toString("utf8");
    const payload = JSON.parse(bodyString);

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

    console.log(`Processing mention: "${text}" in channel ${channel}`);

    // 6. Process with MCP
    const ctx = makeMCPContext();
    const mcp = createMCP(ctx);

    const result = await mcp.runFromText(text);

    await postSlackMessage({
      channel,
      text: String(result),
      thread_ts: threadTs,
    });
  } catch (err) {
    console.error("Slack event handler error:", err);
    // If we haven't responded yet, send error
    if (!res.headersSent) {
      res.status(500).send("Internal error");
    }
  }
}