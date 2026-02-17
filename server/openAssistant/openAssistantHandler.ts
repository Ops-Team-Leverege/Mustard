/**
 * Open Assistant Handler - Thin Orchestration Layer
 * 
 * Purpose:
 * Wires together the focused modules to handle Open Assistant requests.
 * This layer is intentionally thin - all complex logic lives in:
 * - meetingResolver.ts: Meeting lookup and scope resolution
 * - contractExecutor.ts: Contract chain execution and evidence enforcement
 * - types.ts: Shared type definitions
 * 
 * Key Principles:
 * - Decision Layer is the SOLE authority for intent classification
 * - This handler routes based on Decision Layer decisions, never reclassifies
 * - Execution Layer is deterministic and follows contracts verbatim
 */

import { OpenAI } from "openai";
import { performExternalResearch, formatCitationsForDisplay, type ResearchResult } from "./externalResearch";
import { executeSingleMeetingContract, type SingleMeetingContext, type SingleMeetingResult } from "./singleMeeting";
import { SlackSearchHandler } from "./slackSearchHandler";
import { Intent, type IntentClassificationResult } from "../decisionLayer/intent";
import { AnswerContract, type SSOTMode } from "../decisionLayer/answerContracts";
import { MODEL_ASSIGNMENTS, getModelDescription, TOKEN_LIMITS } from "../config/models";
import { TIMEOUT_CONSTANTS, CONTENT_LIMITS } from "../config/constants";
import { isCapabilityQuestion, getCapabilitiesPrompt, AMBIENT_PRODUCT_CONTEXT } from "../config/prompts/system";
import { buildGeneralAssistancePrompt, buildProductKnowledgePrompt } from "../config/prompts/generalHelp";

import {
  type EvidenceSource,
  type IntentClassification,
  type OpenAssistantContext,
  type OpenAssistantResult,
  type SlackStreamingContext,
  defaultClassification,
  deriveEvidenceSource
} from "./types";
import { streamOpenAIResponse } from "./streamingHelper";
import { findRelevantMeetings, searchAcrossMeetings, type ScopeOverride } from "./meetingResolver";
import { executeContractChain } from "./contractExecutor";
import { executeChainContinuation } from "./chainContinuation";
import { getComprehensiveProductKnowledge, formatProductKnowledgeForPrompt, getProductKnowledgePrompt } from "../airtable/productData";
import { getMeetingNotFoundMessage } from "../utils/notFoundMessages";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage";

export type { EvidenceSource, IntentClassification, OpenAssistantContext, OpenAssistantResult };

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[OpenAssistant] GEMINI_API_KEY not configured");
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

function getClaudeClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[OpenAssistant] ANTHROPIC_API_KEY not configured");
    return null;
  }
  return new Anthropic({ apiKey });
}

/**
 * Allowlist of domains we're allowed to fetch for website analysis.
 * This is the most secure approach - only fetch from known, trusted domains.
 */
const ALLOWED_DOMAINS = [
  'leverege.com',
  'www.leverege.com',
  // Add more trusted domains as needed
];

/**
 * Build thread context section for LLM prompts
 * Provides conversation history for context-aware responses
 */
function buildThreadContextSection(context: OpenAssistantContext): string {
  if (!context.threadMessages || context.threadMessages.length === 0) {
    return '';
  }

  const messages = context.threadMessages.map(msg => {
    const speaker = msg.isBot ? 'PitCrew Sauce' : 'User';
    return `${speaker}: ${msg.text}`;
  }).join('\n');

  return `
## Previous Conversation in This Thread
${messages}

Use this conversation context to provide relevant, continuous responses. Reference specific details mentioned earlier when applicable.
`;
}

/**
 * Build meeting context section for product knowledge queries.
 * When a product question is asked in a meeting thread, this fetches
 * customer questions/concerns from that meeting to provide context.
 * 
 * This enables responses like:
 * "The customer asked about X. PitCrew does support this - here's how it works..."
 */
async function buildMeetingContextForProductKnowledge(
  meetingId: string,
  companyName: string
): Promise<string> {
  try {
    const qaPairs = await storage.getQAPairsByTranscriptId(meetingId);

    if (!qaPairs || qaPairs.length === 0) {
      return "";
    }

    const questionsSection = qaPairs
      .slice(0, 10)
      .map((q, i) => `${i + 1}. "${q.question}"${q.asker ? ` (asked by ${q.asker})` : ""}${q.answer ? `\n   Answer: ${q.answer}` : ""}`)
      .join("\n");

    return `
=== MEETING CONTEXT (from ${companyName} meeting) ===
The user is asking about a topic that may relate to questions raised in this meeting.
Use this context to provide answers that directly address customer concerns.

CUSTOMER QUESTIONS FROM THIS MEETING:
${questionsSection}

When answering:
1. If the user's question relates to a customer concern above, acknowledge it
2. Explain how PitCrew addresses that specific concern
3. Provide actionable information they can share with the customer
`.trim();
  } catch (err) {
    console.error(`[OpenAssistant] Failed to build meeting context:`, err);
    return "";
  }
}

/**
 * Generate a personalized progress message using a quick LLM call.
 * Uses gpt-4o-mini for speed - this should complete in <1 second.
 * Falls back to a default message if LLM fails.
 */
async function generatePersonalizedProgress(
  userMessage: string,
  intentType: 'product' | 'research' | 'draft_email' | 'draft_response' | 'multi_meeting' | 'general',
  includeCapabilityTip: boolean = true
): Promise<string> {
  // Use the centralized progress message generator from progressMessages.ts
  const { generatePersonalizedProgressMessage } = await import("../slack/progressMessages");
  return generatePersonalizedProgressMessage(userMessage, intentType, includeCapabilityTip);
}

/**
 * Generate a user-friendly progress message for contract chains.
 * Only generates a message when there are multiple contracts to execute.
 * 
 * Length limit: 200 chars to keep messages concise in Slack.
 */
const MAX_PROGRESS_MESSAGE_LENGTH = 200;

function generateContractChainProgress(
  contracts: AnswerContract[],
  contextHint?: string
): string | undefined {
  if (contracts.length <= 1) {
    return undefined;
  }

  // Map contracts to user-friendly descriptions (short versions for length control)
  const contractDescriptions: Record<AnswerContract, string> = {
    [AnswerContract.MEETING_SUMMARY]: "summarizing",
    [AnswerContract.NEXT_STEPS]: "extracting action items",
    [AnswerContract.ATTENDEES]: "identifying attendees",
    [AnswerContract.CUSTOMER_QUESTIONS]: "finding questions",
    [AnswerContract.EXTRACTIVE_FACT]: "extracting facts",
    [AnswerContract.AGGREGATIVE_LIST]: "compiling",
    [AnswerContract.PATTERN_ANALYSIS]: "analyzing patterns",
    [AnswerContract.COMPARISON]: "comparing",
    [AnswerContract.TREND_SUMMARY]: "identifying trends",
    [AnswerContract.CROSS_MEETING_QUESTIONS]: "gathering questions",
    [AnswerContract.PRODUCT_EXPLANATION]: "explaining details",
    [AnswerContract.VALUE_PROPOSITION]: "crafting value props",
    [AnswerContract.DRAFT_RESPONSE]: "drafting response",
    [AnswerContract.DRAFT_EMAIL]: "drafting email",
    [AnswerContract.FEATURE_VERIFICATION]: "verifying features",
    [AnswerContract.FAQ_ANSWER]: "answering from FAQs",
    [AnswerContract.PRODUCT_KNOWLEDGE]: "gathering product info",
    [AnswerContract.PRODUCT_INFO]: "retrieving info",
    [AnswerContract.EXTERNAL_RESEARCH]: "researching",
    [AnswerContract.SALES_DOCS_PREP]: "preparing materials",
    [AnswerContract.SLACK_MESSAGE_SEARCH]: "searching Slack",
    [AnswerContract.SLACK_CHANNEL_INFO]: "checking channels",
    [AnswerContract.GENERAL_RESPONSE]: "preparing response",
    [AnswerContract.NOT_FOUND]: "searching",
    [AnswerContract.REFUSE]: "reviewing",
    [AnswerContract.CLARIFY]: "understanding",
  };

  const steps = contracts.map(c => contractDescriptions[c] || c.toLowerCase().replace(/_/g, ' '));

  // Build a natural-sounding progress message
  let message: string;
  if (steps.length === 2) {
    message = `This will take a moment—I'll be ${steps[0]}, then ${steps[1]}.`;
  } else if (steps.length === 3) {
    message = `This will take a moment—I'll be ${steps[0]}, ${steps[1]}, then ${steps[2]}.`;
  } else {
    // For 4+ steps, only show first 3 and indicate there's more
    message = `This will take a moment—I'll be ${steps[0]}, ${steps[1]}, ${steps[2]}, and more.`;
  }

  // Enforce length limit
  if (message.length > MAX_PROGRESS_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_PROGRESS_MESSAGE_LENGTH - 3) + '...';
  }

  return message;
}

/**
 * Validate URL for safety (SSRF protection)
 * Uses strict domain allowlist to prevent SSRF attacks.
 */
function isUrlSafe(urlString: string): { safe: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    // Must be HTTPS only (no HTTP in production)
    if (url.protocol !== 'https:') {
      return { safe: false, error: 'Only HTTPS URLs are supported for security' };
    }

    // Strict domain allowlist - most secure approach
    const hostname = url.hostname.toLowerCase();
    const isAllowed = ALLOWED_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );

    if (!isAllowed) {
      console.log(`[OpenAssistant] Domain not in allowlist: ${hostname}`);
      return {
        safe: false,
        error: `Domain "${hostname}" is not in the allowed list. I can only fetch content from trusted domains (${ALLOWED_DOMAINS.join(', ')}). Please provide product knowledge from the database instead, or ask an admin to add this domain to the allowlist.`
      };
    }

    // Additional sanity checks
    if (url.username || url.password) {
      return { safe: false, error: 'URLs with credentials are not allowed' };
    }

    if (url.port && url.port !== '443') {
      return { safe: false, error: 'Only standard HTTPS port (443) is allowed' };
    }

    return { safe: true };
  } catch {
    return { safe: false, error: 'Invalid URL format' };
  }
}

/**
 * Server-side fetch of website content.
 * Fetches the URL and extracts text content for analysis.
 * Includes SSRF protection and content validation.
 */
async function fetchWebsiteContent(url: string): Promise<{ success: boolean; content?: string; error?: string; isProductOnly?: boolean }> {
  // SSRF protection: validate URL before fetching
  const urlCheck = isUrlSafe(url);
  if (!urlCheck.safe) {
    console.log(`[OpenAssistant] URL validation failed: ${urlCheck.error}`);
    return { success: false, error: urlCheck.error, isProductOnly: true };
  }

  try {
    console.log(`[OpenAssistant] Fetching website content: ${url}`);

    // First try with manual redirect handling (allow one redirect within allowed domains)
    let response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PitCrewBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual', // Handle redirects manually for safety
      signal: AbortSignal.timeout(TIMEOUT_CONSTANTS.WEBSITE_FETCH_MS),
    });

    // Handle redirects safely - only follow if redirect stays on allowed domain
    if (response.status >= 300 && response.status < 400) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        const absoluteRedirect = new URL(redirectUrl, url).toString();
        console.log(`[OpenAssistant] Redirect to: ${absoluteRedirect}`);

        // Validate redirect URL is also safe
        const redirectCheck = isUrlSafe(absoluteRedirect);
        if (!redirectCheck.safe) {
          return { success: false, error: `Redirect to blocked domain: ${absoluteRedirect}`, isProductOnly: true };
        }

        // Follow the safe redirect
        response = await fetch(absoluteRedirect, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PitCrewBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'error', // No more redirects after first
          signal: AbortSignal.timeout(10000),
        });
      }
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}`, isProductOnly: true };
    }

    const html = await response.text();

    // Extract text content from HTML (basic extraction)
    // Remove script and style tags first
    let textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n') // Replace tags with newlines
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\n\s*\n/g, '\n') // Collapse multiple newlines
      .trim();

    // Validate content is meaningful (not empty/too short)
    // Lower threshold to 20 words to handle short FAQ pages
    const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 20) {
      console.log(`[OpenAssistant] Content too sparse: ${wordCount} words (may be JS-rendered site)`);
      return {
        success: false,
        error: `Website returned very little text content (${wordCount} words). This may be a JavaScript-rendered site that requires browser execution to display content.`,
        isProductOnly: true
      };
    }

    // Truncate if too long
    if (textContent.length > CONTENT_LIMITS.WEBSITE_CONTENT_MAX_CHARS) {
      textContent = textContent.substring(0, CONTENT_LIMITS.WEBSITE_CONTENT_MAX_CHARS) + '\n\n[Content truncated...]';
    }

    console.log(`[OpenAssistant] Fetched website content: ${textContent.length} chars, ${wordCount} words`);
    return { success: true, content: textContent, isProductOnly: false };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[OpenAssistant] Website fetch error:`, errorMessage);
    return { success: false, error: errorMessage, isProductOnly: true };
  }
}

/**
 * Use Gemini to analyze website content against product knowledge.
 * Two-step process:
 * 1. Server-side fetch of website content (deterministic)
 * 2. Gemini analysis comparing fetched content vs product knowledge
 */
async function analyzeWebsiteWithGemini(
  websiteUrl: string,
  userMessage: string,
  productDataPrompt: string
): Promise<string | null> {
  const gemini = getGeminiClient();
  if (!gemini) {
    return null;
  }

  // STEP 1: Server-side fetch of website content
  console.log(`[OpenAssistant] Step 1: Server-side fetch of website content`);
  const fetchResult = await fetchWebsiteContent(websiteUrl);

  if (!fetchResult.success || !fetchResult.content) {
    console.log(`[OpenAssistant] Website fetch failed: ${fetchResult.error}`);
    // Return a clear error message explaining the limitation
    return `**Unable to Access Live Website**

I attempted to fetch the content from ${websiteUrl} but encountered an error: ${fetchResult.error}

**What I Can Do Instead:**

Since I cannot access the live website, I can only provide information from the **Product Knowledge Database (Airtable)**. This represents what *should* be on the website according to your product documentation, but I cannot verify what's *actually* there.

**Product Knowledge (from Airtable):**
${productDataPrompt.substring(0, 2000)}${productDataPrompt.length > 2000 ? '\n\n[Additional product data available...]' : ''}

**Recommended Next Steps:**
1. Manually check the live website at ${websiteUrl}
2. Compare what you see with the product knowledge above
3. Or try again later if the website is temporarily unavailable`;
  }

  console.log(`[OpenAssistant] Step 1 complete: Fetched ${fetchResult.content.length} chars from live site`);

  // STEP 2: Use Gemini to analyze the fetched content vs product knowledge
  console.log(`[OpenAssistant] Step 2: Gemini analysis of fetched content vs product knowledge`);

  try {
    const response = await gemini.models.generateContent({
      model: MODEL_ASSIGNMENTS.WEBSITE_ANALYSIS,
      contents: `You are helping analyze website content against authoritative product knowledge.

USER REQUEST: ${userMessage}

=== LIVE WEBSITE CONTENT (fetched from ${websiteUrl}) ===
${fetchResult.content}

=== AUTHORITATIVE PRODUCT KNOWLEDGE (from Airtable) ===
${productDataPrompt}

TASK:
Think step by step. Compare the LIVE WEBSITE CONTENT above with the AUTHORITATIVE PRODUCT KNOWLEDGE.
The website content was fetched by our server - this is the ACTUAL content currently on the live site.

First, identify what content exists in each source. Then, systematically compare them to find gaps and discrepancies.

OUTPUT FORMAT:

**Currently on the Live Website (${websiteUrl}):**
[List the actual items/content from the fetched website - be specific with exact text/questions you see above]

**In Product Knowledge (Airtable):**
[List the relevant items from the product knowledge database]

**Gap Analysis:**
| Content | On Live Site? | In Product Knowledge? | Action Needed |
|---------|---------------|----------------------|---------------|
[Compare each item and indicate what matches, what's missing, what's outdated]

**Recommendations:**
[Based on the gap analysis, provide specific recommendations]

CRITICAL RULES:
- The "LIVE WEBSITE CONTENT" above IS the actual website content - use it directly
- Quote exact text from the website content when identifying what's on the live site
- Clearly distinguish between items that exist on the live site vs only in product knowledge`,
    });

    const content = response.text;
    if (!content) {
      console.log(`[OpenAssistant] Empty response from Gemini`);
      return null;
    }

    console.log(`[OpenAssistant] Gemini analysis complete: ${content.length} chars`);
    return content;
  } catch (error) {
    console.error("[OpenAssistant] Gemini website analysis error:", error);
    return null;
  }
}

/**
 * Helper function to get product knowledge response
 * Uses streaming when Slack context is provided for better perceived latency.
 */
async function getProductKnowledgeResponse(
  userMessage: string,
  productDataPrompt: string,
  hasProductData: boolean,
  streamingContext?: SlackStreamingContext,
  threadContext?: string
): Promise<string> {
  const systemPrompt = buildProductKnowledgePrompt({
    productDataPrompt,
    hasProductData,
    threadContext,
  });

  try {
    const startTime = Date.now();
    console.log(`[OpenAssistant] Calling ${getModelDescription(MODEL_ASSIGNMENTS.PRODUCT_KNOWLEDGE_RESPONSE)} for product knowledge response (prompt: ${systemPrompt.length} chars, streaming: ${!!streamingContext})...`);

    // Use streaming when Slack context is available
    const answer = await streamOpenAIResponse(
      MODEL_ASSIGNMENTS.PRODUCT_KNOWLEDGE_RESPONSE,
      systemPrompt,
      userMessage,
      streamingContext
    );

    console.log(`[OpenAssistant] ${getModelDescription(MODEL_ASSIGNMENTS.PRODUCT_KNOWLEDGE_RESPONSE)} response received in ${Date.now() - startTime}ms (${answer.length} chars)`);
    return answer || "I'd be happy to help with product information. Could you be more specific about what you'd like to know?";
  } catch (openaiError) {
    console.error(`[OpenAssistant] PRODUCT_KNOWLEDGE OpenAI error:`, openaiError);
    throw new Error(`OpenAI API error in product knowledge: ${openaiError instanceof Error ? openaiError.message : String(openaiError)}`);
  }
}

/**
 * HARDENING: Patterns that indicate the user would benefit from factual evidence.
 */
const NEEDS_FACTUAL_EVIDENCE_PATTERNS = [
  /what (?:did|was) (?:discussed|said|agreed|mentioned)/i,
  /(?:from|in|during) (?:the|my|our) (?:meeting|call|demo)/i,
  /(?:customer|client) (?:said|asked|mentioned|wanted)/i,
  /(?:action items?|next steps?|commitments?) from/i,
  /(?:does|can|will) pitcrew (?:integrate|support|have|include|work with)/i,
  /(?:what|how much) (?:does|is) (?:the )?(?:pricing|cost|price)/i,
  /(?:available|included) (?:in|on|for) (?:the )?(?:pro|advanced|enterprise)/i,
];

function wouldBenefitFromEvidence(message: string): { needsEvidence: boolean; reason?: string } {
  const lower = message.toLowerCase();
  for (const pattern of NEEDS_FACTUAL_EVIDENCE_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        needsEvidence: true,
        reason: "This question appears to ask about specific meeting outcomes or product capabilities."
      };
    }
  }
  return { needsEvidence: false };
}

/**
 * Main entry point for Open Assistant.
 * 
 * Called from Slack events handler after initial processing.
 * Routes to appropriate handler based on Decision Layer intent.
 */
export async function handleOpenAssistant(
  userMessage: string,
  context: OpenAssistantContext
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Processing: "${userMessage}"`);

  if (context.decisionLayerResult) {
    const cpResult = context.decisionLayerResult;
    console.log(`[OpenAssistant] Using full Decision Layer result: intent=${cpResult.intent}, contract=${cpResult.answerContract}, method=${cpResult.intentDetectionMethod}`);

    if (cpResult.intent === Intent.REFUSE) {
      return {
        answer: "I'm sorry, but that question is outside of what I can help with. I'm designed to assist with PitCrew-related topics, customer meetings, and product information.",
        intent: "general_assistance",
        intentClassification: defaultClassification("Refused by Decision Layer"),
        decisionLayerIntent: cpResult.intent,
        answerContract: cpResult.answerContract,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }

    if (cpResult.intent === Intent.CLARIFY) {
      // Check if the contract suggests meeting data is needed - if so, attempt meeting search
      // instead of immediately returning clarification
      // Meeting-related contracts - attempt search instead of clarifying
      const meetingRelatedContracts = [
        AnswerContract.MEETING_SUMMARY,
        AnswerContract.EXTRACTIVE_FACT,
        AnswerContract.AGGREGATIVE_LIST,
        AnswerContract.NEXT_STEPS,
        AnswerContract.ATTENDEES,
        AnswerContract.CUSTOMER_QUESTIONS,
        AnswerContract.CROSS_MEETING_QUESTIONS,
      ];

      // General/creative contracts that should execute without clarifying
      const executeWithoutClarifyContracts = [
        AnswerContract.DRAFT_EMAIL,
        AnswerContract.DRAFT_RESPONSE,
        AnswerContract.GENERAL_RESPONSE,
      ];

      if (meetingRelatedContracts.includes(cpResult.answerContract)) {
        console.log(`[OpenAssistant] CLARIFY intent but meeting-related contract (${cpResult.answerContract}) - attempting meeting search`);
        const classification = defaultClassification("Clarification with meeting-related contract - attempting search");
        return handleMeetingDataIntent(userMessage, context, classification, cpResult.answerContract);
      }

      if (executeWithoutClarifyContracts.includes(cpResult.answerContract)) {
        console.log(`[OpenAssistant] CLARIFY intent but execute-without-clarify contract (${cpResult.answerContract}) - routing to general assistance`);
        const classification = defaultClassification("Clarification with general contract - executing directly");
        return handleGeneralAssistanceIntent(userMessage, context, classification, cpResult.answerContract);
      }

      // Use the smart clarification message from Decision Layer (or fallback to friendly message)
      const clarifyMessage = cpResult.clarifyMessage || `I want to help but I'm not sure what you're looking for. Are you asking about:

• A customer meeting (which company?)
• PitCrew product info (which feature?)
• Help with a task (what kind?)

Give me a hint and I'll get you sorted!`;

      return {
        answer: clarifyMessage,
        intent: "general_assistance",
        intentClassification: defaultClassification("Clarification required by Decision Layer"),
        decisionLayerIntent: cpResult.intent,
        answerContract: cpResult.answerContract,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }

    const evidenceSource = deriveEvidenceSource(cpResult.intent);
    const classification: IntentClassification = {
      intent: evidenceSource,
      confidence: "high",
      rationale: `Derived from Decision Layer: ${cpResult.intent} -> ${cpResult.answerContract}`,
      meetingRelevance: {
        referencesSpecificInteraction: cpResult.intent === Intent.SINGLE_MEETING,
        asksWhatWasSaidOrAgreed: false,
        asksAboutCustomerQuestions: false,
      },
      researchRelevance: {
        needsPublicInfo: false,
        companyOrEntityMentioned: null,
        topicForResearch: null,
      },
    };

    console.log(`[OpenAssistant] Evidence source: ${evidenceSource} (from Decision Layer: ${cpResult.intent} -> ${cpResult.answerContract})`);

    if (cpResult.intent === Intent.SINGLE_MEETING) {
      return handleMeetingDataIntent(userMessage, context, classification, cpResult.answerContract, cpResult.contractChain);
    }

    if (cpResult.intent === Intent.MULTI_MEETING) {
      return handleMultiMeetingIntent(userMessage, context, classification, cpResult.answerContract, cpResult.contractChain);
    }

    if (cpResult.intent === Intent.PRODUCT_KNOWLEDGE) {
      return handleProductKnowledgeIntent(userMessage, context, classification, cpResult.answerContract, cpResult.contractChain);
    }

    if (cpResult.intent === Intent.EXTERNAL_RESEARCH) {
      return handleExternalResearchIntent(userMessage, context, classification, cpResult.answerContract, cpResult.contractChain);
    }

    if (cpResult.intent === Intent.SLACK_SEARCH) {
      return handleSlackSearchIntent(userMessage, context, classification, cpResult.answerContract);
    }

    return handleGeneralAssistanceIntent(userMessage, context, classification, cpResult.answerContract, cpResult.contractChain);
  }

  // DECISION LAYER REQUIRED: No fallback to separate classifier
  console.log(`[OpenAssistant] WARNING: No Decision Layer intent provided, defaulting to CLARIFY`);
  const fallbackClassification = defaultClassification("No Decision Layer intent provided - clarification needed");

  return {
    answer: "I need a bit more context to help you effectively. Could you tell me more about what you're looking for?",
    intent: "general_assistance",
    intentClassification: fallbackClassification,
    decisionLayerIntent: Intent.CLARIFY,
    answerContract: AnswerContract.CLARIFY,
    dataSource: "clarification",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle SINGLE_MEETING intent by delegating to SingleMeetingOrchestrator.
 */
async function handleMeetingDataIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract,
  dlContractChain?: AnswerContract[]
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to meeting data path${contract ? ` (CP contract: ${contract})` : ''}${dlContractChain ? ` (chain: [${dlContractChain.join(" → ")}])` : ''}`);

  if (context.resolvedMeeting) {
    const scope = {
      meetingId: context.resolvedMeeting.meetingId,
      companyId: context.resolvedMeeting.companyId,
      companyName: context.resolvedMeeting.companyName,
    };

    // USE DECISION LAYER CONTRACT (Decision Layer is sole authority)
    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];

    if (dlContractChain && dlContractChain.length > 0) {
      // Decision Layer provided a contract chain - use it directly
      primaryContract = dlContractChain[0];
      contractChain = dlContractChain;
      console.log(`[OpenAssistant] Using DL-provided chain: [${dlContractChain.join(" → ")}]`);
    } else if (contract) {
      // Decision Layer provided a single contract - wrap it
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using DL-provided contract: ${contract}`);
    } else {
      // This should never happen - Decision Layer always provides a contract
      throw new Error('[OpenAssistant] Decision Layer must provide answerContract');
    }

    const chainProgress = generateContractChainProgress(contractChain);

    const singleMeetingResult = await executeSingleMeetingContract(
      context.resolvedMeeting,
      userMessage,
      primaryContract,
      context.decisionLayerResult?.requiresSemantic
    );

    let finalAnswer = singleMeetingResult.answer;
    if (contractChain.length > 1) {
      const continuation = await executeChainContinuation({
        userMessage,
        primaryOutput: singleMeetingResult.answer,
        remainingContracts: contractChain.slice(1),
        meetingContext: {
          companyName: context.resolvedMeeting.companyName,
          meetingDate: context.resolvedMeeting.meetingDate,
        },
      });
      finalAnswer = continuation.finalOutput;
    }

    return {
      answer: finalAnswer,
      intent: "meeting_data",
      intentClassification: classification,
      decisionLayerIntent: Intent.SINGLE_MEETING,
      answerContract: primaryContract,
      answerContractChain: contractChain,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
      progressMessage: chainProgress || singleMeetingResult.progressMessage,
    };
  }

  console.log(`[OpenAssistant] No meeting resolved, searching for relevant meetings`);

  // Pass LLM-determined scope from Decision Layer (if available)
  const scopeOverride: ScopeOverride | undefined = context.decisionLayerResult?.scope;
  const meetingSearch = await findRelevantMeetings(userMessage, classification, scopeOverride, context.conversationContext);

  if (meetingSearch.meetings.length === 0) {
    const extractedCompany = context.decisionLayerResult?.extractedCompany || null;
    console.log(`[OpenAssistant] Scope resolution failed: SINGLE_MEETING intent, searched for: "${meetingSearch.searchedFor || 'nothing specific'}", extractedCompany: "${extractedCompany || 'none'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria)`);
    return {
      answer: getMeetingNotFoundMessage({ extractedCompany, searchedFor: meetingSearch.searchedFor, scope: "single" }),
      intent: "meeting_data",
      intentClassification: classification,
      decisionLayerIntent: Intent.CLARIFY,
      answerContract: AnswerContract.CLARIFY,
      ssotMode: "none" as SSOTMode,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }

  if (meetingSearch.meetings.length === 1) {
    const meeting = meetingSearch.meetings[0];
    console.log(`[OpenAssistant] Found single meeting: ${meeting.companyName} (${meeting.meetingId})`);

    const scope = {
      meetingId: meeting.meetingId,
      companyId: meeting.companyId,
      companyName: meeting.companyName,
    };

    // USE DECISION LAYER CONTRACT when provided (Decision Layer is sole authority)
    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];

    if (dlContractChain && dlContractChain.length > 0) {
      primaryContract = dlContractChain[0];
      contractChain = dlContractChain;
      console.log(`[OpenAssistant] Using DL-provided chain: [${dlContractChain.join(" → ")}]`);
    } else if (contract) {
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using DL-provided contract: ${contract}`);
    } else {
      throw new Error('[OpenAssistant] Decision Layer must provide answerContract');
    }

    const chainProgress = generateContractChainProgress(contractChain);

    const singleMeetingResult = await executeSingleMeetingContract(
      meeting,
      userMessage,
      primaryContract,
      context.decisionLayerResult?.requiresSemantic
    );

    let finalAnswer = singleMeetingResult.answer;
    if (contractChain.length > 1) {
      const continuation = await executeChainContinuation({
        userMessage,
        primaryOutput: singleMeetingResult.answer,
        remainingContracts: contractChain.slice(1),
        meetingContext: {
          companyName: meeting.companyName,
          meetingDate: meeting.meetingDate,
        },
      });
      finalAnswer = continuation.finalOutput;
    }

    return {
      answer: finalAnswer,
      intent: "meeting_data",
      intentClassification: classification,
      decisionLayerIntent: Intent.SINGLE_MEETING,
      answerContract: primaryContract,
      answerContractChain: contractChain,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
      progressMessage: chainProgress || singleMeetingResult.progressMessage,
    };
  }

  // Multiple meetings found - route through MULTI_MEETING path
  console.log(`[OpenAssistant] Found ${meetingSearch.meetings.length} meetings, routing to MULTI_MEETING path`);

  const uniqueCompanies = new Set(meetingSearch.meetings.map(m => m.companyId));
  const scope = {
    type: "multi_meeting" as const,
    meetingIds: meetingSearch.meetings.map(m => m.meetingId),
    filters: meetingSearch.searchedFor ? { topic: meetingSearch.searchedFor } : undefined,
    coverage: {
      totalMeetingsSearched: meetingSearch.meetings.length,
      matchingMeetingsCount: meetingSearch.meetings.length,
      uniqueCompaniesRepresented: uniqueCompanies.size,
    },
  };

  // Use Decision Layer contract (Decision Layer is sole authority)
  let primaryContract: AnswerContract;
  let contractChain: AnswerContract[];

  if (dlContractChain && dlContractChain.length > 0) {
    primaryContract = dlContractChain[0];
    contractChain = dlContractChain;
    console.log(`[OpenAssistant] Using DL-provided chain: [${dlContractChain.join(" → ")}]`);
  } else if (contract) {
    primaryContract = contract;
    contractChain = [contract];
    console.log(`[OpenAssistant] Using DL-provided contract: ${contract}`);
  } else {
    throw new Error('[OpenAssistant] Decision Layer must provide answerContract');
  }

  // Build progress message: multi-meeting context + contract chain steps (if multiple)
  const meetingProgress = `I found ${meetingSearch.meetings.length} meeting${meetingSearch.meetings.length !== 1 ? 's' : ''} across ${uniqueCompanies.size} ${uniqueCompanies.size !== 1 ? 'companies' : 'company'}${meetingSearch.searchedFor ? ` related to "${meetingSearch.searchedFor}"` : ''}.`;
  const chainProgress = generateContractChainProgress(contractChain);
  const progressMessage = chainProgress
    ? `${meetingProgress} ${chainProgress}`
    : `${meetingProgress} I'll analyze them and compile the insights.`;

  const chainResult = await executeContractChain(
    { contracts: contractChain, primaryContract, selectionMethod: "keyword" },
    userMessage,
    meetingSearch.meetings,
    meetingSearch.topic
  );

  return {
    answer: chainResult.finalOutput,
    intent: "meeting_data",
    intentClassification: classification,
    decisionLayerIntent: Intent.MULTI_MEETING,
    answerContract: primaryContract,
    answerContractChain: contractChain,
    ssotMode: "none" as SSOTMode,
    dataSource: "meeting_artifacts",
    artifactMatches: undefined,
    delegatedToSingleMeeting: false,
    progressMessage,
  };
}

/**
 * Handle MULTI_MEETING intent.
 */
async function handleMultiMeetingIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract,
  dlContractChain?: AnswerContract[]
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to MULTI_MEETING path${contract ? ` (CP contract: ${contract})` : ''}${dlContractChain ? ` (chain: [${dlContractChain.join(" → ")}])` : ''}`);

  // Pass LLM-determined scope from Decision Layer (if available)
  const scopeOverride: ScopeOverride | undefined = context.decisionLayerResult?.scope;
  const meetingSearch = await findRelevantMeetings(userMessage, classification, scopeOverride, context.conversationContext);

  if (meetingSearch.meetings.length === 0) {
    const extractedCompany = context.decisionLayerResult?.extractedCompany || null;
    console.log(`[OpenAssistant] Scope resolution failed: MULTI_MEETING intent, searched for: "${meetingSearch.searchedFor || 'all meetings'}", extractedCompany: "${extractedCompany || 'none'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria for cross-meeting analysis)`);
    return {
      answer: getMeetingNotFoundMessage({ extractedCompany, searchedFor: meetingSearch.searchedFor, scope: "multi" }),
      intent: "meeting_data",
      intentClassification: classification,
      decisionLayerIntent: Intent.CLARIFY,
      answerContract: AnswerContract.CLARIFY,
      ssotMode: "none" as SSOTMode,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }

  if (meetingSearch.meetings.length === 1) {
    const meeting = meetingSearch.meetings[0];
    console.log(`[OpenAssistant] MULTI_MEETING found only 1 meeting — delegating to SINGLE_MEETING: ${meeting.companyName} (${meeting.meetingId})`);

    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];

    if (dlContractChain && dlContractChain.length > 0) {
      primaryContract = dlContractChain[0];
      contractChain = dlContractChain;
    } else if (contract) {
      primaryContract = contract;
      contractChain = [contract];
    } else {
      throw new Error('[OpenAssistant] Decision Layer must provide answerContract');
    }

    const chainProgress = generateContractChainProgress(contractChain);

    const singleMeetingResult = await executeSingleMeetingContract(
      meeting,
      userMessage,
      primaryContract,
      context.decisionLayerResult?.requiresSemantic
    );

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      decisionLayerIntent: Intent.SINGLE_MEETING,
      answerContract: primaryContract,
      answerContractChain: contractChain,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
      progressMessage: chainProgress || singleMeetingResult.progressMessage,
    };
  }

  const uniqueCompanies = new Set(meetingSearch.meetings.map(m => m.companyId));
  const scope = {
    type: "multi_meeting" as const,
    meetingIds: meetingSearch.meetings.map(m => m.meetingId),
    filters: meetingSearch.searchedFor ? { topic: meetingSearch.searchedFor } : undefined,
    coverage: {
      totalMeetingsSearched: meetingSearch.meetings.length,
      matchingMeetingsCount: meetingSearch.meetings.length,
      uniqueCompaniesRepresented: uniqueCompanies.size,
    },
  };

  // USE DECISION LAYER CONTRACT when provided (Decision Layer is sole authority)
  let primaryContract: AnswerContract;
  let contractChain: AnswerContract[];

  if (dlContractChain && dlContractChain.length > 0) {
    // Decision Layer provided a contract chain - use it directly
    primaryContract = dlContractChain[0];
    contractChain = dlContractChain;
    console.log(`[OpenAssistant] Using DL-provided chain: [${dlContractChain.join(" → ")}]`);
  } else if (contract) {
    // Decision Layer provided a single contract - wrap it
    primaryContract = contract;
    contractChain = [contract];
    console.log(`[OpenAssistant] Using DL-provided contract: ${contract}`);
  } else {
    // This should never happen - Decision Layer always provides a contract
    throw new Error('[OpenAssistant] Decision Layer must provide answerContract');
  }

  // Build progress message: multi-meeting context + contract chain steps (if multiple)
  const meetingProgress = `I found ${meetingSearch.meetings.length} meeting${meetingSearch.meetings.length !== 1 ? 's' : ''} across ${uniqueCompanies.size} ${uniqueCompanies.size !== 1 ? 'companies' : 'company'}${meetingSearch.searchedFor ? ` related to "${meetingSearch.searchedFor}"` : ''}.`;
  const chainProgress = generateContractChainProgress(contractChain);
  const progressMessage = chainProgress
    ? `${meetingProgress} ${chainProgress}`
    : `${meetingProgress} I'll analyze them and compile the insights.`;

  const chainResult = await executeContractChain(
    { contracts: contractChain, primaryContract, selectionMethod: "keyword" },
    userMessage,
    meetingSearch.meetings,
    meetingSearch.topic
  );

  return {
    answer: chainResult.finalOutput,
    intent: "meeting_data",
    intentClassification: classification,
    decisionLayerIntent: Intent.MULTI_MEETING,
    answerContract: primaryContract,
    answerContractChain: contractChain,
    ssotMode: "none" as SSOTMode,
    dataSource: "meeting_artifacts",
    delegatedToSingleMeeting: false,
    progressMessage,
  };
}

/**
 * Handle PRODUCT_KNOWLEDGE intent.
 * 
 * Fetches REAL product data from Airtable tables (synced to database)
 * and injects it into the prompt for authoritative answers.
 * 
 * If a URL is detected in the message, also fetches that URL's content
 * so GPT can compare/analyze it against the product knowledge.
 */
async function handleProductKnowledgeIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract,
  dlContractChain?: AnswerContract[]
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to product knowledge path${contract ? ` (CP contract: ${contract})` : ''}`);

  const actualContract = contract || AnswerContract.PRODUCT_EXPLANATION;

  // Check for URLs in the message
  let websiteUrl: string | null = null;
  const urlMatch = userMessage.match(/https?:\/\/[\w\-\.]+\.\w+[\w\/\-\.\?\=\&]*/i);
  if (urlMatch) {
    websiteUrl = urlMatch[0];
    console.log(`[OpenAssistant] URL detected in message: ${websiteUrl}`);
  }

  // Check for meeting context - enables meeting-aware product knowledge
  let meetingContextSection = "";
  if (context.resolvedMeeting?.meetingId) {
    console.log(`[OpenAssistant] Meeting context available (${context.resolvedMeeting.meetingId}) - fetching customer concerns...`);
    meetingContextSection = await buildMeetingContextForProductKnowledge(
      context.resolvedMeeting.meetingId,
      context.resolvedMeeting.companyName
    );
    if (meetingContextSection) {
      console.log(`[OpenAssistant] Meeting context enriched (${meetingContextSection.length} chars)`);
    }
  }

  // Get product knowledge from snapshot (fast path) or compute on-demand
  let snapshotResult;
  let productDataPrompt: string;
  let tablesWithData: string[];
  try {
    console.log(`[OpenAssistant] Fetching product knowledge...`);
    snapshotResult = await getProductKnowledgePrompt();
    productDataPrompt = snapshotResult.promptText;
    tablesWithData = snapshotResult.tablesIncluded;
    console.log(`[OpenAssistant] Product knowledge loaded (${snapshotResult.source}): ${snapshotResult.recordCount} records`);
  } catch (dbError) {
    console.error(`[OpenAssistant] PRODUCT_KNOWLEDGE database error:`, dbError);
    throw new Error(`Product knowledge database error: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
  }

  const hasProductData = snapshotResult.recordCount > 0;

  // Generate personalized progress message (runs quickly in parallel conceptually)
  const progressMessage = await generatePersonalizedProgress(userMessage, 'product');

  let answer: string;

  // Build thread context for conversation continuity
  const threadContextSection = buildThreadContextSection(context);

  // Combine thread context with meeting context if available
  const enrichedContext = meetingContextSection
    ? `${threadContextSection}\n\n${meetingContextSection}`
    : threadContextSection;

  // If URL detected + product data available → use Gemini for web-based analysis
  if (websiteUrl && hasProductData) {
    console.log(`[OpenAssistant] URL detected with product data - trying Gemini for website analysis`);
    const geminiResult = await analyzeWebsiteWithGemini(websiteUrl, userMessage, productDataPrompt);

    if (geminiResult) {
      answer = geminiResult;
      console.log(`[OpenAssistant] Gemini analysis successful (${answer.length} chars)`);
    } else {
      // Gemini failed - fall back to gpt-4o without website content
      console.log(`[OpenAssistant] Gemini unavailable - falling back to gpt-4o`);
      answer = await getProductKnowledgeResponse(userMessage, productDataPrompt, hasProductData, context.slackStreaming, enrichedContext);
    }
  } else {
    // No URL - use gpt-4o directly
    answer = await getProductKnowledgeResponse(userMessage, productDataPrompt, hasProductData, context.slackStreaming, enrichedContext);
  }

  const contractChain = dlContractChain && dlContractChain.length > 0 ? dlContractChain : [actualContract];

  let finalAnswer = answer;
  if (contractChain.length > 1) {
    const continuation = await executeChainContinuation({
      userMessage,
      primaryOutput: answer,
      remainingContracts: contractChain.slice(1),
    });
    finalAnswer = continuation.finalOutput;
  }

  return {
    answer: finalAnswer,
    intent: "meeting_data",
    intentClassification: classification,
    decisionLayerIntent: Intent.PRODUCT_KNOWLEDGE,
    answerContract: actualContract,
    answerContractChain: contractChain.length > 1 ? contractChain : undefined,
    ssotMode: hasProductData ? "authoritative" : "descriptive",
    dataSource: "product_ssot",
    delegatedToSingleMeeting: false,
    evidenceSources: hasProductData ? tablesWithData : undefined,
    progressMessage,
    streamingCompleted: !!context.slackStreaming,
  };
}

/**
 * Handle EXTERNAL_RESEARCH intent.
 * Uses Gemini to perform web research on companies/prospects.
 */
async function handleExternalResearchIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract,
  dlContractChain?: AnswerContract[]
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] External research: contract=${contract || 'EXTERNAL_RESEARCH'}${dlContractChain ? `, chain=[${dlContractChain.join(" → ")}]` : ''}`);
  const startTime = Date.now();

  const actualContract = contract || AnswerContract.EXTERNAL_RESEARCH;

  // Use Decision Layer's extracted company (thread-context-aware) with regex fallback
  const companyName = context.decisionLayerResult?.extractedCompany || extractCompanyFromMessage(userMessage);

  console.log(`[OpenAssistant] External research for: ${companyName || 'unknown company'}`);

  const contractChain = dlContractChain && dlContractChain.length > 0 ? dlContractChain : [actualContract];
  const primaryContract = contractChain[0];

  console.log(`[OpenAssistant] Contract chain: [${contractChain.join(" → ")}]`);

  const progressMessage = await generatePersonalizedProgress(userMessage, 'research');

  if (context.slackStreaming && progressMessage) {
    try {
      const { updateSlackMessage } = await import("../slack/slackApi");
      await updateSlackMessage({
        channel: context.slackStreaming.channel,
        ts: context.slackStreaming.messageTs,
        text: progressMessage,
      });
    } catch (updateError) {
      console.error(`[OpenAssistant] Failed to update streaming placeholder with progress:`, updateError);
    }
  }

  const threadContext = buildThreadContextSection(context);

  const researchResult = await performExternalResearch(
    userMessage,
    companyName,
    null,
    threadContext || undefined
  );
  console.log(`[OpenAssistant] Research complete (${Date.now() - startTime}ms), answer length: ${researchResult.answer?.length || 0}`);

  if (!researchResult.answer) {
    return {
      answer: "I wasn't able to complete the research. Please try rephrasing your request or specifying the company name more clearly.",
      intent: "external_research",
      intentClassification: classification,
      decisionLayerIntent: Intent.EXTERNAL_RESEARCH,
      answerContract: AnswerContract.CLARIFY,
      dataSource: "external_research",
      delegatedToSingleMeeting: false,
    };
  }

  const sourcesSection = researchResult.citations.length > 0
    ? formatCitationsForDisplay(researchResult.citations)
    : "";

  let finalAnswer = researchResult.answer;

  if (contractChain.length > 1) {
    const continuation = await executeChainContinuation({
      userMessage,
      primaryOutput: researchResult.answer,
      remainingContracts: contractChain.slice(1),
    });
    finalAnswer = continuation.finalOutput;
  }

  const hasSalesDocsPrep = contractChain.includes(AnswerContract.SALES_DOCS_PREP);

  return {
    answer: finalAnswer + sourcesSection,
    intent: "external_research",
    intentClassification: classification,
    decisionLayerIntent: Intent.EXTERNAL_RESEARCH,
    answerContract: primaryContract,
    answerContractChain: contractChain.length > 1 ? contractChain : undefined,
    dataSource: "external_research",
    delegatedToSingleMeeting: false,
    evidenceSources: researchResult.citations.map(c => c.source),
    progressMessage,
    shouldGenerateDoc: hasSalesDocsPrep,
  };
}

/**
 * Extract feature name from user message for style matching.
 * Looks for patterns like 'feature is called "X"', 'feature named "X"', etc.
 */
function extractFeatureName(message: string): string {
  // Try to find quoted feature name first (most reliable)
  const quotedPatterns = [
    /(?:feature|capability)\s+(?:is\s+)?called\s+[""]([^""]+)[""]/i,
    /(?:feature|capability)\s+(?:is\s+)?named\s+[""]([^""]+)[""]/i,
    /[""]([^""]+)[""]\s+(?:feature|capability)/i,
    /called\s+[""]([^""]+)[""]/i,
  ];

  for (const pattern of quotedPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      console.log(`[OpenAssistant] Extracted feature name from quotes: "${match[1]}"`);
      return match[1].trim();
    }
  }

  // Try unquoted patterns
  const unquotedPatterns = [
    /(?:new\s+)?feature\s+(?:is\s+)?called\s+(\w+(?:\s+\w+){0,3}?)(?:\.|,|\s+that|\s+which|\s+to|\s+do)/i,
    /(?:new\s+)?feature\s+(?:is\s+)?named\s+(\w+(?:\s+\w+){0,3}?)(?:\.|,|\s+that|\s+which|\s+to)/i,
  ];

  for (const pattern of unquotedPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      console.log(`[OpenAssistant] Extracted feature name (unquoted): "${match[1]}"`);
      return match[1].trim();
    }
  }

  // Fallback: include the full context for the LLM to understand
  console.log(`[OpenAssistant] Could not extract feature name, using full message context`);
  // Return a summary of the request for the LLM
  const shortContext = message.length > 200 ? message.substring(0, 200) + "..." : message;
  return `the feature described in this request: "${shortContext}"`;
}

/**
 * Extract company name from user message for research.
 */
function extractCompanyFromMessage(message: string): string | null {
  // Common patterns for company mentions
  const patterns = [
    /research\s+(?:on\s+)?([A-Z][a-zA-Z\s&]+?)(?:\s+and|\s+to|\s+including|$)/i,
    /slide\s+deck\s+for\s+([A-Z][a-zA-Z\s&]+?)(?:\s+to|\s+leadership|$)/i,
    /(?:about|on)\s+([A-Z][a-zA-Z\s&]+?)(?:'s|\s+and|\s+to|$)/i,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:earnings|priorities|strategic)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const company = match[1].trim();
      // Filter out common false positives
      if (!['I', 'We', 'The', 'A', 'An', 'Our', 'Their'].includes(company)) {
        return company;
      }
    }
  }

  return null;
}

/**
 * Unified LLM invocation for GENERAL_HELP with ordered fallback chain.
 * 
 * Tries models in order: Claude Opus → Gemini 3 Pro → OpenAI GPT-4o.
 * All model references come from MODEL_ASSIGNMENTS (no hardcoded strings).
 * Returns consistent metadata regardless of which model responds.
 * 
 * The streamingCompleted flag is set consistently:
 * - Claude/Gemini: false (non-streaming calls, caller handles finalization)
 * - OpenAI: matches whether streaming context was provided
 */
async function callGeneralHelpWithFallback(
  systemPrompt: string,
  userMessage: string,
  slackStreaming: SlackStreamingContext | undefined,
  startTime: number,
): Promise<{ answer: string; streamingCompleted: boolean }> {
  const maxTokens = TOKEN_LIMITS[MODEL_ASSIGNMENTS.GENERAL_HELP_RESPONSE];

  const claude = getClaudeClient();
  if (claude) {
    try {
      console.log(`[GeneralHelp] Calling Claude ${MODEL_ASSIGNMENTS.GENERAL_HELP_RESPONSE} (max tokens: ${maxTokens})...`);
      const response = await claude.messages.create({
        model: MODEL_ASSIGNMENTS.GENERAL_HELP_RESPONSE,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: 0.7,
      });
      const textBlock = response.content.find((block) => block.type === "text");
      const answer = textBlock?.text || "I'd be happy to help. Could you provide more details?";
      console.log(`[GeneralHelp] Claude response in ${Date.now() - startTime}ms (${answer.length} chars)`);
      return { answer, streamingCompleted: false };
    } catch (error) {
      console.error(`[GeneralHelp] Claude failed, trying fallback:`, error instanceof Error ? error.message : error);
    }
  } else {
    console.log(`[GeneralHelp] Claude not configured, trying fallback chain`);
  }

  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const fallbackModel = MODEL_ASSIGNMENTS.GENERAL_HELP_FALLBACK_1;
      console.log(`[GeneralHelp] Trying Gemini ${fallbackModel}...`);
      const response = await gemini.models.generateContent({
        model: fallbackModel,
        contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\nUser: " + userMessage }] }],
        config: { maxOutputTokens: maxTokens, temperature: 0.7 },
      });
      const answer = response.text || "I'd be happy to help. Could you provide more details?";
      console.log(`[GeneralHelp] Gemini fallback response in ${Date.now() - startTime}ms (${answer.length} chars)`);
      return { answer, streamingCompleted: false };
    } catch (geminiError) {
      console.error(`[GeneralHelp] Gemini fallback failed:`, geminiError instanceof Error ? geminiError.message : geminiError);
    }
  }

  const fallbackModel = MODEL_ASSIGNMENTS.GENERAL_HELP_FALLBACK_2;
  console.log(`[GeneralHelp] Final fallback: OpenAI ${fallbackModel}`);
  const answer = await streamOpenAIResponse(
    fallbackModel, systemPrompt, userMessage, slackStreaming
  );
  console.log(`[GeneralHelp] OpenAI fallback response in ${Date.now() - startTime}ms (${answer.length} chars)`);
  return { answer, streamingCompleted: !!slackStreaming };
}

/**
 * Handle GENERAL_HELP intent.
 */
async function handleGeneralAssistanceIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract,
  dlContractChain?: AnswerContract[]
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to general assistance path${contract ? ` (CP contract: ${contract})` : ''}`);

  // Check if user is asking about capabilities - use focused prompt for natural response
  if (isCapabilityQuestion(userMessage)) {
    console.log(`[OpenAssistant] Capability question detected - generating conversational capabilities response`);
    const capabilitiesAnswer = await streamOpenAIResponse(
      MODEL_ASSIGNMENTS.GENERAL_ASSISTANCE,
      getCapabilitiesPrompt(),
      userMessage,
      context.slackStreaming
    );
    return {
      answer: capabilitiesAnswer,
      intent: "general_assistance",
      intentClassification: classification,
      decisionLayerIntent: Intent.GENERAL_HELP,
      answerContract: AnswerContract.GENERAL_RESPONSE,
      dataSource: "general_knowledge",
      isCapabilityResponse: true,
      delegatedToSingleMeeting: false,
      streamingCompleted: !!context.slackStreaming,
    };
  }

  // USE CONTROL PLANE CONTRACT when provided
  const actualContract = contract || AnswerContract.GENERAL_RESPONSE;

  // For drafting emails, we allow thread context to inform the draft
  const isDraftingContract = actualContract === AnswerContract.DRAFT_EMAIL || actualContract === AnswerContract.DRAFT_RESPONSE;

  // Skip evidence check for drafting - we'll use thread context instead
  if (!isDraftingContract) {
    const evidenceCheck = wouldBenefitFromEvidence(userMessage);
    if (evidenceCheck.needsEvidence) {
      console.log(`[OpenAssistant] GENERAL_HELP guardrail triggered: ${evidenceCheck.reason}`);
      return {
        answer: `${evidenceCheck.reason}\n\nTo give you accurate information, could you:\n- For meeting questions: specify which customer or meeting you're asking about\n- For product questions: let me know what specific capability you want to verify\n\nThis helps me provide verified information rather than general guidance.`,
        intent: "general_assistance",
        intentClassification: classification,
        decisionLayerIntent: Intent.CLARIFY,
        answerContract: AnswerContract.CLARIFY,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
  }

  const startTime = Date.now();

  // Build thread context for conversation continuity
  const threadContextSection = buildThreadContextSection(context);

  // Add meeting context if available
  let meetingContextStr = "";
  if (context.resolvedMeeting) {
    const meeting = context.resolvedMeeting;
    meetingContextStr = `Meeting Context: ${meeting.companyName}${meeting.meetingDate ? ` (${meeting.meetingDate.toLocaleDateString()})` : ''}`;
  }

  // Check if request would benefit from product knowledge enrichment
  // Include product KB for PitCrew-related creative/drafting tasks (naming, presentations, value props, etc.)
  let productKnowledgeSection = "";
  const pitcrewContextPatterns = /pitcrew|pilot|presentation|report|deck|proposal|value prop|demo|branding|naming|title/i;
  if (pitcrewContextPatterns.test(userMessage) || (threadContextSection && pitcrewContextPatterns.test(threadContextSection))) {
    try {
      const pkResult = await getProductKnowledgePrompt();
      if (pkResult.recordCount > 0 && pkResult.promptText) {
        // Use a condensed version for GENERAL_HELP (terminology and branding focus)
        productKnowledgeSection = `\n\n=== PITCREW PRODUCT CONTEXT (for terminology and branding alignment) ===
${pkResult.promptText.substring(0, 2000)}...
Use this context to align suggestions with PitCrew's terminology and value proposition.`;
        console.log(`[OpenAssistant] GENERAL_HELP enriched with product knowledge (${pkResult.promptText.length} chars)`);
      }
    } catch (err) {
      console.log(`[OpenAssistant] Could not fetch product knowledge for GENERAL_HELP: ${err}`);
    }
  }

  // Build system prompt: clean role context + product knowledge + thread context
  const systemPrompt = buildGeneralAssistancePrompt({
    productKnowledgeSection,
    meetingContext: meetingContextStr,
    threadContext: threadContextSection,
    isDrafting: isDraftingContract,
  });

  // Build personalized progress message for drafting contracts
  let progressMessage: string | undefined;
  if (isDraftingContract) {
    const intentType = actualContract === AnswerContract.DRAFT_EMAIL ? 'draft_email' : 'draft_response';
    progressMessage = await generatePersonalizedProgress(userMessage, intentType);
  }

  const { answer, streamingCompleted } = await callGeneralHelpWithFallback(
    systemPrompt,
    userMessage,
    context.slackStreaming,
    startTime,
  );

  const contractChain = dlContractChain && dlContractChain.length > 0 ? dlContractChain : [actualContract];

  let finalAnswer = answer;
  if (contractChain.length > 1) {
    const continuation = await executeChainContinuation({
      userMessage,
      primaryOutput: answer,
      remainingContracts: contractChain.slice(1),
    });
    finalAnswer = continuation.finalOutput;
  }

  return {
    answer: finalAnswer,
    intent: "general_assistance",
    intentClassification: classification,
    decisionLayerIntent: Intent.GENERAL_HELP,
    answerContract: actualContract,
    answerContractChain: contractChain.length > 1 ? contractChain : undefined,
    ssotMode: "none" as SSOTMode,
    dataSource: "general_knowledge",
    delegatedToSingleMeeting: false,
    progressMessage,
    streamingCompleted,
  };
}

/**
 * Handle SLACK_SEARCH intent.
 * Searches Slack messages and channels as a data source.
 */
async function handleSlackSearchIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Slack search: contract=${contract}`);

  try {
    const result = await SlackSearchHandler.handleSlackSearch({
      question: userMessage,
      contract: contract,
      extractedCompany: context.decisionLayerResult?.extractedCompany,
      keyTopics: context.decisionLayerResult?.keyTopics,
      conversationContext: context.decisionLayerResult?.conversationContext,
      threadMessages: context.threadMessages,
    });

    // Map to OpenAssistantResult format
    return {
      answer: result.answer,
      intent: "slack_search",
      intentClassification: classification,
      decisionLayerIntent: Intent.SLACK_SEARCH,
      answerContract: contract,
      dataSource: "slack",
      delegatedToSingleMeeting: false,
      coverage: result.coverage,
    };
  } catch (error) {
    console.error('[OpenAssistant] Slack search error:', error);

    return {
      answer: `I encountered an error searching Slack: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or rephrase your request.`,
      intent: "slack_search",
      intentClassification: classification,
      decisionLayerIntent: Intent.SLACK_SEARCH,
      answerContract: AnswerContract.CLARIFY,
      dataSource: "slack",
      delegatedToSingleMeeting: false,
    };
  }
}

/**
 * Determine if the Open Assistant path should be used.
 * 
 * IMPORTANT: This function no longer performs intent classification.
 * The Intent Router (server/decisionLayer/intent.ts) is the SOLE authority.
 */
export function shouldUseOpenAssistant(
  resolvedMeeting: SingleMeetingContext | null
): { useOpenAssistant: boolean } {
  return { useOpenAssistant: true };
}
