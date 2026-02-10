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
import { postSlackMessage, fetchThreadHistory } from "./slackApi";
import { sendResponseWithDocumentSupport } from "../services/documentResponse";
import { generateAckWithMention, generateAck } from "./acknowledgments";
import { createMCP, type MCPResult } from "../mcp/toolRouter";
import { makeMCPContext, type ThreadContext } from "../mcp/context";
import { storage } from "../storage";
import { classifyPipelineError } from "../utils/errorHandler";
import { handleSingleMeetingQuestion, type SingleMeetingContext } from "../openAssistant/singleMeetingOrchestrator";
import { resolveMeetingFromSlackMessage, hasTemporalMeetingReference } from "./context/meetingResolver";
import { resolveCompany } from "./context/companyResolver";
import { buildInteractionMetadata, type EntryPoint, type LegacyIntent, type AnswerShape, type DataSource, type MeetingArtifactType, type LlmPurpose, type ResolutionSource, type ClarificationType, type ClarificationResolution } from "./interactionMetadata";
import { logInteraction, mapLegacyDataSource, mapLegacyArtifactType } from "./logInteraction";
import { handleOpenAssistant, type OpenAssistantResult } from "../openAssistant";
import type { SlackStreamingContext } from "../openAssistant/types";
import { runDecisionLayer, type DecisionLayerResult } from "../decisionLayer";
import { getProgressMessage, getProgressDelayMs, generatePersonalizedProgressMessage, type ProgressIntentType } from "./progressMessages";
import { RequestLogger } from "../utils/slackLogger";
import { PROGRESS_MESSAGE_CONSTANTS } from "../config/constants";

// Extracted handler modules
import { handleAmbiguity } from "./handlers/ambiguityHandler";
import { handleBinaryQuestion } from "./handlers/binaryQuestionHandler";
import { handleNextStepsOrSummaryResponse, handleProposedInterpretationConfirmation } from "./handlers/clarificationHandler";
import { handleAnswerQuestions } from "./handlers/answerQuestionsHandler";
import { createProgressManager } from "./context/progressManager";
import { resolveThreadContext, shouldReuseThreadContext } from "./context/threadResolver";
import { getSourceAttribution } from "./sourceAttribution";
import { getMeetingNotFoundMessage } from "../utils/notFoundMessages";

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

import { isDuplicate, maybeCleanup } from '../services/eventDeduplicator';

// Helper to check for duplicate events (async wrapper)
async function isDuplicateEvent(eventId: string, clientMsgId: string | undefined): Promise<boolean> {
  maybeCleanup();
  return isDuplicate(eventId, clientMsgId);
}


export async function slackEventsHandler(req: Request, res: Response) {
  console.log(`[Slack] ========== EVENT RECEIVED AT ${new Date().toISOString()} ==========`);

  // Check for Slack retry headers
  const retryNum = req.headers['x-slack-retry-num'];
  const retryReason = req.headers['x-slack-retry-reason'];

  if (retryNum) {
    console.log(`[Slack] Retry #${retryNum} received (reason: ${retryReason})`);
    // If this is a retry due to http_timeout, we already processed it
    // Return 200 immediately to stop further retries
    if (retryReason === 'http_timeout') {
      console.log(`[Slack] Ignoring http_timeout retry - already processed`);
      return res.status(200).send();
    }
  }

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

    // 5. Handle app_mention events AND direct messages (DMs)
    // - app_mention: Bot was @mentioned in a channel
    // - message: Could be a DM (channel_type: "im") or other message
    // Test runs bypass this check to allow automated testing
    const testRun = isTestRun(req);
    const eventType = event?.type;
    const channelType = event?.channel_type;
    const isDirectMessage = eventType === "message" && channelType === "im";
    const isAppMention = eventType === "app_mention";

    // Ignore bot's own messages to prevent loops
    const botId = event?.bot_id;
    if (botId) {
      console.log("[Slack] Ignoring bot message (preventing loop)");
      return;
    }

    // Ignore message subtypes (edits, deletes, etc.) - only process original messages
    const subtype = event?.subtype;
    if (subtype) {
      console.log(`[Slack] Ignoring message subtype: ${subtype}`);
      return;
    }

    // Only process app_mentions, DMs, or test runs
    if (!isAppMention && !isDirectMessage && !testRun) {
      console.log(`[Slack] Ignoring event: type=${eventType}, channel_type=${channelType}`);
      return;
    }

    if (testRun) {
      console.log("[Slack] Test run mode - bypassing event type check");
    } else if (isDirectMessage) {
      console.log("[Slack] Processing direct message");
    } else {
      console.log("[Slack] Processing app_mention");
    }

    // Extract message details early for deduplication
    const channel = String(event.channel);
    const messageTs = String(event.ts); // This specific message's timestamp
    // For thread replies, use thread_ts (parent message); otherwise use ts (this message starts a thread)
    const threadTs = String(event.thread_ts || event.ts);

    // 6. Dedupe events using robust deduplication
    // Uses event_id, client_msg_id, AND message timestamp for reliable duplicate detection
    const eventId = String(payload.event_id || "");
    const clientMsgId = event?.client_msg_id as string | undefined;

    // Log event details for debugging duplicate issues
    console.log(`[Slack] Event details: eventId=${eventId}, clientMsgId=${clientMsgId}, messageTs=${messageTs}, threadTs=${threadTs}, channel=${channel}`);

    if (await isDuplicateEvent(eventId, clientMsgId)) {
      console.log(`[Slack] Duplicate event detected - skipping (eventId=${eventId}, clientMsgId=${clientMsgId})`);
      return;
    }

    // Also dedupe by message timestamp to catch Slack sending multiple events for same message
    if (await isDuplicateEvent(`ts:${messageTs}`, undefined)) {
      console.log(`[Slack] Duplicate message timestamp detected - skipping (ts=${messageTs})`);
      return;
    }
    // For DMs, don't strip @mention (users don't need to mention bot in DMs)
    // For app_mention, strip the @mention from the beginning
    const rawText = String(event.text || "");
    const text = isDirectMessage ? rawText.trim() : cleanMention(rawText);
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

    // 7.1 Start pipeline timing and progress message coordination
    const pipelineStartTime = Date.now();
    let progressMessageCount = 0;
    const MAX_PROGRESS_MESSAGES = PROGRESS_MESSAGE_CONSTANTS.MAX_PROGRESS_MESSAGES;
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    // Response coordination: prevents progress messages after response is sent
    // This is critical to avoid race conditions where async progress posts after final answer
    let responseSent = false;
    const markResponseSent = () => { responseSent = true; };
    const canPostProgress = () => !responseSent && progressMessageCount < MAX_PROGRESS_MESSAGES;

    if (!testRun) {
      progressInterval = setInterval(async () => {
        // Check coordination flag before posting
        if (!canPostProgress()) {
          return;
        }
        try {
          const progressMsg = getProgressMessage();
          // Double-check after await to prevent race
          if (responseSent) return;
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

    // Helper to clear progress interval and mark response as sent
    const clearProgressTimer = () => {
      markResponseSent(); // Prevent any in-flight progress from posting
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };

    // 7.5 EARLY AMBIGUITY DETECTION (preparation/briefing questions)
    // Extracted to handlers/ambiguityHandler.ts
    const ambiguityResult = await handleAmbiguity({
      channel,
      threadTs,
      messageTs,
      text,
      userId: userId || null,
      testRun,
    });
    if (ambiguityResult.handled) {
      clearProgressTimer();
      return; // Stop processing - clarification required
    }

    // 7.6 EARLY BINARY QUESTION HANDLING (existence checks)
    // Extracted to handlers/binaryQuestionHandler.ts
    const binaryResult = await handleBinaryQuestion({
      channel,
      threadTs,
      messageTs,
      text,
      userId: userId || null,
      testRun,
    });
    if (binaryResult.handled) {
      clearProgressTimer();
      return; // Done - fast path completed
    }

    // 8. Thread context resolution (deterministic follow-up support)
    // Extracted to context/threadResolver.ts
    const threadResolution = await resolveThreadContext(threadTs, text, isReply);
    const threadContext = threadResolution.threadContext;
    const awaitingClarification = threadResolution.awaitingClarification;
    const companyNameFromContext = threadResolution.companyNameFromContext;
    const storedProposedInterpretation = threadResolution.storedProposedInterpretation;
    const originalQuestion = threadResolution.originalQuestion;
    const lastResponseType = threadResolution.lastResponseType;

    // 8.5 CLARIFICATION RESPONSE HANDLING (fast path)
    // Extracted to handlers/clarificationHandler.ts
    const clarificationCtx = {
      channel,
      threadTs,
      messageTs,
      text,
      userId: userId || null,
      testRun,
      threadContext,
      awaitingClarification,
      companyNameFromContext,
      storedProposedInterpretation,
      originalQuestion,
    };

    const nextStepsResult = await handleNextStepsOrSummaryResponse(clarificationCtx);
    if (nextStepsResult.handled) {
      clearProgressTimer();
      return; // Done - fast path completed
    }

    // 8.6 PROPOSED INTERPRETATION FOLLOW-UP (for "yes", "1", etc. responses)
    // Extracted to handlers/clarificationHandler.ts
    const confirmationResult = await handleProposedInterpretationConfirmation(clarificationCtx);
    if (confirmationResult.handled) {
      clearProgressTimer();
      return; // Done - clarification follow-up completed
    }

    // 8.7 "ANSWER THOSE QUESTIONS" FOLLOW-UP HANDLING
    // Extracted to handlers/answerQuestionsHandler.ts
    const answerQuestionsResult = await handleAnswerQuestions({
      channel,
      threadTs,
      messageTs,
      text,
      userId: userId || null,
      testRun,
      threadContext: threadContext || null,
      lastResponseType,
      companyNameFromContext,
      clearProgressTimer,
    });
    if (answerQuestionsResult.handled) {
      return; // Done - fast path completed
    }

    // INTENT-FIRST ARCHITECTURE:
    // Run Decision Layer FIRST to classify intent, then resolve meeting only when needed.
    // This saves ~1.5s for non-meeting requests (60% of traffic).
    let resolvedMeeting: { meetingId: string; companyId: string; companyName: string; meetingDate?: Date | null; wasAutoSelected?: boolean } | null = null;
    let mrDuration = 0;
    // meetingDetection is set after intent classification for meeting intents
    let meetingDetection: { regexResult: boolean; llmCalled: boolean; llmResult: boolean | null; llmLatencyMs: number | null } = { regexResult: false, llmCalled: false, llmResult: null, llmLatencyMs: null };

    // 10. Process request
    // 
    // LLM-FIRST ARCHITECTURE:
    // Always run Decision Layer first to classify intent from the FULL message.
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
      let semanticError: string | undefined;
      // Conversational behavior tracking
      let isClarificationRequest: boolean | undefined;
      let isBinaryQuestion: boolean | undefined;

      // Decision Layer and Open Assistant results (for metadata logging)
      let decisionLayerResult: DecisionLayerResult | null = null;
      let openAssistantResultData: OpenAssistantResult | null = null;
      let usedSingleMeetingMode = false;
      let streamingContext: SlackStreamingContext | undefined;

      // Stage timing tracking
      let cpDuration = 0;
      let smDuration = 0;
      let oaDuration = 0;

      // Company mentioned in message - extracted early and preserved for clarification flows
      let companyMentioned: { companyId: string; companyName: string } | null = null;

      // STEP 1: ALWAYS run Decision Layer first to classify intent from full message
      console.log(`[Slack] LLM-first architecture - running Decision Layer for intent classification`);
      logger.startStage('decision_layer');

      // Fetch thread history for context-aware intent classification
      let threadContextForCP: { messages: Array<{ text: string; isBot: boolean }> } | undefined;
      if (threadTs) {
        const threadHistory = await fetchThreadHistory(channel, threadTs, 10);
        if (threadHistory.length > 0) {
          threadContextForCP = {
            messages: threadHistory.map(m => ({ text: m.text, isBot: m.isBot })),
          };
          console.log(`[Slack] ✅ CONTEXT CHECKPOINT 2 - Slack Thread History:`);
          console.log(`  Thread: ${threadTs}`);
          console.log(`  Messages: ${threadHistory.length}`);
          console.log(`  Last 3 messages:`);
          threadHistory.slice(-3).forEach((msg, i) => {
            const preview = msg.text.length > 100 ? msg.text.substring(0, 100) + '...' : msg.text;
            console.log(`    ${i + 1}. ${msg.isBot ? 'Bot' : 'User'}: "${preview}"`);
          });
        } else {
          console.log(`[Slack] ✅ CONTEXT CHECKPOINT 2 - No thread history found for ${threadTs}`);
        }
      }

      decisionLayerResult = await runDecisionLayer(text, threadContextForCP);
      cpDuration = logger.endStage('decision_layer');

      console.log(`[Slack] ✅ CONTEXT CHECKPOINT 3 - Decision Layer Result:`);
      console.log(`  Intent: ${decisionLayerResult.intent} (${decisionLayerResult.intentDetectionMethod})`);
      console.log(`  Contract: ${decisionLayerResult.answerContract}`);
      console.log(`  Scope: ${JSON.stringify(decisionLayerResult.scope)}`);
      console.log(`  Clarify Message: ${decisionLayerResult.clarifyMessage ? 'yes' : 'none'}`);
      console.log(`  Context Layers: ${JSON.stringify(decisionLayerResult.contextLayers)}`);
      console.log(`  Semantic Context:`);
      console.log(`    - Extracted Company: ${decisionLayerResult.extractedCompany || 'none'}`);
      console.log(`    - Extracted Companies: ${decisionLayerResult.extractedCompanies ? decisionLayerResult.extractedCompanies.join(', ') : 'none'}`);
      console.log(`    - Is Ambiguous: ${decisionLayerResult.isAmbiguous ? 'yes' : 'no'}`);
      console.log(`    - Conversation Context: ${decisionLayerResult.conversationContext || 'none'}`);
      console.log(`    - Key Topics: ${decisionLayerResult.keyTopics ? decisionLayerResult.keyTopics.join(', ') : 'none'}`);
      console.log(`    - Should Proceed: ${decisionLayerResult.shouldProceed !== false ? 'yes' : 'no'}`);
      console.log(`    - Clarification Suggestion: ${decisionLayerResult.clarificationSuggestion || 'none'}`);

      console.log(`[Slack] Control plane: intent=${decisionLayerResult.intent}, contract=${decisionLayerResult.answerContract}, method=${decisionLayerResult.intentDetectionMethod}, layers=${JSON.stringify(decisionLayerResult.contextLayers)}`);

      // Resolve company from thread context or Decision Layer extraction
      companyMentioned = await resolveCompany({
        threadContext,
        decisionLayerResult,
      });

      // STEP 1.5: INTENT-CONDITIONAL MEETING RESOLUTION
      // Only resolve meeting for SINGLE_MEETING or MULTI_MEETING intents (saves ~1.5s for 60% of requests)
      const needsMeetingResolution = decisionLayerResult.intent === 'SINGLE_MEETING' || decisionLayerResult.intent === 'MULTI_MEETING';

      if (needsMeetingResolution) {

        // Check if thread already has meeting context (highest priority)
        if (threadContext?.meetingId && threadContext?.companyId) {
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
          console.log(`[Slack] Meeting from thread context: ${resolvedMeeting.meetingId}`);
        } else {
          // Attempt meeting resolution from message (company already extracted above)
          const { hasMeetingRef, regexResult, llmCalled, llmResult, llmLatencyMs } = await hasTemporalMeetingReference(text);
          meetingDetection = { regexResult, llmCalled, llmResult, llmLatencyMs };

          if (hasMeetingRef || companyMentioned !== null) {
            console.log(`[Slack] Meeting resolution: hasMeetingRef=${hasMeetingRef}, company=${companyMentioned?.companyName || 'none'}`);

            logger.startStage('meeting_resolution');
            const resolution = await resolveMeetingFromSlackMessage(text, threadContext, {
              llmMeetingRefDetected: llmResult === true,
              extractedCompanyContext: companyMentioned || undefined
            });
            mrDuration = logger.endStage('meeting_resolution');

            if (resolution.resolved) {
              resolvedMeeting = {
                meetingId: resolution.meetingId,
                companyId: resolution.companyId,
                companyName: resolution.companyName,
                meetingDate: resolution.meetingDate,
                wasAutoSelected: resolution.wasAutoSelected,
              };
              console.log(`[Slack] Meeting resolved: ${resolvedMeeting.meetingId} (${resolvedMeeting.companyName})${resolution.wasAutoSelected ? ' [auto-selected]' : ''}`);
            } else if (resolution.needsClarification) {
              // Clarification needed - respond and stop processing
              console.log(`[Slack] Meeting clarification needed: ${resolution.message}`);

              if (!testRun) {
                await postSlackMessage({
                  channel,
                  text: resolution.message,
                  thread_ts: threadTs,
                });
              }

              logInteraction({
                slackChannelId: channel,
                slackThreadId: threadTs,
                slackMessageTs: messageTs,
                userId: userId || null,
                companyId: companyMentioned?.companyId || null,
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
                    companySource: companyMentioned ? "extracted" : "none",
                    meetingSource: "none",
                    ambiguity: { detected: true, clarificationAsked: true, type: null },
                    testRun,
                    meetingDetection,
                  }
                ),
                testRun,
              });

              clearProgressTimer();
              return; // Stop - clarification required
            }
          }
        }
      } else {
        console.log(`[Slack] Non-meeting intent (${decisionLayerResult.intent}) - skipping meeting resolution`);
      }

      logger.info('Decision Layer completed', {
        intent: decisionLayerResult.intent,
        contract: decisionLayerResult.answerContract,
        method: decisionLayerResult.intentDetectionMethod,
        resolvedMeetingId: resolvedMeeting?.meetingId,
        duration_ms: cpDuration,
      });

      // EARLY PROGRESS: For SINGLE_MEETING with resolved meeting, create streaming placeholder
      // The placeholder ("...") gets updated with progress text, then with the final answer
      // This avoids posting separate progress + answer messages
      if (!testRun && decisionLayerResult.intent === 'SINGLE_MEETING' && resolvedMeeting) {
        const placeholderMsg = await postSlackMessage({
          channel,
          text: "...",
          thread_ts: threadTs,
        });
        streamingContext = {
          channel,
          messageTs: placeholderMsg.ts,
          threadTs,
        };
        console.log(`[Slack] Single-meeting streaming placeholder posted: ts=${placeholderMsg.ts}`);

        generatePersonalizedProgressMessage(text, 'single_meeting').then(async (personalizedProgress) => {
          if (!canPostProgress()) return;
          try {
            if (responseSent) return;
            const { updateSlackMessage } = await import("./slackApi");
            await updateSlackMessage({
              channel,
              ts: placeholderMsg.ts,
              text: personalizedProgress,
            });
            console.log(`[Slack] Updated placeholder with progress: "${personalizedProgress.substring(0, 50)}..."`);
          } catch (err) {
            console.error(`[Slack] Failed to update placeholder with progress:`, err);
          }
        }).catch(err => {
          console.log(`[Slack] Personalized progress generation failed:`, err);
        });
      }

      // STEP 2: Handle CLARIFY intent - ask user for clarification
      if (decisionLayerResult.intent === "CLARIFY") {
        const clarifyMessage = decisionLayerResult.clarifyMessage
          || "I'm not sure what you're asking. Could you please clarify?";
        responseText = clarifyMessage;
        capabilityName = "clarify";
        intentClassification = "clarify";
        dataSource = "none";
        isClarificationRequest = true;
        // Preserve company context from message for follow-up clarifications
        resolvedCompanyId = companyMentioned?.companyId || threadContext?.companyId || null;
      }
      // STEP 3: Handle SINGLE_MEETING without resolved meeting - ask for clarification
      else if (decisionLayerResult.intent === "SINGLE_MEETING" && !resolvedMeeting) {
        // Use whichever company name is available: DB-matched name or LLM-extracted name
        const extractedCompany = companyMentioned?.companyName || decisionLayerResult.extractedCompany || null;
        responseText = getMeetingNotFoundMessage({ extractedCompany, scope: "single" });
        capabilityName = extractedCompany ? "company_not_found" : "clarify_meeting";
        intentClassification = extractedCompany ? "single_meeting_not_found" : "single_meeting_clarify";
        dataSource = "none";
        isClarificationRequest = true;
        // Preserve company context from message for follow-up clarifications
        resolvedCompanyId = companyMentioned?.companyId || threadContext?.companyId || null;
      }
      // STEP 4: Route based on classified intent
      else if (decisionLayerResult.intent === "SINGLE_MEETING" && resolvedMeeting) {
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
        // Pass Decision Layer contract to enforce single authority for intent classification
        const result = await handleSingleMeetingQuestion(singleMeetingContext, text, hasPendingOffer, decisionLayerResult.answerContract, decisionLayerResult.requiresSemantic);
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
        // All other intents (MULTI_MEETING, PRODUCT_KNOWLEDGE, etc.) → Open Assistant
        console.log(`[Slack] Open Assistant mode - intent=${decisionLayerResult.intent}, routing to appropriate handler`);

        // Contracts that might generate documents - don't use streaming for these
        const docGeneratingContracts = [
          "VALUE_PROPOSITION", "MEETING_SUMMARY", "COMPARISON",
          "DRAFT_EMAIL", "PATTERN_ANALYSIS", "PRODUCT_EXPLANATION",
          "SALES_DOCS_PREP" // Research + writing produces a doc
        ];
        const mightGenerateDoc = docGeneratingContracts.includes(decisionLayerResult.answerContract || "");

        // Create placeholder message for streaming (if not a test run and not generating a doc)
        if (!testRun && !mightGenerateDoc) {
          const placeholderMsg = await postSlackMessage({
            channel,
            text: "...",
            thread_ts: threadTs,
          });
          streamingContext = {
            channel,
            messageTs: placeholderMsg.ts,
            threadTs,
            // Enable preview mode - if response is long enough to generate a doc,
            // only show first ~350 chars instead of full content while streaming
            previewMode: {
              maxVisibleChars: 350,
              message: "Putting together a document with full details...",
            },
          };
          console.log(`[Slack] Streaming placeholder posted with preview mode: ts=${placeholderMsg.ts}`);
        } else if (mightGenerateDoc) {
          // Doc-generating contracts also use a streaming placeholder
          // The placeholder gets updated with progress, then final answer (or doc link)
          const placeholderMsg = await postSlackMessage({
            channel,
            text: "...",
            thread_ts: threadTs,
          });
          streamingContext = {
            channel,
            messageTs: placeholderMsg.ts,
            threadTs,
          };
          console.log(`[Slack] Doc-generating streaming placeholder posted: ts=${placeholderMsg.ts}`);

          const intentType = decisionLayerResult.intent === 'MULTI_MEETING' ? 'multi_meeting' :
            decisionLayerResult.intent === 'PRODUCT_KNOWLEDGE' ? 'product_knowledge' :
              decisionLayerResult.intent === 'EXTERNAL_RESEARCH' ? 'external_research' : 'single_meeting';
          generatePersonalizedProgressMessage(text, intentType as ProgressIntentType).then(async (personalizedProgress) => {
            if (!canPostProgress()) return;
            try {
              if (responseSent) return;
              const { updateSlackMessage } = await import("./slackApi");
              await updateSlackMessage({
                channel,
                ts: placeholderMsg.ts,
                text: personalizedProgress,
              });
              console.log(`[Slack] Updated doc placeholder with progress: "${personalizedProgress.substring(0, 50)}..."`);
            } catch (err) {
              console.error(`[Slack] Failed to update doc placeholder with progress:`, err);
            }
          }).catch(() => { });
        }

        logger.startStage('open_assistant');
        openAssistantResultData = await handleOpenAssistant(text, {
          userId: userId || undefined,
          threadId: threadTs,
          conversationContext: companyMentioned ? `Company: ${companyMentioned.companyName}` :
            resolvedMeeting ? `Company: ${resolvedMeeting.companyName}` : undefined,
          threadMessages: threadContextForCP?.messages,
          resolvedMeeting: resolvedMeeting ? {
            meetingId: resolvedMeeting.meetingId,
            companyId: resolvedMeeting.companyId,
            companyName: resolvedMeeting.companyName,
            meetingDate: resolvedMeeting.meetingDate,
          } : null,
          decisionLayerResult: decisionLayerResult,
          slackStreaming: streamingContext,
        });
        oaDuration = logger.endStage('open_assistant');

        responseText = openAssistantResultData.answer;
        if (decisionLayerResult.scopeNote) {
          responseText = `${decisionLayerResult.scopeNote}\n\n${responseText}`;
        }
        capabilityName = `open_assistant_${openAssistantResultData.intent}`;
        intentClassification = openAssistantResultData.intent;
        dataSource = openAssistantResultData.dataSource;

        if (openAssistantResultData.singleMeetingResult) {
          resolvedCompanyId = resolvedMeeting?.companyId || null;
          resolvedMeetingId = resolvedMeeting?.meetingId || null;
          semanticAnswerUsed = openAssistantResultData.singleMeetingResult.semanticAnswerUsed;
          semanticConfidence = openAssistantResultData.singleMeetingResult.semanticConfidence;
        }

        // Skip operation-specific progress messages when streaming was used
        // Streaming provides real-time feedback via the placeholder, so no extra progress needed
        // Posting progress AFTER response completes creates confusing message order
        if (streamingContext) {
          console.log(`[Slack] Skipping operation-specific progress (streaming was used)`);
        } else {
          // Only send progress for non-streaming paths (document generation, etc.)
          // Use canPostProgress() coordination to prevent race conditions
          const progressMessage = openAssistantResultData.progressMessage ||
            openAssistantResultData.singleMeetingResult?.progressMessage;
          if (progressMessage && !testRun && canPostProgress()) {
            console.log(`[Slack] Sending operation-specific progress message: "${progressMessage.substring(0, 50)}..."`);
            await postSlackMessage({
              channel,
              text: progressMessage,
              thread_ts: threadTs,
            });
            progressMessageCount++;
          } else if (progressMessage && !canPostProgress()) {
            console.log(`[Slack] Skipping operation-specific progress (response already sent)`);
          }
        }

        logger.info('Open Assistant response generated', {
          intent: openAssistantResultData.intent,
          contract: openAssistantResultData.answerContract,
          delegated: openAssistantResultData.delegatedToSingleMeeting,
          duration_ms: oaDuration,
        });
        console.log(`[Slack] Open Assistant response: intent=${openAssistantResultData.intent}, decisionLayer=${openAssistantResultData.decisionLayerIntent || 'none'}, contract=${openAssistantResultData.answerContract || 'none'}, delegated=${openAssistantResultData.delegatedToSingleMeeting}`);
      }

      // Clear progress timer now that we have a response ready
      clearProgressTimer();

      // Append source attribution to response for transparency
      const sourceAttribution = getSourceAttribution({
        dataSource,
        semanticAnswerUsed,
        semanticConfidence,
        intent: decisionLayerResult.intent,
        answerContract: openAssistantResultData?.answerContract || decisionLayerResult.answerContract,
        usedSingleMeetingMode,
        isClarificationRequest,
        responseText,
      });
      if (sourceAttribution && responseText) {
        responseText += sourceAttribution;
      }

      // Calculate total pipeline time
      const totalTimeMs = Date.now() - pipelineStartTime;
      console.log(`[Slack] Pipeline completed in ${totalTimeMs}ms, progressMessages=${progressMessageCount}`);

      // Post response to Slack (skip in test mode or if streaming already handled it)
      // For Open Assistant responses, use document support to generate .docx for long content
      let botReply: { ts: string };
      const hasContract = !!openAssistantResultData?.answerContract;
      const willGenerateDoc = hasContract && !usedSingleMeetingMode;
      const usedStreaming = !!streamingContext;
      console.log(`[Slack] Document decision: testRun=${testRun}, contract=${openAssistantResultData?.answerContract || 'NONE'}, streaming=${usedStreaming}, willGenerateDoc=${willGenerateDoc}`);
      if (testRun) {
        botReply = { ts: `test-${Date.now()}` };
      } else if (usedStreaming) {
        // Streaming placeholder was created - check if handler already updated it
        botReply = { ts: streamingContext!.messageTs };

        // Check if handler already completed streaming (set streamingCompleted: true)
        const handlerAlreadyStreamed = openAssistantResultData?.streamingCompleted === true;

        if (handlerAlreadyStreamed) {
          // Handler already updated the message with final content (e.g., streaming OpenAI)
          // Append source attribution if needed (handler didn't include it)
          if (sourceAttribution && responseText) {
            try {
              const { updateSlackMessage: updateMsg } = await import("./slackApi");
              await updateMsg({
                channel: streamingContext!.channel,
                ts: streamingContext!.messageTs,
                text: responseText,
              });
              console.log(`[Slack] Updated streamed message with source attribution`);
            } catch (err) {
              console.error(`[Slack] Failed to append source attribution to streamed message:`, err);
            }
          } else {
            console.log(`[Slack] Handler already streamed to message: ${botReply.ts}`);
          }
        } else if (responseText && responseText !== "...") {
          // Handler returned result but didn't update the placeholder - do it now
          try {
            const { updateSlackMessage } = await import("./slackApi");
            await updateSlackMessage({
              channel: streamingContext!.channel,
              ts: streamingContext!.messageTs,
              text: responseText,
            });
            console.log(`[Slack] Updated streaming placeholder with final content (${responseText.length} chars)`);
          } catch (updateErr) {
            console.error(`[Slack] Failed to update streaming message, posting new:`, updateErr);
            // Fall back to posting a new message if update fails
            const fallbackReply = await postSlackMessage({
              channel,
              text: responseText,
              thread_ts: threadTs,
            });
            botReply = fallbackReply;
          }
        } else {
          console.log(`[Slack] No content to update streaming message: ${botReply.ts}`);
        }

        // Generate document AFTER streaming for ANY response above word threshold
        // Word count check happens in sendResponseWithDocumentSupport
        if (responseText && responseText.length > 200) {
          console.log(`[Slack] Checking if response needs document generation (word count check)`);
          try {
            const { AnswerContract } = await import("../decisionLayer/answerContracts");
            const docResult = await sendResponseWithDocumentSupport({
              channel,
              threadTs,
              content: responseText,
              contract: openAssistantResultData?.answerContract ?? AnswerContract.GENERAL_RESPONSE,
              customerName: resolvedMeeting?.companyName,
              userQuery: text,
              documentOnly: true, // Only generate document, no message
            });

            // If document was generated, update streaming message to show preview + document notice
            if (docResult.type === "document" && docResult.success && botReply.ts) {
              console.log(`[Slack] Document generated - updating streaming message to preview`);
              try {
                const { updateSlackMessage: updateMsg } = await import("./slackApi");
                // Extract first ~300 chars as preview, cutting at sentence/paragraph boundary
                const previewLength = 300;
                let preview = responseText.substring(0, previewLength);
                // Try to cut at a sentence boundary
                const lastPeriod = preview.lastIndexOf('. ');
                const lastNewline = preview.lastIndexOf('\n');
                const cutPoint = Math.max(lastPeriod, lastNewline);
                if (cutPoint > 100) {
                  preview = preview.substring(0, cutPoint + 1);
                }
                await updateMsg({
                  channel,
                  ts: botReply.ts,
                  text: `${preview.trim()}\n\n_Full details in the attached document below._`,
                });
              } catch (updateErr) {
                console.error(`[Slack] Failed to update streaming message after doc:`, updateErr);
              }
            }
            console.log(`[Slack] Document check complete`);
          } catch (docErr) {
            console.error(`[Slack] Failed to generate document:`, docErr);
          }
        }
      } else if (openAssistantResultData?.answerContract && !usedSingleMeetingMode) {
        // Open Assistant responses may generate documents for specific contracts or long content
        // Only reach here if streaming was NOT used (e.g., doc-generating contracts)
        const docResult = await sendResponseWithDocumentSupport({
          channel,
          threadTs,
          content: responseText,
          contract: openAssistantResultData.answerContract,
          customerName: resolvedMeeting?.companyName,
          userQuery: text,
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
              meetingSource: threadContext?.meetingId ? "thread" : (meetingDetection.regexResult || meetingDetection.llmResult ? "explicit" : "last_meeting"),
              isBinaryQuestion,
              semanticAnswerUsed,
              semanticConfidence,
              pendingOffer,
              lastResponseType: dataSource, // Track for follow-up context
              testRun,
              meetingDetection,
            }
          );
        } else {
          // Open Assistant path - use actual Decision Layer results
          const mappedDataSource: DataSource = mapLegacyDataSource(dataSource);

          // Use Decision Layer result directly (full pipeline with intent, contract, layers)
          // OpenAssistant may override contract if it does additional processing
          const actualIntent = decisionLayerResult?.intent || openAssistantResultData?.decisionLayerIntent || "GENERAL_HELP";
          const actualContract = decisionLayerResult?.answerContract || openAssistantResultData?.answerContract || "GENERAL_RESPONSE";
          const actualContractChain = openAssistantResultData?.answerContractChain;
          const actualSsotMode = openAssistantResultData?.ssotMode || "none";

          // Use context layers from Decision Layer result directly
          const contextLayers = (decisionLayerResult?.contextLayers || {
            product_identity: true, // Always on
            product_ssot: actualIntent === "PRODUCT_KNOWLEDGE",
            single_meeting: actualIntent === "SINGLE_MEETING",
            multi_meeting: actualIntent === "MULTI_MEETING",
          }) as any;

          // Store proposedInterpretation for CLARIFY follow-ups
          if (actualIntent === "CLARIFY" && decisionLayerResult?.proposedInterpretation) {
            contextLayers.proposedInterpretation = decisionLayerResult.proposedInterpretation;
            contextLayers.awaitingClarification = "proposed_interpretation";
          }

          return buildInteractionMetadata(
            { companyId: resolvedCompanyId || undefined, meetingId: resolvedMeetingId },
            {
              entryPoint: "slack",
              decisionLayer: {
                intent: actualIntent as any,
                intentDetectionMethod: (decisionLayerResult?.intentDetectionMethod as "keyword" | "pattern" | "entity" | "llm" | "default") || "keyword",
                contextLayers,
                answerContract: actualContract as any,
                contractChain: actualContractChain?.map((c: any) => ({
                  contract: String(c),
                  ssot_mode: actualSsotMode as any,
                  selection_method: "default" as const
                })),
                contractSelectionMethod: (decisionLayerResult?.contractSelectionMethod as "keyword" | "llm" | "default") || "default",
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
              lastResponseType: dataSource, // Track for follow-up context
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
        intent: decisionLayerResult?.intent,
        contract: decisionLayerResult?.answerContract,
        responseLength: responseText?.length,
        totalTimeMs,
        stages: {
          meeting_resolution: mrDuration,
          decision_layer: cpDuration,
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
      clearProgressTimer();

      const classified = classifyPipelineError(err);

      console.error(`[PIPELINE ERROR] ${classified.type}:`, classified.errorMessage, classified.stack);
      logger.error('Pipeline error', err, {
        errorType: classified.type,
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
        stack: classified.stack,
        text: text.substring(0, 100),
      });

      if (!testRun) {
        await postSlackMessage({
          channel,
          text: classified.userMessage,
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
