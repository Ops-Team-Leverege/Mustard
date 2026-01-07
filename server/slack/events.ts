import type { Request, Response } from "express";
import { verifySlackSignature } from "./verify";
import { postSlackMessage } from "./slackApi";
import { createMCP } from "../mcp/createMCP";
import { makeMCPContext } from "../mcp/context";

function cleanMention(text: string): string {
  return text.replace(/^<@\w+>\s*/, "").trim();
}

// Simple in-memory dedupe (fine for Replit)
const seenEventIds = new Set<string>();

export async function slackEventsHandler(req: Request, res: Response) {
  
  const payload = JSON.parse(req.body.toString("utf8"));


  // 1. URL verification handshake
  if (payload.type === "url_verification") {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }
  
  // 2. Verify Slack signature
  if (!verifySlackSignature(req)) {
    res.status(401).send("Invalid Slack signature");
    return;
  }

  // 3. ACK immediately (critical)
  res.status(200).send();

  // 4. Only handle event callbacks
  if (payload.type !== "event_callback") return;

  const eventId = String(payload.event_id || "");
  if (eventId && seenEventIds.has(eventId)) return;
  if (eventId) seenEventIds.add(eventId);

  const event = payload.event;
  if (!event || event.type !== "app_mention") return;

  const channel = String(event.channel);
  const userId = String(event.user);
  const threadTs = String(event.ts);
  const text = cleanMention(String(event.text || ""));

  try {
    const ctx = makeMCPContext();
    const mcp = createMCP(ctx);
    
    const result = await mcp.runFromText(text);

    await postSlackMessage({
      channel,
      text: String(result),
      thread_ts: threadTs,
    });
  } catch (err) {
    await postSlackMessage({
      channel,
      text: "Sorry — I couldn’t process that request.",
      thread_ts: threadTs,
    });
  }
}
