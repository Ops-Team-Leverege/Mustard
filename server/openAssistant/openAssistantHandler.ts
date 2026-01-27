/**
 * Open Assistant Handler
 * 
 * Purpose:
 * Extends the existing Slack/MCP flow with evidence-source-driven routing.
 * The assistant is fully open-ended in what it helps with - we only constrain
 * which evidence sources may back the response and what claims are allowed.
 * 
 * Evidence Source Routing:
 * - meeting_data: Claims backed by meeting artifacts → SingleMeetingOrchestrator
 * - external_research: Claims backed by fetched sources → ExternalResearch (citations required)
 * - general_assistance: General knowledge → GPT-5 (with disclaimers when needed)
 * - hybrid: Combines sources → each claim traced to its source
 * 
 * Key Principles:
 * - This is NOT task-type routing (write email, prep call, etc. are all allowed)
 * - Preserve single-meeting guardrails when meeting_data is the evidence source
 * - Default to general_assistance when source requirements are unclear
 * - Never re-derive deterministic artifacts
 * - When web search is available, external research requires explicit citations
 */

import { OpenAI } from "openai";
import { classifyIntent, needsClarification, type IntentClassification, type OpenAssistantIntent } from "./intentClassifier";
import { performExternalResearch, formatCitationsForDisplay, type ResearchResult } from "./externalResearch";
import { searchArtifactsSemanticly, formatArtifactResults, type ArtifactSearchResult } from "./semanticArtifactSearch";
import { handleSingleMeetingQuestion, type SingleMeetingContext, type SingleMeetingResult } from "../mcp/singleMeetingOrchestrator";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * AMBIENT PRODUCT CONTEXT (Always On)
 * 
 * Provides product identity and framing while explicitly restricting factual authority.
 * - Resolves "what product are we talking about?"
 * - Enables natural explanations and copywriting
 * - Does NOT authorize factual claims
 * 
 * Rules:
 * - Ambient context is not evidence
 * - Ambient context must never be cited as a source of truth
 * - Ambient context controls framing only
 */
const AMBIENT_PRODUCT_CONTEXT = `IMPORTANT: You are an AI assistant for PitCrew employees. There is only ONE PitCrew - the company you work for.

PitCrew Identity (established fact - do NOT ask "which PitCrew?"):
- PitCrew is a B2B SaaS company that sells vision AI solutions to automotive service businesses
- PitCrew is developed by Leverege
- Target customers: tire shops (Les Schwab, Discount Tire), oil change chains (Jiffy Lube, Valvoline), car washes, and similar automotive service businesses

When the user mentions "PitCrew" or asks about the product, they ALWAYS mean this PitCrew. Never ask for clarification about which PitCrew.

About PitCrew (for framing only - not authoritative claims):
- PitCrew uses computer vision and AI to analyze operations in automotive service bays
- It helps teams understand operational performance through video-based analytics
- The platform provides insights for improving throughput, consistency, and customer experience
- Key value: visibility into service operations, performance tracking, queue management

Authority rules:
- When authoritative product data is not provided, speak only at a high level about purpose, value, and outcomes
- Do not state or imply specific features, integrations, guarantees, pricing, or technical details unless Product SSOT data is explicitly provided`;

import { Intent, type IntentClassificationResult } from "../controlPlane/intent";
import { selectAnswerContract, AnswerContract, type SSOTMode } from "../controlPlane/answerContracts";
import { type ContextLayers } from "../controlPlane/contextLayers";

export type OpenAssistantContext = {
  userId?: string;
  threadId?: string;
  conversationContext?: string;
  resolvedMeeting?: SingleMeetingContext | null;
  controlPlaneIntent?: IntentClassificationResult;
};

export type OpenAssistantResult = {
  answer: string;
  intent: OpenAssistantIntent;
  intentClassification: IntentClassification;
  controlPlaneIntent?: Intent;
  answerContract?: AnswerContract;
  ssotMode?: SSOTMode;
  dataSource: "meeting_artifacts" | "external_research" | "general_knowledge" | "hybrid" | "clarification" | "product_ssot";
  researchCitations?: ResearchResult["citations"];
  artifactMatches?: ArtifactSearchResult;
  singleMeetingResult?: SingleMeetingResult;
  delegatedToSingleMeeting: boolean;
};

/**
 * Map control plane intent to evidence source intent for routing.
 */
function mapControlPlaneToEvidenceSource(cpIntent: Intent): OpenAssistantIntent {
  switch (cpIntent) {
    case Intent.SINGLE_MEETING:
    case Intent.MULTI_MEETING:
      return "meeting_data";
    case Intent.PRODUCT_KNOWLEDGE:
      return "general_assistance";
    case Intent.DOCUMENT_SEARCH:
      return "general_assistance";
    case Intent.GENERAL_HELP:
    case Intent.REFUSE:
    case Intent.CLARIFY:
    default:
      return "general_assistance";
  }
}

/**
 * Main entry point for Open Assistant.
 * 
 * Called from Slack events handler after initial processing (dedup, ack, etc.)
 * Routes to appropriate handler based on classified intent.
 * 
 * When a control plane intent is provided, it takes precedence over the
 * Open Assistant's own intent classification.
 */
export async function handleOpenAssistant(
  userMessage: string,
  context: OpenAssistantContext
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Processing: "${userMessage}"`);
  
  if (context.controlPlaneIntent) {
    const cpIntent = context.controlPlaneIntent;
    console.log(`[OpenAssistant] Using control plane intent: ${cpIntent.intent} (${cpIntent.intentDetectionMethod})`);
    
    if (cpIntent.intent === Intent.REFUSE) {
      return {
        answer: "I'm sorry, but that question is outside of what I can help with. I'm designed to assist with PitCrew-related topics, customer meetings, and product information.",
        intent: "general_assistance",
        intentClassification: defaultClassification("Refused by control plane"),
        controlPlaneIntent: cpIntent.intent,
        answerContract: AnswerContract.REFUSE,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
    
    if (cpIntent.intent === Intent.CLARIFY && cpIntent.needsSplit) {
      const splitMessage = cpIntent.splitOptions 
        ? `I can help with that, but let's do it one step at a time. Which would you like first: ${cpIntent.splitOptions.join(" or ")}?`
        : "I can help with that, but let's do it one step at a time. Could you tell me which part you'd like me to focus on first?";
      
      return {
        answer: splitMessage,
        intent: "general_assistance",
        intentClassification: defaultClassification("Split required by control plane"),
        controlPlaneIntent: cpIntent.intent,
        answerContract: AnswerContract.CLARIFY,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
    
    const mappedIntent = mapControlPlaneToEvidenceSource(cpIntent.intent);
    const fakeClassification: IntentClassification = {
      intent: mappedIntent,
      confidence: cpIntent.confidence > 0.8 ? "high" : cpIntent.confidence > 0.5 ? "medium" : "low",
      rationale: cpIntent.reason || "Mapped from control plane intent",
      meetingRelevance: {
        referencesSpecificInteraction: cpIntent.intent === Intent.SINGLE_MEETING,
        asksWhatWasSaidOrAgreed: false,
        asksAboutCustomerQuestions: false,
      },
      researchRelevance: {
        needsPublicInfo: false,
        companyOrEntityMentioned: null,
        topicForResearch: null,
      },
    };
    
    console.log(`[OpenAssistant] Mapped to evidence source: ${mappedIntent}`);
    
    if (cpIntent.intent === Intent.SINGLE_MEETING || cpIntent.intent === Intent.MULTI_MEETING) {
      return handleMeetingDataIntent(userMessage, context, fakeClassification);
    }
    
    if (cpIntent.intent === Intent.PRODUCT_KNOWLEDGE) {
      return handleProductKnowledgeIntent(userMessage, context, fakeClassification);
    }
    
    return handleGeneralAssistanceIntent(userMessage, context, fakeClassification);
  }
  
  const intentClassification = await classifyIntent(
    userMessage,
    context.conversationContext
  );
  
  console.log(`[OpenAssistant] Intent: ${intentClassification.intent} (${intentClassification.confidence})`);
  console.log(`[OpenAssistant] Rationale: ${intentClassification.rationale}`);

  const clarificationPrompt = needsClarification(intentClassification);
  if (clarificationPrompt) {
    return {
      answer: clarificationPrompt,
      intent: intentClassification.intent,
      intentClassification,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }

  switch (intentClassification.intent) {
    case "meeting_data":
      return handleMeetingDataIntent(userMessage, context, intentClassification);
    
    case "external_research":
      return handleExternalResearchIntent(userMessage, context, intentClassification);
    
    case "general_assistance":
      return handleGeneralAssistanceIntent(userMessage, context, intentClassification);
    
    case "hybrid":
      return handleHybridIntent(userMessage, context, intentClassification);
    
    default:
      return handleGeneralAssistanceIntent(userMessage, context, intentClassification);
  }
}

function defaultClassification(rationale: string): IntentClassification {
  return {
    intent: "general_assistance",
    confidence: "low",
    rationale,
    meetingRelevance: {
      referencesSpecificInteraction: false,
      asksWhatWasSaidOrAgreed: false,
      asksAboutCustomerQuestions: false,
    },
    researchRelevance: {
      needsPublicInfo: false,
      companyOrEntityMentioned: null,
      topicForResearch: null,
    },
  };
}

/**
 * Handle meeting_data intent by delegating to SingleMeetingOrchestrator.
 * Preserves all existing guardrails and artifact read-only constraints.
 * 
 * When no meeting is resolved, attempts to find relevant meetings by:
 * 1. Extracting company/person names from the query
 * 2. Searching for meetings with matching companies/contacts
 * 3. Delegating to single meeting if one match, or searching across if multiple
 */
async function handleMeetingDataIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to meeting data path`);
  
  // If meeting is already resolved, delegate directly
  if (context.resolvedMeeting) {
    const singleMeetingResult = await handleSingleMeetingQuestion(
      context.resolvedMeeting,
      userMessage,
      false
    );

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
      answerContract: AnswerContract.MEETING_SUMMARY,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
    };
  }

  // No meeting resolved - try to find relevant meetings
  console.log(`[OpenAssistant] No meeting resolved, searching for relevant meetings`);
  
  const meetingSearch = await findRelevantMeetings(userMessage, classification);
  
  if (meetingSearch.meetings.length === 0) {
    // No meetings found - provide helpful response
    return {
      answer: `I searched for meetings related to your question but couldn't find any matching transcripts. ${meetingSearch.searchedFor ? `I looked for: ${meetingSearch.searchedFor}` : ''}\n\nCould you provide more details about which customer or meeting you're asking about?`,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
      answerContract: AnswerContract.MEETING_SUMMARY,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      delegatedToSingleMeeting: false,
    };
  }

  if (meetingSearch.meetings.length === 1) {
    // Single meeting found - delegate to SingleMeetingOrchestrator
    const meeting = meetingSearch.meetings[0];
    console.log(`[OpenAssistant] Found single meeting: ${meeting.companyName} (${meeting.meetingId})`);
    
    const singleMeetingResult = await handleSingleMeetingQuestion(
      meeting,
      userMessage,
      false
    );

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
      answerContract: AnswerContract.MEETING_SUMMARY,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
    };
  }

  // Multiple meetings found - search across them
  console.log(`[OpenAssistant] Found ${meetingSearch.meetings.length} meetings, searching across`);
  const crossMeetingResult = await searchAcrossMeetings(userMessage, meetingSearch.meetings);
  
  return {
    answer: crossMeetingResult,
    intent: "meeting_data",
    intentClassification: classification,
    controlPlaneIntent: Intent.MULTI_MEETING,
    answerContract: AnswerContract.MEETING_SUMMARY,
    ssotMode: "none" as SSOTMode,
    dataSource: "meeting_artifacts",
    artifactMatches: undefined,
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle external_research intent.
 * 
 * Note: Web search is not yet integrated. When citations are empty,
 * the response is general knowledge with a clear disclaimer.
 */
async function handleExternalResearchIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to external research path`);
  
  const researchResult = await performExternalResearch(
    userMessage,
    classification.researchRelevance.companyOrEntityMentioned,
    classification.researchRelevance.topicForResearch
  );

  const hasCitations = researchResult.citations.length > 0;
  const formattedCitations = formatCitationsForDisplay(researchResult.citations);
  
  let fullAnswer = researchResult.answer;
  if (hasCitations) {
    fullAnswer += formattedCitations;
  } else if (researchResult.disclaimer) {
    fullAnswer += `\n\n_${researchResult.disclaimer}_`;
  }

  return {
    answer: fullAnswer,
    intent: "external_research",
    intentClassification: classification,
    dataSource: hasCitations ? "external_research" : "general_knowledge",
    researchCitations: researchResult.citations,
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle general_assistance intent using GPT-5 for general help.
 * 
 * Uses ambient product context for framing but does NOT make authoritative claims
 * about product features, pricing, or integrations without Product SSOT.
 */
async function handleGeneralAssistanceIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to general assistance path`);
  
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `${AMBIENT_PRODUCT_CONTEXT}

You are a helpful business assistant for the PitCrew team. Provide clear, professional help with the user's request.

You can help with:
- Drafting emails, messages, and documents
- Explaining concepts and answering general questions
- Providing suggestions and recommendations
- Helping with planning and organization

IMPORTANT CONSTRAINTS:
- Do NOT make specific claims about PitCrew features, pricing, or integrations
- If asked about product specifics, say you'd need to check the product documentation
- For meeting-related questions, suggest they ask about a specific meeting
- Be direct and helpful. If you're unsure about something, say so.`,
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
    dataSource: "general_knowledge",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle PRODUCT_KNOWLEDGE intent with proper authority control.
 * 
 * Uses ambient context for framing and descriptive explanations.
 * For authoritative claims (features, pricing, integrations), requires Product SSOT.
 * 
 * TODO: Integrate Airtable Product SSOT for authoritative claims.
 */
async function handleProductKnowledgeIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to product knowledge path`);
  
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `${AMBIENT_PRODUCT_CONTEXT}

You are answering a product knowledge question about PitCrew.

AUTHORITY RULES:
- For general "how does it work" questions: Provide high-level explanations about purpose, value, and outcomes
- For specific feature questions: Say what you know at a high level, but add "I'd recommend checking our product documentation for the latest details"
- For pricing questions: Say "For current pricing information, please check with the sales team or product documentation"
- For integration questions: Provide general framing but note that specific integration details should be verified

NEVER fabricate specific:
- Pricing numbers or tiers
- Integration compatibility claims
- Feature availability by tier
- Technical specifications

Keep responses helpful but appropriately bounded by what can be safely stated without authoritative product data.`,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const answer = response.choices[0]?.message?.content || "I'd be happy to help with product information. Could you be more specific about what you'd like to know?";

  return {
    answer,
    intent: "meeting_data", // Maps to "product_knowledge" for logging
    intentClassification: classification,
    controlPlaneIntent: Intent.PRODUCT_KNOWLEDGE,
    answerContract: AnswerContract.PRODUCT_EXPLANATION,
    ssotMode: "descriptive",
    dataSource: "product_ssot", // Indicates product context was used
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle hybrid intent by combining meeting data and external research.
 */
async function handleHybridIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to hybrid path (meeting + research)`);
  
  const [meetingDataResult, researchResult] = await Promise.all([
    context.resolvedMeeting 
      ? handleMeetingDataIntent(userMessage, context, classification)
      : Promise.resolve(null),
    performExternalResearch(
      userMessage,
      classification.researchRelevance.companyOrEntityMentioned,
      classification.researchRelevance.topicForResearch
    ),
  ]);

  const synthesized = await synthesizeHybridResponse(
    userMessage,
    meetingDataResult,
    researchResult,
    classification
  );

  return {
    answer: synthesized,
    intent: "hybrid",
    intentClassification: classification,
    dataSource: "hybrid",
    researchCitations: researchResult.citations,
    singleMeetingResult: meetingDataResult?.singleMeetingResult,
    delegatedToSingleMeeting: Boolean(meetingDataResult?.delegatedToSingleMeeting),
  };
}

/**
 * Synthesize a response combining meeting data and external research.
 */
async function synthesizeHybridResponse(
  originalQuery: string,
  meetingResult: OpenAssistantResult | null,
  researchResult: ResearchResult,
  classification: IntentClassification
): Promise<string> {
  const meetingContext = meetingResult?.answer || "No meeting data available.";
  const researchContext = researchResult.answer || "No external research results.";
  const hasCitations = researchResult.citations.length > 0;
  const citations = formatCitationsForDisplay(researchResult.citations);

  const researchNote = hasCitations 
    ? "from public sources" 
    : "based on general knowledge (web search not currently available)";

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `You are synthesizing information from two sources to answer the user's question:

1. MEETING DATA (from internal records of past meetings):
${meetingContext}

2. EXTERNAL INFORMATION (${researchNote}):
${researchContext}

Combine these sources into a coherent, helpful answer. Be clear about which information comes from meeting records vs external sources. If there are contradictions, note them.`,
      },
      {
        role: "user",
        content: originalQuery,
      },
    ],
  });

  const synthesizedAnswer = response.choices[0]?.message?.content || "Unable to synthesize response.";
  
  if (hasCitations) {
    return synthesizedAnswer + citations;
  } else if (researchResult.disclaimer) {
    return synthesizedAnswer + `\n\n_${researchResult.disclaimer}_`;
  }
  return synthesizedAnswer;
}

/**
 * Find relevant meetings based on company/person names in the query.
 * Uses fuzzy matching on company names and contact names.
 */
type MeetingSearchResult = {
  meetings: SingleMeetingContext[];
  searchedFor: string;
};

async function findRelevantMeetings(
  userMessage: string,
  classification: IntentClassification
): Promise<MeetingSearchResult> {
  const { storage } = await import("../storage");
  
  // Extract search terms from the message
  const searchTerms = extractSearchTerms(userMessage);
  console.log(`[OpenAssistant] Searching for meetings with terms: ${searchTerms.join(", ")}`);
  
  // If no terms extracted, try a broad fallback search using key words from the message
  if (searchTerms.length === 0) {
    console.log(`[OpenAssistant] No search terms extracted, trying fallback word search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: "(fallback search)" 
    };
  }

  // Search for companies matching any of the terms
  const companyMatches = await searchCompanies(searchTerms);
  
  if (companyMatches.length === 0) {
    // Try searching contacts/attendees
    const contactMatches = await searchContacts(searchTerms);
    if (contactMatches.length > 0) {
      return {
        meetings: contactMatches,
        searchedFor: searchTerms.join(", "),
      };
    }
    
    // Still no matches - try fallback search
    console.log(`[OpenAssistant] No company/contact matches, trying fallback search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: searchTerms.join(", ") + " (+ fallback)" 
    };
  }

  // Get the most recent meeting for each matching company
  const meetings: SingleMeetingContext[] = [];
  for (const company of companyMatches) {
    const transcriptRows = await storage.rawQuery(`
      SELECT t.id, t.meeting_date, c.name as company_name, c.id as company_id
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      WHERE t.company_id = $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
      LIMIT 1
    `, [company.id]);

    if (transcriptRows && transcriptRows.length > 0) {
      const row = transcriptRows[0];
      meetings.push({
        meetingId: row.id as string,
        companyId: row.company_id as string,
        companyName: row.company_name as string,
        meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
      });
    }
  }

  return {
    meetings,
    searchedFor: searchTerms.join(", "),
  };
}

/**
 * Fallback search: extract significant words and search companies directly.
 * Used when extractSearchTerms fails to find proper nouns/acronyms.
 */
async function fallbackMeetingSearch(message: string): Promise<SingleMeetingContext[]> {
  const { storage } = await import("../storage");
  
  // Extract significant words (3+ chars, not common stop words)
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", 
    "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
    "how", "its", "let", "may", "new", "now", "old", "see", "way", "who",
    "did", "does", "what", "when", "where", "which", "while", "with", "about",
    "said", "they", "this", "that", "from", "have", "been", "some", "could",
    "would", "should", "their", "there", "these", "those", "being", "other",
  ]);
  
  const words = message
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()));
  
  console.log(`[OpenAssistant] Fallback search words: ${words.join(", ")}`);
  
  // Try each word as a company search
  const meetings: SingleMeetingContext[] = [];
  const seenCompanyIds = new Set<string>();
  
  for (const word of words.slice(0, 5)) { // Limit to first 5 words
    const rows = await storage.rawQuery(`
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, c.id as company_id, c.name as company_name
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      WHERE c.name ILIKE $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
      LIMIT 2
    `, [`%${word}%`]);
    
    if (rows) {
      for (const row of rows) {
        if (!seenCompanyIds.has(row.company_id as string)) {
          seenCompanyIds.add(row.company_id as string);
          meetings.push({
            meetingId: row.meeting_id as string,
            companyId: row.company_id as string,
            companyName: row.company_name as string,
            meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
          });
        }
      }
    }
  }
  
  return meetings;
}

/**
 * Extract company/person names from user message.
 * Handles:
 * - Proper nouns (Tyler Wiggins, Les Schwab)
 * - All-caps acronyms (ACE, IT, ROI)
 * - Mixed case (iPhone, PitCrew)
 * - Quoted strings
 */
function extractSearchTerms(message: string): string[] {
  const terms: string[] = [];
  
  // Common words to filter out (lowercase for comparison)
  const commonWords = new Set([
    "what", "who", "where", "when", "why", "how", "the", "this", "that", 
    "can", "could", "would", "should", "did", "does", "do", "is", "are", 
    "was", "were", "has", "have", "had", "will", "shall", "may", "might", 
    "must", "find", "show", "tell", "give", "help", "get", "let", "make", 
    "want", "need", "like", "think", "know", "say", "said", "about", "from",
    "with", "for", "and", "or", "but", "not", "all", "any", "some", "their",
    "they", "them", "our", "we", "you", "your", "its", "his", "her", "him",
    "she", "he", "it", "be", "been", "being", "am", "an", "a", "to", "of",
    "in", "on", "at", "by", "up", "out", "if", "so", "no", "yes", "my",
    "roi", "tv", "api", "it", // common acronyms that aren't company names
  ]);
  
  // 1. Match proper nouns (capitalized words like Tyler Wiggins, Les Schwab)
  const properNounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let match;
  while ((match = properNounPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase())) {
      terms.push(term);
    }
  }

  // 2. Match all-caps acronyms (ACE, HVAC, POS) - 2-10 uppercase letters
  const acronymPattern = /\b([A-Z]{2,10})\b/g;
  while ((match = acronymPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase())) {
      terms.push(term);
    }
  }

  // 3. Match multi-word company names with mixed case (e.g., Jiffy Lube, Les Schwab)
  const multiWordPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)+)\b/g;
  while ((match = multiWordPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase()) && term.split(" ").length <= 4) {
      terms.push(term);
    }
  }

  // 4. Quoted strings
  const quotedPattern = /"([^"]+)"/g;
  while ((match = quotedPattern.exec(message)) !== null) {
    terms.push(match[1]);
  }

  return Array.from(new Set(terms)); // Dedupe
}

/**
 * Search companies by fuzzy name matching.
 */
async function searchCompanies(searchTerms: string[]): Promise<Array<{ id: string; name: string }>> {
  const { storage } = await import("../storage");
  const results: Array<{ id: string; name: string }> = [];

  for (const term of searchTerms) {
    // Use ILIKE for case-insensitive partial matching
    const rows = await storage.rawQuery(`
      SELECT id, name FROM companies 
      WHERE name ILIKE $1 OR name ILIKE $2
      LIMIT 5
    `, [`%${term}%`, `${term}%`]);

    if (rows) {
      for (const row of rows) {
        if (!results.find(r => r.id === row.id)) {
          results.push({ id: row.id as string, name: row.name as string });
        }
      }
    }
  }

  return results;
}

/**
 * Search contacts/attendees and return their meetings.
 */
async function searchContacts(searchTerms: string[]): Promise<SingleMeetingContext[]> {
  const { storage } = await import("../storage");
  const meetings: SingleMeetingContext[] = [];

  for (const term of searchTerms) {
    // Search in transcript attendees (contacts)
    const rows = await storage.rawQuery(`
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, c.id as company_id, c.name as company_name
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      LEFT JOIN contacts ct ON ct.company_id = c.id
      WHERE ct.name ILIKE $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
      LIMIT 3
    `, [`%${term}%`]);

    if (rows) {
      for (const row of rows) {
        if (!meetings.find(m => m.meetingId === row.meeting_id)) {
          meetings.push({
            meetingId: row.meeting_id as string,
            companyId: row.company_id as string,
            companyName: row.company_name as string,
            meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
          });
        }
      }
    }
  }

  return meetings;
}

/**
 * Search across multiple meetings for relevant information.
 */
async function searchAcrossMeetings(
  userMessage: string,
  meetings: SingleMeetingContext[]
): Promise<string> {
  console.log(`[OpenAssistant] Searching across ${meetings.length} meetings`);
  
  // Collect results from each meeting
  const allResults: Array<{
    companyName: string;
    meetingDate: string;
    answer: string;
  }> = [];

  for (const meeting of meetings.slice(0, 5)) { // Limit to 5 meetings
    try {
      const result = await handleSingleMeetingQuestion(meeting, userMessage, false);
      if (result.dataSource !== "not_found") {
        allResults.push({
          companyName: meeting.companyName,
          meetingDate: meeting.meetingDate?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "Unknown date",
          answer: result.answer,
        });
      }
    } catch (err) {
      console.error(`[OpenAssistant] Error searching meeting ${meeting.meetingId}:`, err);
    }
  }

  if (allResults.length === 0) {
    return `I searched across ${meetings.length} meeting(s) with ${meetings.map(m => m.companyName).join(", ")}, but couldn't find information related to your question.`;
  }

  // Format combined response
  const formattedResults = allResults.map(r => 
    `**${r.companyName}** (${r.meetingDate}):\n${r.answer}`
  ).join("\n\n---\n\n");

  return `Here's what I found across ${allResults.length} meeting(s):\n\n${formattedResults}`;
}

/**
 * Determine if the Open Assistant path should be used.
 * 
 * The Open Assistant path is used when:
 * - No meeting is resolved AND user intent appears to be general assistance/research
 * - OR user explicitly asks for research or general help
 * 
 * The existing single-meeting path is used when:
 * - Meeting is resolved AND user intent is meeting_data
 */
export async function shouldUseOpenAssistant(
  userMessage: string,
  resolvedMeeting: SingleMeetingContext | null
): Promise<{ useOpenAssistant: boolean; classification?: IntentClassification }> {
  if (resolvedMeeting) {
    return { useOpenAssistant: false };
  }

  const classification = await classifyIntent(userMessage);
  
  if (classification.intent === "meeting_data" && classification.meetingRelevance.referencesSpecificInteraction) {
    return { useOpenAssistant: false, classification };
  }

  return { useOpenAssistant: true, classification };
}
