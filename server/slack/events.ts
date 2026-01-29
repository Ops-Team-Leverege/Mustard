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
import { getProgressMessage, getProgressDelayMs } from "./progressMessages";
import { RequestLogger } from "../utils/slackLogger";

export interface PipelineTiming {
  intent_classification_ms?: number;
  entity_resolution_ms?: number;
  meeting_search_ms?: number;
  context_building_ms?: number;
  contract_execution_ms?: number;
  llm_generation_ms?: number;
  document_generation_ms?: number | null;
  total_time_ms?: number;
}

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

    // Initialize structured logger for this request
    const logger = new RequestLogger(channel, threadTs, userId);
    logger.info('Slack event received', { 
      text: text.substring(0, 100),
      isReply,
      testRun
    });

    console.log(`Processing: "${text}" in channel ${channel} (isReply=${isReply})`);

    // 7. Send immediate acknowledgment (UX improvement - reduces perceived latency)
    // Skip Slack API calls in test mode to avoid errors with fake channels
    // Uses general acknowledgments with icons
    const ackMessage = userId
      ? generateAckWithMention(userId)
      : generateAck(null);

    if (!testRun) {
      await postSlackMessage({
        channel,
        text: ackMessage,
        thread_ts: threadTs,
      });
    } else {
      console.log("[Slack] Test mode - skipping acknowledgment message");
    }

    // 7.1 Start pipeline timing and progress message timer (recurring, max 4 messages)
    const pipelineStartTime = Date.now();
    let progressMessageCount = 0;
    const MAX_PROGRESS_MESSAGES = 4;
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    
    if (!testRun) {
      progressInterval = setInterval(async () => {
        if (progressMessageCount >= MAX_PROGRESS_MESSAGES) {
          return; // Stop sending after max reached
        }
        try {
          const progressMsg = getProgressMessage();
          await postSlackMessage({
            channel,
            text: progressMsg,
            thread_ts: threadTs,
          });
          progressMessageCount++;
          console.log(`[Slack] Progress message #${progressMessageCount} sent`);
        } catch (err) {
          console.error("[Slack] Failed to send progress message:", err);
        }
      }, getProgressDelayMs());
    }
    
    // Helper to clear progress interval
    const clearProgressTimer = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };

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
      
      clearProgressTimer();
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
          
          clearProgressTimer();
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
    let storedProposedInterpretation: { intent: string; contract: string; summary: string } | null = null;
    let originalQuestion: string | null = null;
    
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
          
          // Check for stored proposed interpretation (for "yes" or numbered responses)
          storedProposedInterpretation = (contextLayers?.proposedInterpretation as typeof storedProposedInterpretation) || null;
          originalQuestion = priorInteraction.questionText || null;
          
          console.log(`[Slack] Reusing thread context: meetingId=${threadContext.meetingId}, companyId=${threadContext.companyId}, awaitingClarification=${awaitingClarification}, hasProposedInterpretation=${!!storedProposedInterpretation}`);
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
          
          clearProgressTimer();
          return; // Done - fast path completed
        }
      }
    }
    
    // 8.6 PROPOSED INTERPRETATION FOLLOW-UP (for "yes", "1", etc. responses)
    //
    // When the user replies to a clarification with confirmation, execute the stored interpretation.
    //
    if (storedProposedInterpretation && originalQuestion) {
      const lowerText = text.toLowerCase().trim();
      
      // Detect confirmation patterns: "yes", "1", "first one", "that", "go ahead", etc.
      const isConfirmation = /^(yes|yeah|yep|yup|ok|okay|sure|1|first|that|go\s*ahead|do\s*it|please)$/i.test(lowerText) ||
                            /^(sounds?\s*good|let'?s?\s*do\s*(it|that)|proceed)$/i.test(lowerText);
      
      if (isConfirmation) {
        console.log(`[Slack] Clarification confirmed - using proposed interpretation: intent=${storedProposedInterpretation.intent}, contract=${storedProposedInterpretation.contract}`);
        
        // Map intent string to Intent enum
        const intentMap: Record<string, string> = {
          "SINGLE_MEETING": "SINGLE_MEETING",
          "MULTI_MEETING": "MULTI_MEETING", 
          "PRODUCT_KNOWLEDGE": "PRODUCT_KNOWLEDGE",
          "EXTERNAL_RESEARCH": "EXTERNAL_RESEARCH",
          "DOCUMENT_SEARCH": "DOCUMENT_SEARCH",
          "GENERAL_HELP": "GENERAL_HELP",
        };
        
        const mappedIntent = intentMap[storedProposedInterpretation.intent] || "GENERAL_HELP";
        
        // Create synthetic control plane result with the stored interpretation
        const syntheticControlPlane = {
          intent: mappedIntent as any,
          answerContract: storedProposedInterpretation.contract as any,
          intentDetectionMethod: "clarification_followup",
          contractSelectionMethod: "clarification_followup",
          contextLayers: {
            product_identity: true,
            product_ssot: false,
            single_meeting: mappedIntent === "SINGLE_MEETING",
            multi_meeting: mappedIntent === "MULTI_MEETING",
            document_context: mappedIntent === "DOCUMENT_SEARCH",
          },
        };
        
        // Route to Open Assistant with the original question and confirmed interpretation
        const openAssistantResult = await handleOpenAssistant(originalQuestion, {
          userId: userId || undefined,
          threadId: threadTs,
          resolvedMeeting: threadContext?.meetingId ? {
            meetingId: threadContext.meetingId,
            companyId: threadContext.companyId || '',
            companyName: companyNameFromContext || 'Unknown',
            meetingDate: null,
          } : null,
          controlPlaneResult: syntheticControlPlane,
        });
        
        if (!testRun) {
          await postSlackMessage({
            channel,
            text: openAssistantResult.answer,
            thread_ts: threadTs,
          });
        }
        
        // Log interaction
        logInteraction({
          slackChannelId: channel,
          slackThreadId: threadTs,
          slackMessageTs: messageTs,
          userId: userId || null,
          companyId: threadContext?.companyId || null,
          meetingId: threadContext?.meetingId || null,
          questionText: originalQuestion,
          answerText: openAssistantResult.answer,
          metadata: buildInteractionMetadata(
            { companyId: threadContext?.companyId || undefined, meetingId: threadContext?.meetingId },
            {
              entryPoint: "slack",
              legacyIntent: storedProposedInterpretation.intent.toLowerCase(),
              answerShape: "summary",
              dataSource: openAssistantResult.dataSource as any,
              clarificationState: {
                awaiting: false,
                resolvedWith: "confirmed" as any,
              },
              testRun,
            }
          ),
          testRun,
        });
        
        clearProgressTimer();
        return; // Done - clarification follow-up completed
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
    let resolvedMeeting: { meetingId: string; companyId: string; companyName: string; meetingDate?: Date | null; wasAutoSelected?: boolean } | null = null;
    let mrDuration = 0; // Meeting resolution timing
    
    // Only attempt temporal resolution if:
    // - No thread context exists, OR
    // - Message explicitly uses temporal language
    const { hasMeetingRef, regexResult, llmCalled, llmResult, llmLatencyMs } = await hasTemporalMeetingReference(text);
    const meetingDetection = { regexResult, llmCalled, llmResult, llmLatencyMs };
    
    if (!threadContext?.meetingId || hasMeetingRef) {
      console.log(`[Slack] Step 0: Meeting resolution (hasMeetingRef=${hasMeetingRef}, regex=${regexResult}, llm=${llmResult})`);
      
      logger.startStage('meeting_resolution');
      const resolution = await resolveMeetingFromSlackMessage(text, threadContext, { llmMeetingRefDetected: llmResult === true });
      mrDuration = logger.endStage('meeting_resolution');
      
      if (resolution.resolved) {
        resolvedMeeting = {
          meetingId: resolution.meetingId,
          companyId: resolution.companyId,
          companyName: resolution.companyName,
          meetingDate: resolution.meetingDate,
          wasAutoSelected: resolution.wasAutoSelected,
        };
        logger.debug('Meeting resolution completed', {
          resolved: true,
          meetingId: resolution.meetingId,
          companyName: resolution.companyName,
          wasAutoSelected: resolution.wasAutoSelected,
          duration_ms: mrDuration,
        });
        console.log(`[Slack] Meeting resolved: ${resolvedMeeting.meetingId} (${resolvedMeeting.companyName})${resolution.wasAutoSelected ? ' [auto-selected most recent]' : ''}`);
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
        
        clearProgressTimer();
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
    // LLM-FIRST ARCHITECTURE:
    // Always run Control Plane first to classify intent from the FULL message.
    // This ensures semantic understanding (e.g., "search all calls about Ivy Lane" 
    // is correctly classified as MULTI_MEETING, not single-meeting).
    // 
    // Routing is then based on classified intent:
    // - SINGLE_MEETING + resolved meeting → SingleMeetingOrchestrator
    // - MULTI_MEETING → Open Assistant (cross-meeting search)
    // - CLARIFY → Ask user for clarification
    // - Other intents → Open Assistant with appropriate handlers

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
      let usedSingleMeetingMode = false;
      
      // Stage timing tracking
      let cpDuration = 0;
      let smDuration = 0;
      let oaDuration = 0;

      // STEP 1: ALWAYS run Control Plane first to classify intent from full message
      console.log(`[Slack] LLM-first architecture - running Control Plane for intent classification`);
      logger.startStage('control_plane');
      controlPlaneResult = await runControlPlane(text);
      cpDuration = logger.endStage('control_plane');
      logger.info('Control Plane completed', {
        intent: controlPlaneResult.intent,
        contract: controlPlaneResult.answerContract,
        method: controlPlaneResult.intentDetectionMethod,
        resolvedMeetingId: resolvedMeeting?.meetingId,
        duration_ms: cpDuration,
      });
      console.log(`[Slack] Control plane: intent=${controlPlaneResult.intent}, contract=${controlPlaneResult.answerContract}, method=${controlPlaneResult.intentDetectionMethod}, layers=${JSON.stringify(controlPlaneResult.contextLayers)}`);
      
      // STEP 2: Handle CLARIFY intent - ask user for clarification
      if (controlPlaneResult.intent === "CLARIFY") {
        const clarifyMessage = controlPlaneResult.clarifyMessage 
          || "I'm not sure what you're asking. Could you please clarify?";
        responseText = clarifyMessage;
        capabilityName = "clarify";
        intentClassification = "clarify";
        dataSource = "none";
        isClarificationRequest = true;
        console.log(`[Slack] Clarification requested: ${clarifyMessage}`);
      }
      // STEP 3: Handle SINGLE_MEETING without resolved meeting - ask for clarification
      else if (controlPlaneResult.intent === "SINGLE_MEETING" && !resolvedMeeting) {
        responseText = "Which meeting are you asking about? Please mention the company name or a specific meeting date.";
        capabilityName = "clarify_meeting";
        intentClassification = "single_meeting_clarify";
        dataSource = "none";
        isClarificationRequest = true;
        console.log(`[Slack] SINGLE_MEETING intent but no resolved meeting - asking for clarification`);
      }
      // STEP 4: Route based on classified intent
      else if (controlPlaneResult.intent === "SINGLE_MEETING" && resolvedMeeting) {
        // SINGLE_MEETING intent with resolved meeting → use SingleMeetingOrchestrator
        usedSingleMeetingMode = true;
        console.log(`[Slack] Single-meeting mode activated for meeting ${resolvedMeeting.meetingId} (${resolvedMeeting.companyName})`);
        
        // Check for pending summary offer from last interaction in this thread
        let hasPendingOffer = false;
        if (threadTs) {
          const lastInteraction = await storage.getLastInteractionByThread(threadTs);
          if (lastInteraction) {
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
        
        logger.startStage('single_meeting');
        const result = await handleSingleMeetingQuestion(singleMeetingContext, text, hasPendingOffer);
        smDuration = logger.endStage('single_meeting');
        
        // Add note about auto-selection if we picked the most recent meeting automatically
        if (resolvedMeeting.wasAutoSelected && resolvedMeeting.meetingDate) {
          const dateStr = resolvedMeeting.meetingDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          responseText = `_Based on the most recent ${resolvedMeeting.companyName} meeting (${dateStr}):_\n\n${result.answer}`;
        } else {
          responseText = result.answer;
        }
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
        isClarificationRequest = result.isClarificationRequest;
        isBinaryQuestion = result.isBinaryQuestion;
        
        logger.info('Single meeting response generated', {
          intent: result.intent,
          dataSource: result.dataSource,
          duration_ms: smDuration,
        });
        console.log(`[Slack] Single-meeting response: intent=${result.intent}, source=${result.dataSource}, pendingOffer=${result.pendingOffer}, semantic=${semanticAnswerUsed ? semanticConfidence : 'N/A'}`);
      } else {
        // All other intents (MULTI_MEETING, PRODUCT_KNOWLEDGE, DOCUMENT_SEARCH, etc.) → Open Assistant
        console.log(`[Slack] Open Assistant mode - intent=${controlPlaneResult.intent}, routing to appropriate handler`);
        
        logger.startStage('open_assistant');
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
        oaDuration = logger.endStage('open_assistant');
        
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
        
        logger.info('Open Assistant response generated', {
          intent: openAssistantResultData.intent,
          contract: openAssistantResultData.answerContract,
          delegated: openAssistantResultData.delegatedToSingleMeeting,
          duration_ms: oaDuration,
        });
        console.log(`[Slack] Open Assistant response: intent=${openAssistantResultData.intent}, controlPlane=${openAssistantResultData.controlPlaneIntent || 'none'}, contract=${openAssistantResultData.answerContract || 'none'}, delegated=${openAssistantResultData.delegatedToSingleMeeting}`);
      }

      // Clear progress timer now that we have a response ready
      clearProgressTimer();
      
      // Calculate total pipeline time
      const totalTimeMs = Date.now() - pipelineStartTime;
      console.log(`[Slack] Pipeline completed in ${totalTimeMs}ms, progressMessages=${progressMessageCount}`);

      // Post response to Slack (skip in test mode)
      // For Open Assistant responses, use document support to generate .docx for long content
      let botReply: { ts: string };
      const hasContract = !!openAssistantResultData?.answerContract;
      const willGenerateDoc = hasContract && !usedSingleMeetingMode;
      console.log(`[Slack] === DOCUMENT DECISION ===`);
      console.log(`[Slack] testRun: ${testRun}`);
      console.log(`[Slack] contract: ${openAssistantResultData?.answerContract || 'NONE'}`);
      console.log(`[Slack] usedSingleMeetingMode: ${usedSingleMeetingMode}`);
      console.log(`[Slack] hasOpenAssistantData: ${!!openAssistantResultData}`);
      console.log(`[Slack] hasContract: ${hasContract}`);
      console.log(`[Slack] willGenerateDoc: ${willGenerateDoc}`);
      console.log(`[Slack] === END DOCUMENT DECISION ===`);
      if (testRun) {
        botReply = { ts: `test-${Date.now()}` };
      } else if (openAssistantResultData?.answerContract && !usedSingleMeetingMode) {
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
        if (usedSingleMeetingMode) {
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
          const contextLayers = (controlPlaneResult?.contextLayers || {
            product_identity: true, // Always on
            product_ssot: actualIntent === "PRODUCT_KNOWLEDGE",
            single_meeting: actualIntent === "SINGLE_MEETING",
            multi_meeting: actualIntent === "MULTI_MEETING",
            document_context: actualIntent === "DOCUMENT_SEARCH",
          }) as any;
          
          // Store proposedInterpretation for CLARIFY follow-ups
          if (actualIntent === "CLARIFY" && controlPlaneResult?.proposedInterpretation) {
            contextLayers.proposedInterpretation = controlPlaneResult.proposedInterpretation;
            contextLayers.awaitingClarification = "proposed_interpretation";
          }
          
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
        totalTimeMs,
        progressMessageCount,
      });
      
      // Log successful completion with stage breakdown
      logger.info('Request completed successfully', {
        intent: controlPlaneResult?.intent,
        contract: controlPlaneResult?.answerContract,
        responseLength: responseText?.length,
        totalTimeMs,
        stages: {
          meeting_resolution: mrDuration,
          control_plane: cpDuration,
          handler: smDuration || oaDuration,
        },
      });
      
      // Track progress message overhead
      if (progressMessageCount > 0) {
        logger.debug('Progress messages were sent', { 
          count: progressMessageCount,
          delayMs: getProgressDelayMs(),
          totalTimeMs,
        });
      }
    } catch (err) {
      // CRITICAL: Cancel progress timer to prevent sending progress message after error
      clearProgressTimer();
      
      // Detect specific error types for better user messaging
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode = (err as any)?.code || (err as any)?.status;
      
      let userMessage: string;
      let errorType: string;
      
      // OpenAI quota/rate limit errors
      if (errorCode === 'insufficient_quota' || errorCode === 429 || 
          errorMessage.includes('exceeded your current quota') ||
          errorMessage.includes('rate limit')) {
        errorType = "openai_quota";
        userMessage = "I can't process this right now — the AI service quota has been exceeded. Please contact an admin to check the OpenAI billing settings.";
      } 
      // OpenAI API key errors
      else if (errorCode === 401 || errorMessage.includes('Incorrect API key') || 
               errorMessage.includes('invalid_api_key')) {
        errorType = "openai_auth";
        userMessage = "I can't process this right now — there's an issue with the AI service configuration. Please contact an admin.";
      }
      // Generic errors
      else {
        errorType = "internal";
        userMessage = "Sorry — I hit an internal error while processing that request.";
      }
      
      // Log with full context to persistent file AND console
      const fullStack = err instanceof Error ? err.stack : undefined;
      console.error(`[PIPELINE ERROR] ${errorType}:`, errorMessage, fullStack);
      logger.error('Pipeline error', err, {
        errorType,
        errorCode,
        errorMessage,
        stack: fullStack,
        text: text.substring(0, 100),
      });
      
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
