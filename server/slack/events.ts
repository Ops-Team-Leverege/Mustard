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

// Track threads where bot is active (in-memory for fast lookups)
// Persisted interactions serve as source of truth; this is a performance cache
const botActiveThreads = new Set<string>();

/**
 * Check if this is a message event in a bot-active thread.
 * This enables follow-up questions without @mentioning the bot.
 */
async function isBotActiveThread(threadTs: string): Promise<boolean> {
  // Fast path: check in-memory cache
  if (botActiveThreads.has(threadTs)) {
    return true;
  }
  
  // Slow path: check database for prior interactions
  try {
    const priorInteraction = await storage.getLastInteractionByThread(threadTs);
    if (priorInteraction) {
      // Cache for future lookups
      botActiveThreads.add(threadTs);
      return true;
    }
  } catch (err) {
    console.error("[Slack] Failed to check bot-active thread:", err);
  }
  
  return false;
}

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

    const event = payload.event;
    console.log("Event type:", event?.type);

    // 5. Handle both app_mention AND message events (for thread follow-ups)
    const eventType = event?.type;
    const isAppMention = eventType === "app_mention";
    const isMessage = eventType === "message" && !event?.subtype; // Ignore edited/deleted/etc
    
    if (!isAppMention && !isMessage) {
      console.log("Not an app_mention or message event");
      return;
    }
    
    // IMPORTANT: When user @mentions the bot in a thread, Slack sends BOTH app_mention AND message events
    // We only want to process app_mention when both are present to avoid duplicates
    // But we MUST still process messages that mention OTHER users (not the bot)
    const rawThreadTs = event.thread_ts ? String(event.thread_ts) : null;
    const botUserId = payload.authorizations?.[0]?.user_id;
    const textContainsBotMention = botUserId && String(event.text || "").includes(`<@${botUserId}>`);
    
    // Skip message events that @mention the bot specifically (app_mention will handle those)
    if (isMessage && textContainsBotMention) {
      console.log("[Slack] Skipping message event - contains @bot mention, app_mention event will handle");
      return;
    }
    
    // For pure message events (no @mention), only respond if in a bot-active thread
    if (isMessage && !isAppMention) {
      // Ignore messages that aren't thread replies
      if (!rawThreadTs) {
        console.log("[Slack] Ignoring non-threaded message event");
        return;
      }
      
      // Ignore messages from bots (including ourselves)
      if (event.bot_id) {
        console.log("[Slack] Ignoring message from bot");
        return;
      }
      
      // Check if this is a bot-active thread
      const isActive = await isBotActiveThread(rawThreadTs);
      if (!isActive) {
        console.log("[Slack] Ignoring message in non-bot-active thread");
        return;
      }
      
      console.log(`[Slack] Processing follow-up in bot-active thread: ${rawThreadTs}`);
    }

    // 6. Dedupe events
    const eventId = String(payload.event_id || "");
    if (eventId && seenEventIds.has(eventId)) return;
    if (eventId) seenEventIds.add(eventId);

    // Extract message details
    const channel = String(event.channel);
    // For thread replies, use thread_ts (parent message); otherwise use ts (this message starts a thread)
    const threadTs = String(event.thread_ts || event.ts);
    const messageTs = String(event.ts); // This specific message's timestamp
    const text = cleanMention(String(event.text || ""));
    const userId = String(event.user || "");
    const isReply = Boolean(event.thread_ts); // True if this is a reply in an existing thread

    console.log(`Processing: "${text}" in channel ${channel} (isAppMention=${isAppMention}, isReply=${isReply})`);

    // 7. Send immediate acknowledgment (UX improvement - reduces perceived latency)
    const ackMessage = userId
      ? `On it, <@${userId}> — let me check that for you.`
      : `On it — let me check that for you.`;

    await postSlackMessage({
      channel,
      text: ackMessage,
      thread_ts: threadTs,
    });

    // Mark this thread as bot-active (for future follow-ups without @mention)
    botActiveThreads.add(threadTs);

    // 8. Thread context resolution (deterministic follow-up support)
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

    // 9. Process with MCP (async after ack)
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
      // Detect specific error types for better user messaging
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode = (err as any)?.code || (err as any)?.status;
      
      let userMessage: string;
      let logPrefix: string;
      
      // OpenAI quota/rate limit errors
      if (errorCode === 'insufficient_quota' || errorCode === 429 || 
          errorMessage.includes('exceeded your current quota') ||
          errorMessage.includes('rate limit')) {
        logPrefix = "[OpenAI Quota Error]";
        userMessage = "I can't process this right now — the AI service quota has been exceeded. Please contact an admin to check the OpenAI billing settings.";
      } 
      // OpenAI API key errors
      else if (errorCode === 401 || errorMessage.includes('Incorrect API key') || 
               errorMessage.includes('invalid_api_key')) {
        logPrefix = "[OpenAI Auth Error]";
        userMessage = "I can't process this right now — there's an issue with the AI service configuration. Please contact an admin.";
      }
      // Generic errors
      else {
        logPrefix = "[MCP Error]";
        userMessage = "Sorry — I hit an internal error while processing that request.";
      }
      
      console.error(`${logPrefix} ${errorMessage}`);
      if (err instanceof Error && err.stack) {
        console.error(`${logPrefix} Stack:`, err.stack);
      }

      await postSlackMessage({
        channel,
        text: userMessage,
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
