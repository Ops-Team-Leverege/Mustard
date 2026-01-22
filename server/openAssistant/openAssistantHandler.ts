/**
 * Open Assistant Handler
 * 
 * Purpose:
 * Extends the existing Slack/MCP flow with intent-driven branching.
 * NOT a parallel system - integrates into the existing orchestration flow.
 * 
 * Intent Routing:
 * - meeting_data: Delegates to existing SingleMeetingOrchestrator
 * - external_research: Uses ExternalResearch handler with citations
 * - general_assistance: Uses GPT-5 for general help (drafting, explanations)
 * - hybrid: Combines meeting data + external research
 * 
 * Key Principles:
 * - Preserve single-meeting guardrails when intent is meeting_data
 * - Default to general_assistance when intent is ambiguous (low friction)
 * - Never re-derive deterministic artifacts
 * - Explicit citations for external research
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
 * Handle external_research intent by fetching public information with citations.
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

  const formattedCitations = formatCitationsForDisplay(researchResult.citations);
  const fullAnswer = researchResult.answer + formattedCitations;

  return {
    answer: fullAnswer,
    intent: "external_research",
    intentClassification: classification,
    dataSource: "external_research",
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
  const citations = formatCitationsForDisplay(researchResult.citations);

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `You are synthesizing information from two sources to answer the user's question:

1. MEETING DATA (from internal records of past meetings):
${meetingContext}

2. EXTERNAL RESEARCH (from public sources):
${researchContext}

Combine these sources into a coherent, helpful answer. Be clear about which information comes from meeting records vs external research. If there are contradictions, note them.`,
      },
      {
        role: "user",
        content: originalQuery,
      },
    ],
  });

  const synthesizedAnswer = response.choices[0]?.message?.content || "Unable to synthesize response.";
  return synthesizedAnswer + citations;
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
