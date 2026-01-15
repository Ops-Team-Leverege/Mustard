import type { Request, Response } from "express";
import { verifySlackSignature } from "./verify";
import { postSlackMessage } from "./slackApi";
import { createMCP, type MCPResult } from "../mcp/createMCP";
import { makeMCPContext, type ThreadContext } from "../mcp/context";
import { storage } from "../storage";

function cleanMention(text: string): string {
  return text.replace(/^<@\w+>\s*/, "").trim();
}

/**
 * Determines whether to reuse thread context from a prior interaction.
 * 
 * Returns FALSE (resolve fresh) if the user explicitly overrides context:
 * - References a different customer/company
 * - Mentions "different meeting", "another call", "last quarter", etc.
 * - Explicitly names a new entity
 * 
 * This is a conservative check - when in doubt, reuse context.
 */
function shouldReuseThreadContext(messageText: string): boolean {
  const overridePatterns = [
    /\b(different|another|other)\s+(meeting|call|customer|company)\b/i,
    /\blast\s+(quarter|month|year)\b/i,
    /\bwith\s+[A-Z][a-z]+\s+(about|regarding)\b/i, // "with CompanyName about..."
    /\bfor\s+[A-Z][a-z]+\b/i, // "for CompanyName"
    /\b(switch|change)\s+to\b/i,
  ];
  
  return !overridePatterns.some(pattern => pattern.test(messageText));
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
    // For thread replies, use thread_ts (parent message); otherwise use ts (this message starts a thread)
    const threadTs = String(event.thread_ts || event.ts);
    const messageTs = String(event.ts); // This specific message's timestamp
    const text = cleanMention(String(event.text || ""));
    const userId = String(event.user || "");
    const isReply = Boolean(event.thread_ts); // True if this is a reply in an existing thread

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

    // 7. Thread context resolution (deterministic follow-up support)
    // 
    // IMPORTANT ARCHITECTURAL BOUNDARY:
    // Thread follow-ups reuse resolved entity context only.
    // LLMs never see prior answers or interaction history.
    // This enables natural follow-ups without conversation memory or hallucination risk.
    //
    let threadContext: ThreadContext | undefined;
    
    // Only look up prior context if this is a reply in an existing thread
    if (isReply && shouldReuseThreadContext(text)) {
      try {
        const priorInteraction = await storage.getLastInteractionByThread(threadTs);
        if (priorInteraction?.resolvedEntities) {
          const entities = priorInteraction.resolvedEntities as Record<string, unknown>;
          threadContext = {
            meetingId: entities.meetingId as string | null,
            companyId: entities.companyId as string | null,
          };
          console.log(`[Slack] Reusing thread context: meetingId=${threadContext.meetingId}, companyId=${threadContext.companyId}`);
        }
      } catch (err) {
        // Non-fatal - just proceed without context
        console.error("[Slack] Failed to lookup prior interaction:", err);
      }
    } else if (isReply) {
      console.log("[Slack] User explicitly overriding context - resolving fresh");
    }

    // 8. Process with MCP (async after ack)
    const ctx = makeMCPContext(threadContext);
    const mcp = createMCP(ctx);

    try {
      const mcpResult: MCPResult = await mcp.runFromText(text);

      // Format result - handle both string and object responses
      let responseText: string;
      const rawResult = mcpResult.result;
      if (typeof rawResult === "string") {
        responseText = rawResult;
      } else if (rawResult && typeof rawResult === "object") {
        // RAG responses have { answer, citations }
        const objResult = rawResult as Record<string, unknown>;
        responseText = (objResult.answer as string) || JSON.stringify(rawResult, null, 2);
      } else {
        responseText = String(rawResult);
      }

      const botReply = await postSlackMessage({
        channel,
        text: responseText,
        thread_ts: threadTs,
      });

      // Log interaction (write-only, non-blocking)
      // Note: slackMessageTs captures the bot's reply timestamp for audit purposes
      storage.insertInteractionLog({
        slackThreadId: threadTs,
        slackMessageTs: botReply.ts, // Actual bot reply message timestamp
        slackChannelId: channel,
        userId: userId || null,
        companyId: mcpResult.resolvedEntities?.companyId || null,
        meetingId: mcpResult.resolvedEntities?.meetingId || null,
        capabilityName: mcpResult.capabilityName,
        questionText: text,
        answerText: responseText,
        resolvedEntities: mcpResult.resolvedEntities || null,
        confidence: null,
      }).catch(err => {
        console.error("Failed to log interaction:", err);
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