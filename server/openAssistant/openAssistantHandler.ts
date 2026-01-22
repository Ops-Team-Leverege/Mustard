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

export type OpenAssistantContext = {
  userId?: string;
  threadId?: string;
  conversationContext?: string;
  resolvedMeeting?: SingleMeetingContext | null;
};

export type OpenAssistantResult = {
  answer: string;
  intent: OpenAssistantIntent;
  intentClassification: IntentClassification;
  dataSource: "meeting_artifacts" | "external_research" | "general_knowledge" | "hybrid" | "clarification";
  researchCitations?: ResearchResult["citations"];
  artifactMatches?: ArtifactSearchResult;
  singleMeetingResult?: SingleMeetingResult;
  delegatedToSingleMeeting: boolean;
};

/**
 * Main entry point for Open Assistant.
 * 
 * Called from Slack events handler after initial processing (dedup, ack, etc.)
 * Routes to appropriate handler based on classified intent.
 */
export async function handleOpenAssistant(
  userMessage: string,
  context: OpenAssistantContext
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Processing: "${userMessage}"`);
  
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

/**
 * Handle meeting_data intent by delegating to SingleMeetingOrchestrator.
 * Preserves all existing guardrails and Tier-1 constraints.
 */
async function handleMeetingDataIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to meeting data path`);
  
  if (!context.resolvedMeeting) {
    return {
      answer: "I'd like to help you find meeting information, but I need to know which company or meeting you're referring to. Could you specify the company name or meeting?",
      intent: "meeting_data",
      intentClassification: classification,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }

  const singleMeetingResult = await handleSingleMeetingQuestion(
    context.resolvedMeeting,
    userMessage,
    false
  );

  return {
    answer: singleMeetingResult.answer,
    intent: "meeting_data",
    intentClassification: classification,
    dataSource: "meeting_artifacts",
    singleMeetingResult,
    delegatedToSingleMeeting: true,
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
        content: `You are a helpful business assistant. Provide clear, professional help with the user's request.

You can help with:
- Drafting emails, messages, and documents
- Explaining concepts and answering general questions
- Providing suggestions and recommendations
- Helping with planning and organization

Be direct and helpful. If you're unsure about something, say so.`,
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
