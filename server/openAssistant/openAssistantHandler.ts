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
import { handleSingleMeetingQuestion, type SingleMeetingContext, type SingleMeetingResult } from "./singleMeetingOrchestrator";
import { Intent, type IntentClassificationResult } from "../decisionLayer/intent";
import { AnswerContract, type SSOTMode, selectMultiMeetingContractChain, selectSingleMeetingContractChain } from "../decisionLayer/answerContracts";
import { MODEL_ASSIGNMENTS, getModelDescription, GEMINI_MODELS } from "../config/models";
import { TIMEOUTS, CONTENT_LIMITS } from "../config/constants";
import { isCapabilityQuestion, CAPABILITIES_PROMPT } from "../config/prompts/system";

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
import { executeContractChain, mapOrchestratorIntentToContract } from "./contractExecutor";
import { getComprehensiveProductKnowledge, formatProductKnowledgeForPrompt, getProductKnowledgePrompt } from "../airtable/productData";
import { GoogleGenAI } from "@google/genai";

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
 * Generate a personalized progress message using a quick LLM call.
 * Uses gpt-4o-mini for speed - this should complete in <1 second.
 * Falls back to a default message if LLM fails.
 */
async function generatePersonalizedProgress(
  userMessage: string,
  intentType: 'product' | 'research' | 'draft_email' | 'draft_response' | 'multi_meeting' | 'general'
): Promise<string> {
  const defaultMessages: Record<typeof intentType, string> = {
    product: "I'm checking our product database now.",
    research: "I'm researching that for you now.",
    draft_email: "I'm drafting your email now.",
    draft_response: "I'm drafting your response now.",
    multi_meeting: "I'm analyzing the relevant meetings now.",
    general: "I'm working on that for you now.",
  };
  
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.PROGRESS_MESSAGES,
      messages: [
        {
          role: "system",
          content: `Generate a brief, friendly progress message (15-25 words max) for a user who just asked a question. 
The message should:
- Be warm and conversational (not robotic)
- Reference what they're asking about specifically
- End with a brief reassurance you're working on it
- NOT use emojis
- NOT start with "I'm" (vary the opener)

Examples:
- "Let me dig into our camera integration specs for you - pulling that info now."
- "Good question about pricing! Gathering the latest details from our database."
- "Checking what we know about network requirements - one moment."
- "Looking into how that feature works - I'll have an answer shortly."`
        },
        {
          role: "user",
          content: `Question type: ${intentType}\nUser's question: "${userMessage.substring(0, 150)}"`
        }
      ],
      max_tokens: 50,
      temperature: 0.7,
    });
    
    const generated = response.choices[0]?.message?.content?.trim();
    if (generated && generated.length > 10 && generated.length < 150) {
      return generated;
    }
    return defaultMessages[intentType];
  } catch (error) {
    console.log(`[OpenAssistant] Progress message generation failed, using default`);
    return defaultMessages[intentType];
  }
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
    [AnswerContract.DOCUMENT_ANSWER]: "searching docs",
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
      signal: AbortSignal.timeout(TIMEOUTS.WEBSITE_FETCH_MS),
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
  const threadContextSection = threadContext || '';
  const systemPrompt = hasProductData
    ? `${AMBIENT_PRODUCT_CONTEXT}

=== AUTHORITATIVE PRODUCT KNOWLEDGE (from Airtable) ===
${productDataPrompt}

You are answering a product knowledge question about PitCrew.

AUTHORITY RULES:
- Use the product knowledge above as your authoritative source
- For questions about features, value propositions, or customer segments: Answer directly from the data
- For integration specifics not in the data: Note that details should be verified with the product team

PRICING RULES (CRITICAL):
1. "How is PitCrew priced?" / "What's the pricing model?" → USE the Airtable data (e.g., "per-store flat monthly fee, unlimited seats")
2. "How much does it cost?" / "What's the price?" / "Give me a quote" → DEFER to sales: "For specific pricing and quotes, please contact the sales team"

The Airtable data describes the PRICING MODEL (structure), not the actual DOLLAR AMOUNTS. Never invent or guess specific prices.

RESPONSE GUIDELINES:
- Match your response format to the user's request (list, paragraph, comparison, draft, etc.)
- For "explain", "overview", or "pitch" requests: Be COMPREHENSIVE - include all relevant value propositions, key features, and customer segments from the data
- For client-facing explanations: Structure your response with clear sections (What it is, Who it's for, Key Benefits, Key Features)
- Use SPECIFIC details from the product data - don't summarize away the richness
- Only be brief if the user asks a narrow, specific question

FOLLOW-UP PATTERN - ANSWERING CUSTOMER QUESTIONS:
If the conversation history contains a list of customer questions (especially "Open Questions" or unanswered questions) and the user asks to "answer those questions" or "help with those":
- Extract the OPEN/UNANSWERED questions from the thread context
- Provide ACTUAL ANSWERS using the product knowledge above
- Structure your response with each question followed by your answer
- DO NOT just re-list the questions - provide real answers from product knowledge
- For questions you cannot answer from the product data, say "I'd need to verify this with the product team"

WEBSITE CONTENT RULES (CRITICAL):
- This data is from the PRODUCT KNOWLEDGE DATABASE (Airtable), NOT from the live website
- NEVER claim something is "on the website" or "currently exists on the site" - you cannot see the website
- If the user asks about website content, clearly label this as "Product Knowledge (from database)" not "Existing on Website"
- If they want a website comparison, ask them to provide the URL so you can analyze the live content${threadContextSection}`
    : `${AMBIENT_PRODUCT_CONTEXT}

You are answering a product knowledge question about PitCrew.

NOTE: No product data is currently available in the database. Provide high-level framing only.

AUTHORITY RULES (without product data):
- Provide only general, high-level explanations about PitCrew's purpose and value
- Add "I'd recommend checking our product documentation for specific details"
- For pricing: Say "For current pricing information, please check with the sales team"
- NEVER fabricate specific features, pricing, or integration claims${threadContextSection}`;

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
 * AMBIENT PRODUCT CONTEXT (Always On)
 * 
 * Provides product identity and framing while explicitly restricting factual authority.
 */
const AMBIENT_PRODUCT_CONTEXT = `IMPORTANT: You are an AI assistant for PitCrew employees.
There is only ONE PitCrew — the product developed by Leverege.

=== PitCrew Identity (Established Fact) ===
- PitCrew is a B2B SaaS product developed by Leverege
- It is used by automotive service businesses (e.g., tire shops, oil change centers, car washes, dealership service departments)
- When users mention "PitCrew," they ALWAYS mean this product
- Never ask for clarification about which PitCrew

=== Framing Context (Non-Authoritative) ===
Use the following only for high-level explanation and framing:
- PitCrew focuses on helping teams understand operations in automotive service environments
- It applies AI and computer vision concepts to analyze activity in service bays
- It is commonly described in terms of visibility, operational insight, and performance improvement

Do NOT treat the above as authoritative facts or guarantees.

=== Authority Rules (HARDENING - CRITICAL) ===
1. Ambient context is NOT evidence - never cite or reference it as a source of truth
2. Ambient context must NEVER justify factual claims about features, pricing, or capabilities
3. Product SSOT is the ONLY source for authoritative product information

=== Forbidden Phrasing Without Product SSOT ===
When Product SSOT data is NOT explicitly provided, you MUST NOT use phrasing like:
- "PitCrew supports..." / "PitCrew integrates with..."
- "PitCrew typically..." / "PitCrew can..."
- "According to our approach..." / "Our product..."
- Any statement implying specific feature capabilities or guarantees

Instead, use hedged language like:
- "You'd want to verify with the product team whether..."
- "For specific integration details, please check the product documentation..."
- "I don't have authoritative product data to confirm..."

=== When SSOT IS Provided ===
Only make authoritative claims when:
1. Product SSOT data is explicitly included in the context
2. The active contract permits authoritative claims (ssotMode="authoritative")
3. The claim is directly supported by the SSOT data provided`;

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
        controlPlaneIntent: cpResult.intent,
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
        controlPlaneIntent: cpResult.intent,
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
      return handleMeetingDataIntent(userMessage, context, classification, cpResult.answerContract);
    }
    
    if (cpResult.intent === Intent.MULTI_MEETING) {
      return handleMultiMeetingIntent(userMessage, context, classification, cpResult.answerContract);
    }
    
    if (cpResult.intent === Intent.PRODUCT_KNOWLEDGE) {
      return handleProductKnowledgeIntent(userMessage, context, classification, cpResult.answerContract);
    }
    
    if (cpResult.intent === Intent.EXTERNAL_RESEARCH) {
      return handleExternalResearchIntent(userMessage, context, classification, cpResult.answerContract);
    }
    
    return handleGeneralAssistanceIntent(userMessage, context, classification, cpResult.answerContract);
  }
  
  // DECISION LAYER REQUIRED: No fallback to separate classifier
  console.log(`[OpenAssistant] WARNING: No Decision Layer intent provided, defaulting to CLARIFY`);
  const fallbackClassification = defaultClassification("No Decision Layer intent provided - clarification needed");
  
  return {
    answer: "I need a bit more context to help you effectively. Could you tell me more about what you're looking for?",
    intent: "general_assistance",
    intentClassification: fallbackClassification,
    controlPlaneIntent: Intent.CLARIFY,
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
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to meeting data path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  if (context.resolvedMeeting) {
    const scope = {
      meetingId: context.resolvedMeeting.meetingId,
      companyId: context.resolvedMeeting.companyId,
      companyName: context.resolvedMeeting.companyName,
    };
    
    // USE DECISION LAYER CONTRACT when provided (Decision Layer is sole authority)
    // Only fall back to internal selection when DL contract not provided (legacy paths)
    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];
    
    if (contract) {
      // Decision Layer provided the contract - use it directly
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using DL-provided contract: ${contract}`);
    } else {
      // Legacy path (no DL context) - use internal selection
      const chain = selectSingleMeetingContractChain(userMessage, scope);
      primaryContract = chain.primaryContract;
      contractChain = chain.contracts;
      console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
    }
    
    // Generate progress message for multi-step contract chains
    const chainProgress = generateContractChainProgress(contractChain);
    
    // Pass the primary contract to the orchestrator to skip deprecated classification
    const singleMeetingResult = await handleSingleMeetingQuestion(
      context.resolvedMeeting,
      userMessage,
      false,
      primaryContract
    );

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
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
  const meetingSearch = await findRelevantMeetings(userMessage, classification, scopeOverride);
  
  if (meetingSearch.meetings.length === 0) {
    console.log(`[OpenAssistant] Scope resolution failed: SINGLE_MEETING intent, searched for: "${meetingSearch.searchedFor || 'nothing specific'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria)`);
    return {
      answer: `I searched${meetingSearch.searchedFor ? ` for "${meetingSearch.searchedFor}"` : ''} but didn't find any matching call transcripts in the system.\n\nThis could mean:\n- No transcripts have been uploaded yet for that customer or topic\n- The meeting you're looking for uses a different name or spelling\n\nYou can check the Transcripts page to see what's available, or try asking about a specific customer by name.`,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.CLARIFY,
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
    
    if (contract) {
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using DL-provided contract: ${contract}`);
    } else {
      const chain = selectSingleMeetingContractChain(userMessage, scope);
      primaryContract = chain.primaryContract;
      contractChain = chain.contracts;
      console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
    }
    
    // Generate progress message for multi-step contract chains
    const chainProgress = generateContractChainProgress(contractChain);
    
    // Pass the primary contract to the orchestrator
    const singleMeetingResult = await handleSingleMeetingQuestion(
      meeting,
      userMessage,
      false,
      primaryContract
    );

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
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
  
  const chain = selectMultiMeetingContractChain(userMessage, scope);
  console.log(`[OpenAssistant] Selected MULTI_MEETING chain: [${chain.contracts.join(" → ")}] (coverage: ${scope.coverage.matchingMeetingsCount} meetings)${meetingSearch.topic ? ` topic: "${meetingSearch.topic}"` : ''}`);
  
  // Build progress message: multi-meeting context + contract chain steps (if multiple)
  const meetingProgress = `I found ${meetingSearch.meetings.length} meeting${meetingSearch.meetings.length !== 1 ? 's' : ''} across ${uniqueCompanies.size} ${uniqueCompanies.size !== 1 ? 'companies' : 'company'}${meetingSearch.searchedFor ? ` related to "${meetingSearch.searchedFor}"` : ''}.`;
  const chainProgress = generateContractChainProgress(chain.contracts);
  const progressMessage = chainProgress 
    ? `${meetingProgress} ${chainProgress}` 
    : `${meetingProgress} I'll analyze them and compile the insights.`;
  
  const chainResult = await executeContractChain(chain, userMessage, meetingSearch.meetings, meetingSearch.topic);
  
  return {
    answer: chainResult.finalOutput,
    intent: "meeting_data",
    intentClassification: classification,
    controlPlaneIntent: Intent.MULTI_MEETING,
    answerContract: chain.primaryContract,
    answerContractChain: chain.contracts,
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
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to MULTI_MEETING path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  // Pass LLM-determined scope from Decision Layer (if available)
  const scopeOverride: ScopeOverride | undefined = context.decisionLayerResult?.scope;
  const meetingSearch = await findRelevantMeetings(userMessage, classification, scopeOverride);
  
  if (meetingSearch.meetings.length === 0) {
    console.log(`[OpenAssistant] Scope resolution failed: MULTI_MEETING intent, searched for: "${meetingSearch.searchedFor || 'all meetings'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria for cross-meeting analysis)`);
    return {
      answer: `I looked across all available transcripts${meetingSearch.searchedFor ? ` (searched for: "${meetingSearch.searchedFor}")` : ''} but didn't find any matching data for this analysis.\n\nThis could mean:\n- There are no transcripts uploaded yet that match your criteria\n- The topic you're asking about hasn't come up in recorded calls\n\nYou can check the Transcripts page to see what call data is available, or try a different question about specific customers or topics that have been discussed.`,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.CLARIFY,
      answerContract: AnswerContract.CLARIFY,
      ssotMode: "none" as SSOTMode,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
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
  
  if (contract) {
    // Decision Layer provided the contract - use it directly
    primaryContract = contract;
    contractChain = [contract];
    console.log(`[OpenAssistant] Using DL-provided contract: ${contract}`);
  } else {
    // Legacy path (no DL context) - use internal selection
    const chain = selectMultiMeetingContractChain(userMessage, scope);
    primaryContract = chain.primaryContract;
    contractChain = chain.contracts;
    console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
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
    controlPlaneIntent: Intent.MULTI_MEETING,
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
  contract?: AnswerContract
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
      answer = await getProductKnowledgeResponse(userMessage, productDataPrompt, hasProductData, context.slackStreaming, threadContextSection);
    }
  } else {
    // No URL - use gpt-4o directly
    answer = await getProductKnowledgeResponse(userMessage, productDataPrompt, hasProductData, context.slackStreaming, threadContextSection);
  }

  return {
    answer,
    intent: "meeting_data",
    intentClassification: classification,
    controlPlaneIntent: Intent.PRODUCT_KNOWLEDGE,
    answerContract: actualContract,
    ssotMode: hasProductData ? "authoritative" : "descriptive",
    dataSource: "product_ssot",
    delegatedToSingleMeeting: false,
    evidenceSources: hasProductData ? tablesWithData : undefined,
    progressMessage,
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
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to external research path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  const actualContract = contract || AnswerContract.EXTERNAL_RESEARCH;
  
  // Extract company name from the user message
  const companyName = extractCompanyFromMessage(userMessage);
  
  console.log(`[OpenAssistant] External research for: ${companyName || 'unknown company'}`);
  
  // Detect if user wants to write content matching existing product style
  const needsStyleMatching = detectStyleMatchingRequest(userMessage);
  console.log(`[OpenAssistant] Style matching needed: ${needsStyleMatching}`);
  
  // Generate personalized progress message
  const progressMessage = await generatePersonalizedProgress(userMessage, 'research');
  
  // Perform the research
  const researchResult = await performExternalResearch(
    userMessage,
    companyName,
    null // topic derived from message
  );
  
  if (!researchResult.answer) {
    return {
      answer: "I wasn't able to complete the research. Please try rephrasing your request or specifying the company name more clearly.",
      intent: "external_research",
      intentClassification: classification,
      controlPlaneIntent: Intent.EXTERNAL_RESEARCH,
      answerContract: AnswerContract.CLARIFY,
      dataSource: "external_research",
      delegatedToSingleMeeting: false,
    };
  }
  
  // If user wants style-matched output, chain product knowledge for style examples
  if (needsStyleMatching) {
    console.log(`[OpenAssistant] Chaining product knowledge for style matching...`);
    try {
      const styledOutput = await chainProductStyleWriting(userMessage, researchResult.answer, context);
      const sourcesSection = researchResult.citations.length > 0 
        ? formatCitationsForDisplay(researchResult.citations)
        : "";
      
      return {
        answer: styledOutput + sourcesSection,
        intent: "external_research",
        intentClassification: classification,
        controlPlaneIntent: Intent.EXTERNAL_RESEARCH,
        answerContract: actualContract,
        dataSource: "product_ssot",
        delegatedToSingleMeeting: false,
        evidenceSources: researchResult.citations.map(c => c.source),
        progressMessage,
      };
    } catch (styleError) {
      console.error(`[OpenAssistant] Style chaining failed, returning raw research:`, styleError);
      // Fall through to return raw research
    }
  }
  
  // Include sources in the response
  const sourcesSection = researchResult.citations.length > 0 
    ? formatCitationsForDisplay(researchResult.citations)
    : "";
  
  return {
    answer: researchResult.answer + sourcesSection,
    intent: "external_research",
    intentClassification: classification,
    controlPlaneIntent: Intent.EXTERNAL_RESEARCH,
    answerContract: actualContract,
    dataSource: "external_research",
    delegatedToSingleMeeting: false,
    evidenceSources: researchResult.citations.map(c => c.source),
    progressMessage,
  };
}

/**
 * Detect if the user request involves writing content that should match
 * existing product content style (features, descriptions, etc.)
 */
function detectStyleMatchingRequest(message: string): boolean {
  const lower = message.toLowerCase();
  const stylePatterns = [
    /similar\s+to\s+(?:our\s+)?(?:other\s+)?(?:features?|descriptions?)/i,
    /like\s+(?:our\s+)?(?:other\s+)?(?:features?|descriptions?)/i,
    /match(?:ing)?\s+(?:the\s+)?style/i,
    /(?:same|consistent)\s+(?:style|format|tone)/i,
    /(?:write|create|draft)\s+(?:a\s+)?(?:feature\s+)?description/i,
    /making\s+it\s+similar/i,
    /write\s+(?:the|a)\s+description\s+for\s+(?:the\s+)?feature/i,
  ];
  
  return stylePatterns.some(pattern => pattern.test(lower));
}

/**
 * Chain product knowledge to generate styled output that matches existing
 * feature descriptions in tone and format.
 */
async function chainProductStyleWriting(
  originalRequest: string,
  researchContent: string,
  context: OpenAssistantContext
): Promise<string> {
  const { getProductKnowledgePrompt } = await import("../airtable/productData");
  
  // Fetch existing feature descriptions as style examples
  const snapshotResult = await getProductKnowledgePrompt();
  
  // Extract just the features section for style reference
  // Matches both "=== Current Product Features" and "=== Roadmap Features"
  const featuresMatch = snapshotResult.promptText.match(/=== (?:Current Product |Roadmap )?Features[\s\S]*?(?===|$)/);
  const featureExamples = featuresMatch ? featuresMatch[0].slice(0, 2000) : "";
  
  console.log(`[OpenAssistant] Style matching - feature examples length: ${featureExamples.length} chars`);
  
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  
  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.PRODUCT_KNOWLEDGE_RESPONSE,
    messages: [
      {
        role: "system",
        content: `You are writing a feature description for PitCrew. You MUST match the exact style and tone of our existing feature descriptions.

=== STYLE EXAMPLES (match this format exactly) ===
${featureExamples}

=== STYLE RULES (CRITICAL - FOLLOW EXACTLY) ===
1. MAXIMUM 1-2 sentences - typically 15-30 words total
2. Start with an action verb (Detects, Identifies, Shows, Enables, Monitors, Alerts, etc.)
3. Describe WHAT it does and WHY it matters in ONE concise statement
4. Be specific about the capability
5. NO marketing fluff, NO buzzwords, NO effusive language
6. Professional but accessible tone - match the examples above EXACTLY

BAD: "Enhance safety in your oil change shop with our cutting-edge capability that monitors the presence of protective nets underneath service bays, ensuring they are always in place. If a net is detected to be missing, an immediate alert is sent to your team, helping prevent potential safety hazards."

GOOD: "Detects missing safety nets underneath service bays and alerts staff immediately, preventing fall hazards in oil change facilities."

=== RESEARCH CONTEXT (for your understanding only) ===
${researchContent}

OUTPUT ONLY the feature description. No preamble, no "Here's the description", no extra explanation. Just the 1-2 sentence description.`,
      },
      {
        role: "user",
        content: `Write the feature description for: ${originalRequest.split("feature").pop()?.split(".")[0]?.trim() || "this feature"}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 150,
  });
  
  return response.choices[0]?.message?.content || researchContent;
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
 * Handle GENERAL_HELP intent.
 */
async function handleGeneralAssistanceIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to general assistance path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  // Check if user is asking about capabilities - use focused prompt for natural response
  if (isCapabilityQuestion(userMessage)) {
    console.log(`[OpenAssistant] Capability question detected - generating conversational capabilities response`);
    const capabilitiesAnswer = await streamOpenAIResponse(
      MODEL_ASSIGNMENTS.GENERAL_ASSISTANCE,
      CAPABILITIES_PROMPT,
      userMessage,
      context.slackStreaming
    );
    return {
      answer: capabilitiesAnswer,
      intent: "general_assistance",
      intentClassification: classification,
      controlPlaneIntent: Intent.GENERAL_HELP,
      answerContract: AnswerContract.GENERAL_RESPONSE,
      dataSource: "general_knowledge",
      delegatedToSingleMeeting: false,
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
        controlPlaneIntent: Intent.CLARIFY,
        answerContract: AnswerContract.CLARIFY,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
  }
  
  const startTime = Date.now();
  
  // Build thread context for conversation continuity
  const threadContextSection = buildThreadContextSection(context);
  
  // Additional instructions for drafting contracts
  let draftingInstructions = "";
  if (isDraftingContract && threadContextSection) {
    draftingInstructions = "\n\nIMPORTANT: Use the specific details from the conversation above (customer names, action items, topics discussed) in your draft. Do NOT use generic placeholders.";
  }
  
  // Add meeting context if available
  let meetingContextStr = "";
  if (context.resolvedMeeting) {
    const meeting = context.resolvedMeeting;
    meetingContextStr = `\n\nMeeting Context: ${meeting.companyName}${meeting.meetingDate ? ` (${meeting.meetingDate.toLocaleDateString()})` : ''}`;
  }
  
  const systemPrompt = `${AMBIENT_PRODUCT_CONTEXT}

You are a helpful business assistant for the PitCrew team. Provide clear, professional help with the user's request.

=== ALLOWED (Advisory, Creative, Framing) ===
- Drafting emails, messages, and documents
- Explaining concepts and answering general questions
- Providing suggestions and recommendations
- Helping with planning and organization
- High-level descriptions of what PitCrew does and its value

=== STRICTLY FORBIDDEN ===
- Asserting factual meeting outcomes (what was said, decided, agreed)
- Guaranteeing product features, pricing, integrations, or availability
- Making claims that require Product SSOT or meeting evidence
- Implying you have access to specific meeting data

If you're unsure whether something requires evidence, err on the side of asking the user to be more specific.${meetingContextStr}${threadContextSection}${draftingInstructions}`;
  
  console.log(`[OpenAssistant] Calling ${getModelDescription(MODEL_ASSIGNMENTS.GENERAL_ASSISTANCE)} for general assistance (streaming: ${!!context.slackStreaming})...`);
  const answer = await streamOpenAIResponse(
    MODEL_ASSIGNMENTS.GENERAL_ASSISTANCE,
    systemPrompt,
    userMessage,
    context.slackStreaming
  );
  console.log(`[OpenAssistant] ${getModelDescription(MODEL_ASSIGNMENTS.GENERAL_ASSISTANCE)} response received in ${Date.now() - startTime}ms (${answer.length} chars)`);

  // Build personalized progress message for drafting contracts
  let progressMessage: string | undefined;
  if (isDraftingContract) {
    const intentType = actualContract === AnswerContract.DRAFT_EMAIL ? 'draft_email' : 'draft_response';
    progressMessage = await generatePersonalizedProgress(userMessage, intentType);
  }

  return {
    answer,
    intent: "general_assistance",
    intentClassification: classification,
    controlPlaneIntent: Intent.GENERAL_HELP,
    answerContract: actualContract,
    ssotMode: "none" as SSOTMode,
    dataSource: "general_knowledge",
    delegatedToSingleMeeting: false,
    progressMessage,
  };
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
