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
 * - Control Plane is the SOLE authority for intent classification
 * - This handler routes based on Control Plane decisions, never reclassifies
 * - Execution Plane is deterministic and follows contracts verbatim
 */

import { OpenAI } from "openai";
import { performExternalResearch, formatCitationsForDisplay, type ResearchResult } from "./externalResearch";
import { handleSingleMeetingQuestion, type SingleMeetingContext, type SingleMeetingResult } from "../mcp/singleMeetingOrchestrator";
import { Intent, type IntentClassificationResult } from "../controlPlane/intent";
import { AnswerContract, type SSOTMode, selectMultiMeetingContractChain, selectSingleMeetingContractChain } from "../controlPlane/answerContracts";

import { 
  type EvidenceSource, 
  type IntentClassification, 
  type OpenAssistantContext, 
  type OpenAssistantResult,
  defaultClassification,
  deriveEvidenceSource 
} from "./types";
import { findRelevantMeetings, searchAcrossMeetings } from "./meetingResolver";
import { executeContractChain, mapOrchestratorIntentToContract } from "./contractExecutor";
import { getComprehensiveProductKnowledge, formatProductKnowledgeForPrompt } from "../airtable/productData";

export type { EvidenceSource, IntentClassification, OpenAssistantContext, OpenAssistantResult };

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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
 * Routes to appropriate handler based on Control Plane intent.
 */
export async function handleOpenAssistant(
  userMessage: string,
  context: OpenAssistantContext
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Processing: "${userMessage}"`);
  
  if (context.controlPlaneResult) {
    const cpResult = context.controlPlaneResult;
    console.log(`[OpenAssistant] Using full Control Plane result: intent=${cpResult.intent}, contract=${cpResult.answerContract}, method=${cpResult.intentDetectionMethod}`);
    
    if (cpResult.intent === Intent.REFUSE) {
      return {
        answer: "I'm sorry, but that question is outside of what I can help with. I'm designed to assist with PitCrew-related topics, customer meetings, and product information.",
        intent: "general_assistance",
        intentClassification: defaultClassification("Refused by control plane"),
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
      
      // Use the smart clarification message from Control Plane (or fallback to friendly message)
      const clarifyMessage = cpResult.clarifyMessage || `I want to help but I'm not sure what you're looking for. Are you asking about:

• A customer meeting (which company?)
• PitCrew product info (which feature?)
• Help with a task (what kind?)

Give me a hint and I'll get you sorted!`;
      
      return {
        answer: clarifyMessage,
        intent: "general_assistance",
        intentClassification: defaultClassification("Clarification required by control plane"),
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
      rationale: `Derived from Control Plane: ${cpResult.intent} -> ${cpResult.answerContract}`,
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
    
    console.log(`[OpenAssistant] Evidence source: ${evidenceSource} (from Control Plane: ${cpResult.intent} -> ${cpResult.answerContract})`);
    
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
  
  // CONTROL PLANE REQUIRED: No fallback to separate classifier
  console.log(`[OpenAssistant] WARNING: No Control Plane intent provided, defaulting to CLARIFY`);
  const fallbackClassification = defaultClassification("No Control Plane intent provided - clarification needed");
  
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
    
    // USE CONTROL PLANE CONTRACT when provided (Control Plane is sole authority)
    // Only fall back to internal selection when CP contract not provided (legacy paths)
    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];
    
    if (contract) {
      // Control Plane provided the contract - use it directly
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using CP-provided contract: ${contract}`);
    } else {
      // Legacy path (no CP context) - use internal selection
      const chain = selectSingleMeetingContractChain(userMessage, scope);
      primaryContract = chain.primaryContract;
      contractChain = chain.contracts;
      console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
    }
    
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
    };
  }

  console.log(`[OpenAssistant] No meeting resolved, searching for relevant meetings`);
  
  const meetingSearch = await findRelevantMeetings(userMessage, classification);
  
  if (meetingSearch.meetings.length === 0) {
    console.log(`[OpenAssistant] Scope resolution failed: SINGLE_MEETING intent, searched for: "${meetingSearch.searchedFor || 'nothing specific'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria)`);
    return {
      answer: `I couldn't find any meetings matching your query. ${meetingSearch.searchedFor ? `I searched for: "${meetingSearch.searchedFor}"` : ''}\n\nCould you provide more details? For example:\n- The company or customer name\n- When the meeting took place\n- Who you spoke with`,
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
    
    // USE CONTROL PLANE CONTRACT when provided (Control Plane is sole authority)
    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];
    
    if (contract) {
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using CP-provided contract: ${contract}`);
    } else {
      const chain = selectSingleMeetingContractChain(userMessage, scope);
      primaryContract = chain.primaryContract;
      contractChain = chain.contracts;
      console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
    }
    
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
  
  const meetingSearch = await findRelevantMeetings(userMessage, classification);
  
  if (meetingSearch.meetings.length === 0) {
    console.log(`[OpenAssistant] Scope resolution failed: MULTI_MEETING intent, searched for: "${meetingSearch.searchedFor || 'all meetings'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria for cross-meeting analysis)`);
    return {
      answer: `I couldn't find any meetings matching your query for cross-meeting analysis. ${meetingSearch.searchedFor ? `I searched for: "${meetingSearch.searchedFor}"` : ''}\n\nCould you provide more details? For example:\n- Specific companies or customers\n- A time period to search within\n- Topics or themes to look for`,
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
  
  // USE CONTROL PLANE CONTRACT when provided (Control Plane is sole authority)
  let primaryContract: AnswerContract;
  let contractChain: AnswerContract[];
  
  if (contract) {
    // Control Plane provided the contract - use it directly
    primaryContract = contract;
    contractChain = [contract];
    console.log(`[OpenAssistant] Using CP-provided contract: ${contract}`);
  } else {
    // Legacy path (no CP context) - use internal selection
    const chain = selectMultiMeetingContractChain(userMessage, scope);
    primaryContract = chain.primaryContract;
    contractChain = chain.contracts;
    console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
  }
  
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
  
  // Check for URLs in the message - if present, fetch their content
  let websiteContent: string | null = null;
  let websiteUrl: string | null = null;
  const urlMatch = userMessage.match(/https?:\/\/[\w\-\.]+\.\w+[\w\/\-\.\?\=\&]*/i);
  if (urlMatch) {
    websiteUrl = urlMatch[0];
    console.log(`[OpenAssistant] URL detected in message: ${websiteUrl}`);
    try {
      const { extractTextFromUrl } = await import("../textExtractor");
      websiteContent = await extractTextFromUrl(websiteUrl);
      console.log(`[OpenAssistant] Fetched website content: ${websiteContent.length} chars`);
    } catch (urlError) {
      console.warn(`[OpenAssistant] Failed to fetch URL content: ${urlError}`);
      // Continue without website content - still use product knowledge
    }
  }
  
  // Fetch REAL product data from Airtable tables
  let productKnowledge;
  let productDataPrompt;
  try {
    console.log(`[OpenAssistant] Fetching product knowledge from database...`);
    productKnowledge = await getComprehensiveProductKnowledge();
    productDataPrompt = formatProductKnowledgeForPrompt(productKnowledge);
    console.log(`[OpenAssistant] Product knowledge fetch successful`);
  } catch (dbError) {
    console.error(`[OpenAssistant] PRODUCT_KNOWLEDGE database error:`, dbError);
    throw new Error(`Product knowledge database error: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
  }
  
  console.log(`[OpenAssistant] Product knowledge loaded: ${productKnowledge.metadata.totalRecords} records from ${productKnowledge.metadata.tablesWithData.join(", ")}`);
  
  const hasProductData = productKnowledge.metadata.totalRecords > 0;
  
  // Build website content section if URL was fetched
  const websiteSection = websiteContent && websiteUrl
    ? `\n\n=== WEBSITE CONTENT (fetched from ${websiteUrl}) ===
${websiteContent.slice(0, 15000)}${websiteContent.length > 15000 ? '\n[... content truncated ...]' : ''}`
    : '';

  const systemPrompt = hasProductData
    ? `${AMBIENT_PRODUCT_CONTEXT}

=== AUTHORITATIVE PRODUCT KNOWLEDGE (from Airtable) ===
${productDataPrompt}${websiteSection}

You are answering a product knowledge question about PitCrew.

AUTHORITY RULES (with product data available):
- Use the product knowledge above as your authoritative source
- For questions about features, value propositions, or customer segments: Answer directly from the data
- For integration specifics not in the data: Note that details should be verified with the product team
${websiteContent ? `
WEBSITE CONTENT CONTEXT:
- The user has shared a URL and its content is provided above
- Use both the product knowledge AND the website content to answer their question
- When comparing or updating content: clearly identify what is NEW (exists in product knowledge but missing from the website) vs what already EXISTS on the website
- Use visual markers like [NEW], [UPDATED], or [EXISTS] to help the user quickly see what needs to be added or changed` : ''}

PRICING RULES (CRITICAL - distinguish these two cases):
1. "How is PitCrew priced?" / "What's the pricing model?" → USE the Airtable data (e.g., "per-store flat monthly fee, unlimited seats")
2. "How much does it cost?" / "What's the price?" / "Give me a quote" → DEFER to sales: "For specific pricing and quotes, please contact the sales team"

The Airtable data describes the PRICING MODEL (structure), not the actual DOLLAR AMOUNTS. Never invent or guess specific prices.

When answering:
- Synthesize the product knowledge naturally into your response
- Don't just list features — explain how they address the user's question
- Keep responses conversational and helpful`
    : `${AMBIENT_PRODUCT_CONTEXT}

You are answering a product knowledge question about PitCrew.

NOTE: No product data is currently available in the database. Provide high-level framing only.

AUTHORITY RULES (without product data):
- Provide only general, high-level explanations about PitCrew's purpose and value
- Add "I'd recommend checking our product documentation for specific details"
- For pricing: Say "For current pricing information, please check with the sales team"
- NEVER fabricate specific features, pricing, or integration claims`;

  let answer: string;
  try {
    console.log(`[OpenAssistant] Calling GPT-5 for product knowledge response...`);
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    answer = response.choices[0]?.message?.content || "I'd be happy to help with product information. Could you be more specific about what you'd like to know?";
    console.log(`[OpenAssistant] GPT-5 response received (${answer.length} chars)`);
  } catch (openaiError) {
    console.error(`[OpenAssistant] PRODUCT_KNOWLEDGE OpenAI error:`, openaiError);
    throw new Error(`OpenAI API error in product knowledge: ${openaiError instanceof Error ? openaiError.message : String(openaiError)}`);
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
    evidenceSources: hasProductData ? productKnowledge.metadata.tablesWithData : undefined,
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
  };
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
  
  // USE CONTROL PLANE CONTRACT when provided
  const actualContract = contract || AnswerContract.GENERAL_RESPONSE;
  
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
  
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `${AMBIENT_PRODUCT_CONTEXT}

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

If you're unsure whether something requires evidence, err on the side of asking the user to be more specific.`,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const answer = response.choices[0]?.message?.content || "I'm not sure how to help with that. Could you rephrase your question?";

  return {
    answer,
    intent: "general_assistance",
    intentClassification: classification,
    controlPlaneIntent: Intent.GENERAL_HELP,
    answerContract: actualContract,
    ssotMode: "none" as SSOTMode,
    dataSource: "general_knowledge",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Determine if the Open Assistant path should be used.
 * 
 * IMPORTANT: This function no longer performs intent classification.
 * The Control Plane (server/controlPlane/intent.ts) is the SOLE authority.
 */
export function shouldUseOpenAssistant(
  resolvedMeeting: SingleMeetingContext | null
): { useOpenAssistant: boolean } {
  return { useOpenAssistant: true };
}
