/**
 * Slack Events Handler
 * 
 * Purpose:
 * Main handler for Slack Events API webhooks. Processes @mentions,
 * routes to SingleMeetingOrchestrator or OpenAssistant, and posts responses.
 * 
 * Key Flows:
 * 1. URL verification (Slack challenge)
 * 2. Event deduplication (prevents duplicate processing)
 * 3. Meeting resolution (thread context or explicit reference)
 * 4. Intent routing (single-meeting vs open assistant)
 * 5. Response posting and interaction logging
 * 
 * Layer: Slack (event handling)
 */

import type { Request, Response } from "express";
import { verifySlackSignature } from "./verify";
import { postSlackMessage } from "./slackApi";
import { sendResponseWithDocumentSupport } from "../services/documentResponse";
import { generateAckWithMention, generateAck } from "./acknowledgments";
import { createMCP, type MCPResult } from "../mcp/createMCP";
import { makeMCPContext, type ThreadContext } from "../mcp/context";
import { storage } from "../storage";
import { handleSingleMeetingQuestion, type SingleMeetingContext, detectAmbiguity, isBinaryQuestion } from "../mcp/singleMeetingOrchestrator";
import { resolveMeetingFromSlackMessage, hasTemporalMeetingReference, extractCompanyFromMessage } from "../mcp/meetingResolver";
import { buildInteractionMetadata, type EntryPoint, type LegacyIntent, type AnswerShape, type DataSource, type MeetingArtifactType, type LlmPurpose, type ResolutionSource, type ClarificationType, type ClarificationResolution } from "./interactionMetadata";
import { logInteraction, mapLegacyDataSource, mapLegacyArtifactType } from "./logInteraction";
import { handleOpenAssistant, type OpenAssistantResult } from "../openAssistant";
import { runControlPlane, type ControlPlaneResult } from "../controlPlane";

function cleanMention(text: string): string {
  return text.replace(/^<@\w+>\s*/, "").trim();
}

/**
 * Detects if this is a test run from the automated test runner.
 * Test runs bypass Slack-specific guards while still executing the full pipeline.
 */
function isTestRun(req: Request): boolean {
  return req.headers['x-pitcrew-test-run'] === 'true';
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

    // 2. Verify Slack signature for all other requests (skip for test runs)
    const testRunEarly = isTestRun(req);
    if (!testRunEarly && !verifySlackSignature(req)) {
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

    // 5. Only handle app_mention events (bot must be @mentioned to respond)
    // Test runs bypass this check to allow automated testing
    const testRun = isTestRun(req);
    const eventType = event?.type;
    if (eventType !== "app_mention" && !testRun) {
      console.log("[Slack] Ignoring non-app_mention event:", eventType);
      return;
    }
    
    if (testRun) {
      console.log("[Slack] Test run mode - bypassing app_mention check");
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

    console.log(`Processing: "${text}" in channel ${channel} (isReply=${isReply})`);

    // 7. Send immediate acknowledgment (UX improvement - reduces perceived latency)
    // Skip Slack API calls in test mode to avoid errors with fake channels
    // Uses smart acknowledgments that vary based on what the user is asking
    const ackMessage = userId
      ? generateAckWithMention(userId, text)
      : generateAck(null, text);

    if (!testRun) {
      await postSlackMessage({
        channel,
        text: ackMessage,
        thread_ts: threadTs,
      });
    } else {
      console.log("[Slack] Test mode - skipping acknowledgment message");
    }

    // 7.5 EARLY AMBIGUITY DETECTION (preparation/briefing questions)
    // 
    // Check for ambiguous preparation questions BEFORE any routing.
    // "I'm preparing for our meeting with X - what should I cover?"
    // These questions are inherently ambiguous and need clarification.
    //
    const ambiguityCheck = detectAmbiguity(text);
    if (ambiguityCheck.isAmbiguous && ambiguityCheck.clarificationPrompt) {
      console.log(`[Slack] Early ambiguity detected - asking for clarification`);
      
      // IMPORTANT: Extract company from original question so thread context works for follow-up
      const companyContext = await extractCompanyFromMessage(text);
      console.log(`[Slack] Extracted company from preparation question: ${companyContext?.companyName || 'none'}`);
      
      if (!testRun) {
        await postSlackMessage({
          channel,
          text: ambiguityCheck.clarificationPrompt,
          thread_ts: threadTs,
        });
      }
      
      // Log interaction for clarification - include company so thread context works
      logInteraction({
        slackChannelId: channel,
        slackThreadId: threadTs,
        slackMessageTs: messageTs,
        userId: userId || null,
        companyId: companyContext?.companyId || null,
        meetingId: null,
        questionText: text,
        answerText: ambiguityCheck.clarificationPrompt,
        metadata: buildInteractionMetadata(
          { companyId: companyContext?.companyId, companyName: companyContext?.companyName },
          {
            entryPoint: "slack",
            legacyIntent: "prep",
            answerShape: "none",
            dataSource: "not_found",
            llmPurposes: [],
            companySource: companyContext ? "extracted" : "none",
            meetingSource: "none",
            ambiguity: {
              detected: true,
              clarificationAsked: true,
              type: "next_steps_or_summary",
            },
            clarificationState: {
              awaiting: true,
              resolvedWith: null,
            },
            awaitingClarification: "next_steps_or_summary",
            testRun,
          }
        ),
        testRun,
      });
      
      return; // Stop processing - clarification required
    }

    // 7.6 EARLY BINARY QUESTION HANDLING (existence checks)
    //
    // "Is there a meeting with Walmart?" should get "Yes, on [date]. Want details?"
    // NOT a full summary. Handle this before routing to avoid LLM overhead.
    //
    if (isBinaryQuestion(text)) {
      // Check if it's an existence question about a company meeting
      const existenceMatch = text.match(/\b(?:is|are|was|were|do|does|did)\s+(?:there|we|they)\s+(?:a|any)\s+(?:meeting|call|transcript)s?\s+(?:with|for|about)\s+(.+?)(?:\?|$)/i);
      
      if (existenceMatch) {
        const searchTerm = existenceMatch[1].trim().replace(/[?.,!]$/, '');
        console.log(`[Slack] Binary existence question detected for: "${searchTerm}"`);
        
        // Try to find the company
        const companyContext = await extractCompanyFromMessage(text);
        
        if (companyContext) {
          // Fast DB query to check for meetings
          const meetingRows = await storage.rawQuery(`
            SELECT t.id, t.meeting_date, c.name as company_name
            FROM transcripts t
            JOIN companies c ON t.company_id = c.id
            WHERE t.company_id = $1
            ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
            LIMIT 1
          `, [companyContext.companyId]);
          
          let responseText: string;
          let meetingId: string | null = null;
          
          if (meetingRows && meetingRows.length > 0) {
            const meeting = meetingRows[0];
            meetingId = meeting.id as string;
            const meetingDate = meeting.meeting_date 
              ? new Date(meeting.meeting_date as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "recently";
            responseText = `Yes, there's a meeting with ${companyContext.companyName} from ${meetingDate}.\n\nWould you like the key takeaways or next steps?`;
          } else {
            responseText = `No, I don't see any meetings with ${companyContext.companyName} in the system.`;
          }
          
          if (!testRun) {
            await postSlackMessage({
              channel,
              text: responseText,
              thread_ts: threadTs,
            });
          }
          
          // Log interaction with structured metadata
          logInteraction({
            slackChannelId: channel,
            slackThreadId: threadTs,
            slackMessageTs: messageTs,
            userId: userId || null,
            companyId: companyContext.companyId,
            meetingId,
            questionText: text,
            answerText: responseText,
            metadata: buildInteractionMetadata(
              { companyId: companyContext.companyId, companyName: companyContext.companyName, meetingId },
              {
                entryPoint: "slack",
                legacyIntent: "binary",
                answerShape: "yes_no",
                dataSource: "meeting_artifacts",
                artifactType: null,
                llmPurposes: [],
                companySource: "extracted",
                meetingSource: meetingId ? "last_meeting" : "none",
                isBinaryQuestion: true,
                clarificationState: meetingId ? {
                  awaiting: true,
                  resolvedWith: null,
                } : undefined,
                awaitingClarification: meetingId ? "takeaways_or_next_steps" : undefined,
                testRun,
              }
            ),
            testRun,
          });
          
          return; // Done - fast path completed
        }
      }
    }

    // 8. Thread context resolution (deterministic follow-up support)
    // 
    // IMPORTANT ARCHITECTURAL BOUNDARY:
    // Thread follow-ups reuse resolved entity context only.
    // LLMs never see prior answers or interaction history.
    // This enables natural follow-ups without conversation memory or hallucination risk.
    //
    let threadContext: ThreadContext | undefined;
    let awaitingClarification: string | null = null;
    let companyNameFromContext: string | null = null;
    
    // Only look up prior context if this is a reply in an existing thread
    if (isReply && shouldReuseThreadContext(text)) {
      try {
        const priorInteraction = await storage.getLastInteractionByThread(threadTs);
        if (priorInteraction) {
          // Use new schema fields directly, with fallback to resolution JSON
          const resolution = priorInteraction.resolution as Record<string, unknown> | null;
          threadContext = {
            meetingId: priorInteraction.meetingId || (resolution?.meeting_id as string | null) || null,
            companyId: priorInteraction.companyId || (resolution?.company_id as string | null) || null,
          };
          // Check awaiting clarification from resolution metadata
          const contextLayers = priorInteraction.contextLayers as Record<string, unknown> | null;
          awaitingClarification = (contextLayers?.awaitingClarification as string) || null;
          companyNameFromContext = (resolution?.company_name as string) || null;
          console.log(`[Slack] Reusing thread context: meetingId=${threadContext.meetingId}, companyId=${threadContext.companyId}, awaitingClarification=${awaitingClarification}`);
        }
      } catch (err) {
        // Non-fatal - just proceed without context
        console.error("[Slack] Failed to lookup prior interaction:", err);
      }
    } else if (isReply) {
      console.log("[Slack] User explicitly overriding context - resolving fresh");
    }
    
    // 8.5 CLARIFICATION RESPONSE HANDLING (fast path)
    //
    // If the prior interaction was a clarification request, check if this is the response.
    // Route directly to meeting artifacts without LLM calls.
    //
    if (awaitingClarification === "next_steps_or_summary" && threadContext?.companyId) {
      const lowerText = text.toLowerCase().trim();
      const isNextStepsResponse = /\b(next\s*steps?|action\s*items?|follow[- ]?ups?|commitments?)\b/i.test(lowerText);
      const isSummaryResponse = /\b(summary|summarize|overview|brief)\b/i.test(lowerText);
      
      if (isNextStepsResponse || isSummaryResponse) {
        console.log(`[Slack] Clarification response detected: ${isNextStepsResponse ? 'next_steps' : 'summary'}`);
        
        // Get the last meeting for this company (fast DB query, no LLM)
        const lastMeetingRows = await storage.rawQuery(`
          SELECT t.id, t.meeting_date, c.name as company_name
          FROM transcripts t
          JOIN companies c ON t.company_id = c.id
          WHERE t.company_id = $1
          ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
          LIMIT 1
        `, [threadContext.companyId]);
        
        if (lastMeetingRows && lastMeetingRows.length > 0) {
          const meeting = lastMeetingRows[0];
          const meetingId = meeting.id as string;
          const companyName = (meeting.company_name as string) || companyNameFromContext || "Unknown";
          const meetingDate = meeting.meeting_date ? new Date(meeting.meeting_date as string) : null;
          
          const singleMeetingContext: SingleMeetingContext = {
            meetingId,
            companyId: threadContext.companyId,
            companyName,
            meetingDate,
          };
          
          // Route directly to single-meeting orchestrator with explicit intent
          const result = await handleSingleMeetingQuestion(
            singleMeetingContext,
            isNextStepsResponse ? "What are the next steps?" : "Give me a brief summary",
            false
          );
          
          if (!testRun) {
            await postSlackMessage({
              channel,
              text: result.answer,
              thread_ts: threadTs,
            });
          }
          
          // Log interaction with structured metadata
          const responseType = isNextStepsResponse ? 'next_steps' : 'summary';
          logInteraction({
            slackChannelId: channel,
            slackThreadId: threadTs,
            slackMessageTs: messageTs,
            userId: userId || null,
            companyId: threadContext.companyId,
            meetingId,
            questionText: text,
            answerText: result.answer,
            metadata: buildInteractionMetadata(
              { companyId: threadContext.companyId, meetingId },
              {
                entryPoint: "slack",
                legacyIntent: isNextStepsResponse ? "next_steps" : "summary",
                answerShape: isNextStepsResponse ? "list" : "summary",
                dataSource: mapLegacyDataSource(result.dataSource),
                artifactType: isNextStepsResponse ? "action_items" : null,
                llmPurposes: isNextStepsResponse ? [] : ["summary"],
                companySource: "thread",
                meetingSource: "last_meeting",
                clarificationState: {
                  awaiting: false,
                  resolvedWith: responseType as ClarificationResolution,
                },
                testRun,
              }
            ),
            testRun,
          });
          
          return; // Done - fast path completed
        }
      }
    }

    // 9. STEP 0: Meeting Resolution (runs before intent classification)
    // 
    // Resolution Order (Strict):
    // 1. Thread context (highest priority) - always wins
    // 2. Explicit meeting ID/link in message
    // 3. Explicit temporal language (new threads only)
    //    - "last meeting", "latest meeting", "most recent meeting"
    //    - "meeting on <date>"
    //    - "meeting last week", "meeting last month"
    //
    // If ambiguous → ask for clarification (no intent classification runs)
    // If resolved → proceed to single-meeting mode
    //
    let resolvedMeeting: { meetingId: string; companyId: string; companyName: string; meetingDate?: Date | null } | null = null;
    
    // Only attempt temporal resolution if:
    // - No thread context exists, OR
    // - Message explicitly uses temporal language
    const { hasMeetingRef, regexResult, llmCalled, llmResult, llmLatencyMs } = await hasTemporalMeetingReference(text);
    const meetingDetection = { regexResult, llmCalled, llmResult, llmLatencyMs };
    
    if (!threadContext?.meetingId || hasMeetingRef) {
      console.log(`[Slack] Step 0: Meeting resolution (hasMeetingRef=${hasMeetingRef}, regex=${regexResult}, llm=${llmResult})`);
      
      const resolution = await resolveMeetingFromSlackMessage(text, threadContext, { llmMeetingRefDetected: llmResult === true });
      
      if (resolution.resolved) {
        resolvedMeeting = {
          meetingId: resolution.meetingId,
          companyId: resolution.companyId,
          companyName: resolution.companyName,
          meetingDate: resolution.meetingDate,
        };
        console.log(`[Slack] Meeting resolved: ${resolvedMeeting.meetingId} (${resolvedMeeting.companyName})`);
      } else if (resolution.needsClarification) {
        // Clarification needed - respond and stop processing
        console.log(`[Slack] Clarification needed: ${resolution.message}`);
        
        if (!testRun) {
          await postSlackMessage({
            channel,
            text: resolution.message,
            thread_ts: threadTs,
          });
        }
        
        // Log interaction for clarification with structured metadata
        logInteraction({
          slackChannelId: channel,
          slackThreadId: threadTs,
          slackMessageTs: messageTs,
          userId: userId || null,
          companyId: null,
          meetingId: null,
          questionText: text,
          answerText: resolution.message,
          metadata: buildInteractionMetadata(
            {},
            {
              entryPoint: "slack",
              legacyIntent: "unknown",
              answerShape: "none",
              dataSource: "not_found",
              llmPurposes: [],
              companySource: "none",
              meetingSource: "none",
              ambiguity: {
                detected: true,
                clarificationAsked: true,
                type: null,
              },
              testRun,
              meetingDetection,
            }
          ),
          testRun,
        });
        
        return; // Stop processing - clarification required
      }
      // If not resolved and no clarification needed, proceed to MCP router
    } else if (threadContext?.meetingId && threadContext?.companyId) {
      // Thread context exists - use it
      const [companyRows, transcriptRows] = await Promise.all([
        storage.rawQuery(`SELECT name FROM companies WHERE id = $1`, [threadContext.companyId]),
        storage.rawQuery(`SELECT COALESCE(meeting_date, created_at) as meeting_date FROM transcripts WHERE id = $1`, [threadContext.meetingId]),
      ]);
      resolvedMeeting = {
        meetingId: threadContext.meetingId,
        companyId: threadContext.companyId,
        companyName: (companyRows?.[0]?.name as string) || "Unknown Company",
        meetingDate: transcriptRows?.[0]?.meeting_date ? new Date(transcriptRows[0].meeting_date as string) : null,
      };
    }

    // 10. Process request
    // 
    // SINGLE-MEETING MODE:
    // When meeting is resolved (from thread or temporal language),
    // use SingleMeetingOrchestrator for read-only artifact routing.
    // 
    // MULTI-CONTEXT MODE:
    // Otherwise, use MCP router for cross-meeting and analytics capabilities.
    //
    const isSingleMeetingMode = Boolean(resolvedMeeting);

    try {
      let responseText: string;
      let capabilityName: string;
      let resolvedCompanyId: string | null = null;
      let resolvedMeetingId: string | null = null;
      let intentClassification: string | null = null;
      let dataSource: string | null = null;

      // Track pending offer state for single-meeting confirmations
      let pendingOffer: string | undefined;
      let semanticAnswerUsed: boolean | undefined;
      let semanticConfidence: string | undefined;
      let isSemanticDebug: boolean | undefined;
      let semanticError: string | undefined;
      // Conversational behavior tracking
      let isClarificationRequest: boolean | undefined;
      let isBinaryQuestion: boolean | undefined;
      
      // Control Plane and Open Assistant results (for metadata logging)
      let controlPlaneResult: ControlPlaneResult | null = null;
      let openAssistantResultData: OpenAssistantResult | null = null;

      if (isSingleMeetingMode && resolvedMeeting) {
        // SINGLE-MEETING MODE: Use orchestrator with read-only artifact access
        console.log(`[Slack] Single-meeting mode activated for meeting ${resolvedMeeting.meetingId} (${resolvedMeeting.companyName})`);
        
        // Check for pending summary offer from last interaction in this thread
        let hasPendingOffer = false;
        if (threadTs) {
          const lastInteraction = await storage.getLastInteractionByThread(threadTs);
          if (lastInteraction) {
            // Check resolution JSON for pending offer
            const resolution = lastInteraction.resolution as Record<string, unknown> | null;
            hasPendingOffer = resolution?.pendingOffer === "summary";
            console.log(`[Slack] Thread has pending offer: ${hasPendingOffer}`);
          }
        }
        
        const singleMeetingContext: SingleMeetingContext = {
          meetingId: resolvedMeeting.meetingId,
          companyId: resolvedMeeting.companyId,
          companyName: resolvedMeeting.companyName,
          meetingDate: resolvedMeeting.meetingDate,
        };
        
        const result = await handleSingleMeetingQuestion(singleMeetingContext, text, hasPendingOffer);
        responseText = result.answer;
        capabilityName = `single_meeting_${result.intent}`;
        resolvedCompanyId = singleMeetingContext.companyId;
        resolvedMeetingId = singleMeetingContext.meetingId;
        intentClassification = result.intent;
        dataSource = result.dataSource;
        pendingOffer = result.pendingOffer;
        semanticAnswerUsed = result.semanticAnswerUsed;
        semanticConfidence = result.semanticConfidence;
        isSemanticDebug = result.isSemanticDebug;
        semanticError = result.semanticError;
        // Conversational behavior flags
        isClarificationRequest = result.isClarificationRequest;
        isBinaryQuestion = result.isBinaryQuestion;
        
        console.log(`[Slack] Single-meeting response: intent=${result.intent}, source=${result.dataSource}, pendingOffer=${result.pendingOffer}, semantic=${semanticAnswerUsed ? semanticConfidence : 'N/A'}, isSemanticDebug=${isSemanticDebug}, semanticError=${semanticError || 'none'}, clarification=${isClarificationRequest || false}, binary=${isBinaryQuestion || false}`);
      } else {
        // OPEN ASSISTANT MODE: Intent-driven routing for non-meeting requests
        // Step 1: Control plane intent classification (keyword fast-paths + LLM fallback)
        // Step 2: Route to appropriate handler based on intent
        console.log(`[Slack] Open Assistant mode - running full control plane pipeline`);
        
        controlPlaneResult = await runControlPlane(text);
        console.log(`[Slack] Control plane: intent=${controlPlaneResult.intent}, contract=${controlPlaneResult.answerContract}, method=${controlPlaneResult.intentDetectionMethod}, layers=${JSON.stringify(controlPlaneResult.contextLayers)}`);
        
        openAssistantResultData = await handleOpenAssistant(text, {
          userId: userId || undefined,
          threadId: threadTs,
          conversationContext: threadContext ? `Company: ${resolvedMeeting?.companyName || 'unknown'}` : undefined,
          resolvedMeeting: resolvedMeeting ? {
            meetingId: resolvedMeeting.meetingId,
            companyId: resolvedMeeting.companyId,
            companyName: resolvedMeeting.companyName,
            meetingDate: resolvedMeeting.meetingDate,
          } : null,
          controlPlaneResult: controlPlaneResult,
        });
        
        responseText = openAssistantResultData.answer;
        capabilityName = `open_assistant_${openAssistantResultData.intent}`;
        intentClassification = openAssistantResultData.intent;
        dataSource = openAssistantResultData.dataSource;
        
        if (openAssistantResultData.singleMeetingResult) {
          resolvedCompanyId = resolvedMeeting?.companyId || null;
          resolvedMeetingId = resolvedMeeting?.meetingId || null;
          semanticAnswerUsed = openAssistantResultData.singleMeetingResult.semanticAnswerUsed;
          semanticConfidence = openAssistantResultData.singleMeetingResult.semanticConfidence;
        }
        
        console.log(`[Slack] Open Assistant response: intent=${openAssistantResultData.intent}, controlPlane=${openAssistantResultData.controlPlaneIntent || 'none'}, contract=${openAssistantResultData.answerContract || 'none'}, ssot=${openAssistantResultData.ssotMode || 'none'}, dataSource=${openAssistantResultData.dataSource}, delegated=${openAssistantResultData.delegatedToSingleMeeting}`);
      }

      // Post response to Slack (skip in test mode)
      // For Open Assistant responses, use document support to generate .docx for long content
      let botReply: { ts: string };
      if (testRun) {
        botReply = { ts: `test-${Date.now()}` };
      } else if (openAssistantResultData?.answerContract && !isSingleMeetingMode) {
        // Open Assistant responses may generate documents for specific contracts or long content
        const docResult = await sendResponseWithDocumentSupport({
          channel,
          threadTs,
          content: responseText,
          contract: openAssistantResultData.answerContract,
          customerName: resolvedMeeting?.companyName,
        });
        // Document upload doesn't return a message ts, so we generate a placeholder
        botReply = { ts: docResult.type === "document" ? `doc-${Date.now()}` : `msg-${Date.now()}` };
      } else {
        botReply = await postSlackMessage({
          channel,
          text: responseText,
          thread_ts: threadTs,
        });
      }

      // Log interaction with structured metadata (write-only, non-blocking)
      // Note: slackMessageTs captures the bot's reply timestamp for audit purposes
      const resolvedMetadata = (() => {
        if (isSingleMeetingMode) {
          // Map dataSource to our structured format
          const mappedDataSource: DataSource = mapLegacyDataSource(dataSource);
          
          // Map to artifact type
          const mappedArtifact: MeetingArtifactType = mapLegacyArtifactType(dataSource);
          
          // Map intent
          const mappedIntent: LegacyIntent =
            intentClassification === "summary" ? "summary" :
            isBinaryQuestion ? "binary" :
            dataSource === "attendees" ? "attendees" :
            dataSource === "action_items" ? "next_steps" : "content";
          
          // Map answer shape - customer_questions, action_items, attendees are all lists
          const mappedShape: AnswerShape =
            intentClassification === "summary" ? "summary" :
            isBinaryQuestion ? "yes_no" :
            (dataSource === "attendees" || dataSource === "action_items" || dataSource === "customer_questions") ? "list" : "single_value";
          
          // Collect LLM purposes
          const llmPurposes: LlmPurpose[] = [];
          if (semanticAnswerUsed) llmPurposes.push("semantic_answer");
          if (intentClassification === "summary") llmPurposes.push("summary");
          
          return buildInteractionMetadata(
            { companyId: resolvedCompanyId || undefined, meetingId: resolvedMeetingId },
            {
              entryPoint: "slack",
              legacyIntent: mappedIntent,
              answerShape: mappedShape,
              dataSource: mappedDataSource,
              artifactType: mappedArtifact,
              llmPurposes,
              companySource: threadContext?.companyId ? "thread" : "extracted",
              meetingSource: threadContext?.meetingId ? "thread" : (hasMeetingRef ? "explicit" : "last_meeting"),
              isBinaryQuestion,
              semanticAnswerUsed,
              semanticConfidence,
              pendingOffer,
              testRun,
              meetingDetection,
            }
          );
        } else {
          // Open Assistant path - use actual Control Plane results
          const mappedDataSource: DataSource = mapLegacyDataSource(dataSource);
          
          // Use Control Plane result directly (full pipeline with intent, contract, layers)
          // OpenAssistant may override contract if it does additional processing
          const actualIntent = controlPlaneResult?.intent || openAssistantResultData?.controlPlaneIntent || "GENERAL_HELP";
          const actualContract = controlPlaneResult?.answerContract || openAssistantResultData?.answerContract || "GENERAL_RESPONSE";
          const actualContractChain = openAssistantResultData?.answerContractChain;
          const actualSsotMode = openAssistantResultData?.ssotMode || "none";
          
          // Use context layers from Control Plane result directly
          const contextLayers = controlPlaneResult?.contextLayers || {
            product_identity: true, // Always on
            product_ssot: actualIntent === "PRODUCT_KNOWLEDGE",
            single_meeting: actualIntent === "SINGLE_MEETING",
            multi_meeting: actualIntent === "MULTI_MEETING",
            document_context: actualIntent === "DOCUMENT_SEARCH",
          };
          
          return buildInteractionMetadata(
            { companyId: resolvedCompanyId || undefined, meetingId: resolvedMeetingId },
            {
              entryPoint: "slack",
              controlPlane: {
                intent: actualIntent as any,
                intentDetectionMethod: (controlPlaneResult?.intentDetectionMethod as "keyword" | "pattern" | "entity" | "llm" | "default") || "keyword",
                contextLayers,
                answerContract: actualContract as any,
                contractChain: actualContractChain?.map((c: any) => ({ 
                  contract: String(c), 
                  ssot_mode: actualSsotMode as any, 
                  selection_method: "default" as const 
                })),
                contractSelectionMethod: (controlPlaneResult?.contractSelectionMethod as "keyword" | "llm" | "default") || "default",
                ssotMode: actualSsotMode as any,
              },
              answerShape: "summary",
              dataSource: mappedDataSource,
              llmPurposes: ["intent_classification"],
              companySource: threadContext?.companyId ? "thread" : "extracted",
              meetingSource: threadContext?.meetingId ? "thread" : "none",
              openAssistant: {
                intent: intentClassification as string,
                dataSource: dataSource as string,
                delegatedToSingleMeeting: Boolean(semanticAnswerUsed),
              },
              evidenceSources: openAssistantResultData?.evidenceSources?.map(s => ({ type: s })),
              testRun,
              meetingDetection,
            }
          );
        }
      })();
      
      logInteraction({
        slackChannelId: channel,
        slackThreadId: threadTs,
        slackMessageTs: botReply.ts,
        userId: userId || null,
        companyId: resolvedCompanyId,
        meetingId: resolvedMeetingId,
        questionText: text,
        answerText: responseText,
        metadata: resolvedMetadata,
        testRun,
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

      if (!testRun) {
        await postSlackMessage({
          channel,
          text: userMessage,
          thread_ts: threadTs,
        });
      }
    }
  } catch (err) {
    console.error("Slack event handler error:", err);
    // If we haven't responded yet, send error
    if (!res.headersSent) {
      res.status(500).send("Internal error");
    }
  }
}
