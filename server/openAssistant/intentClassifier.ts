/**
 * Open Assistant Intent Classifier
 * 
 * Purpose:
 * Classifies user intent to determine the appropriate response path.
 * Uses GPT-5 for accuracy since this gates meeting data access.
 * 
 * Intent Types:
 * - meeting_data: User wants information from what was said/agreed/asked in meetings
 * - external_research: User wants public information about a company/topic
 * - general_assistance: User wants help with drafting, explanations, general knowledge
 * - hybrid: User needs multiple types (e.g., research + meeting context)
 * 
 * Key Principles:
 * - Default to general_assistance when intent is ambiguous (low friction)
 * - Only trigger meeting_data when user clearly references interactions
 * - Never use keywords alone to determine intent (semantic understanding required)
 */

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type OpenAssistantIntent = 
  | "meeting_data"
  | "external_research" 
  | "general_assistance"
  | "hybrid";

export type IntentClassification = {
  intent: OpenAssistantIntent;
  confidence: "high" | "medium" | "low";
  rationale: string;
  meetingRelevance: {
    referencesSpecificInteraction: boolean;
    asksWhatWasSaidOrAgreed: boolean;
    asksAboutCustomerQuestions: boolean;
  };
  researchRelevance: {
    needsPublicInfo: boolean;
    companyOrEntityMentioned: string | null;
    topicForResearch: string | null;
  };
  suggestedClarification?: string;
};

const INTENT_CLASSIFICATION_PROMPT = `You are an intent classifier for a business assistant that has access to:
1. Meeting transcripts with extracted customer questions, action items, and summaries
2. External web search for public company/market research
3. General knowledge for drafting, explanations, and assistance

Your job is to classify the user's intent into ONE of these categories:
- "meeting_data": User wants information from past meetings (what was said, agreed, asked, who attended, action items, outcomes)
- "external_research": User wants public information about a company, market, industry, or topic that would require web search
- "general_assistance": User wants help with drafting, explanations, general knowledge, or tasks not requiring meeting data or research
- "hybrid": User needs BOTH meeting data AND external research to answer properly

CRITICAL RULES:
1. Do NOT use keywords to determine intent. "Meeting" appearing in a question doesn't mean meeting_data is needed.
2. meeting_data is ONLY for questions about what happened in recorded interactions (calls, meetings, demos)
3. When intent is unclear or ambiguous, default to "general_assistance" (low friction, low risk)
4. Only return "meeting_data" when the user is CLEARLY asking about:
   - What was said or discussed in a specific interaction
   - What the customer asked or agreed to
   - Action items or next steps from a meeting
   - Who attended a call
   - Outcomes from a specific interaction

Examples:
- "What did the customer ask about pricing?" → meeting_data (asks what was said)
- "Research Acme Corp's recent funding" → external_research (public info needed)
- "Help me draft an email follow-up" → general_assistance (drafting task)
- "What's the difference between REST and GraphQL?" → general_assistance (explanation)
- "What concerns did they raise and how does that compare to industry trends?" → hybrid (meeting + research)
- "Prepare talking points for my next call" → general_assistance (drafting, not referencing past meeting content)
- "What should I know about their tech stack?" → external_research (public info, not meeting content)

Respond with a JSON object containing your classification.`;

export async function classifyIntent(
  userMessage: string,
  conversationContext?: string
): Promise<IntentClassification> {
  const userContent = conversationContext 
    ? `Conversation context: ${conversationContext}\n\nUser message: ${userMessage}`
    : userMessage;

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return defaultClassification("No response from classifier");
  }

  try {
    const parsed = JSON.parse(content);
    return {
      intent: validateIntent(parsed.intent),
      confidence: validateConfidence(parsed.confidence),
      rationale: parsed.rationale || "No rationale provided",
      meetingRelevance: {
        referencesSpecificInteraction: Boolean(parsed.meetingRelevance?.referencesSpecificInteraction),
        asksWhatWasSaidOrAgreed: Boolean(parsed.meetingRelevance?.asksWhatWasSaidOrAgreed),
        asksAboutCustomerQuestions: Boolean(parsed.meetingRelevance?.asksAboutCustomerQuestions),
      },
      researchRelevance: {
        needsPublicInfo: Boolean(parsed.researchRelevance?.needsPublicInfo),
        companyOrEntityMentioned: parsed.researchRelevance?.companyOrEntityMentioned || null,
        topicForResearch: parsed.researchRelevance?.topicForResearch || null,
      },
      suggestedClarification: parsed.suggestedClarification,
    };
  } catch (err) {
    console.error("[IntentClassifier] Failed to parse response:", err);
    return defaultClassification("Failed to parse classifier response");
  }
}

function validateIntent(intent: unknown): OpenAssistantIntent {
  const validIntents: OpenAssistantIntent[] = ["meeting_data", "external_research", "general_assistance", "hybrid"];
  if (typeof intent === "string" && validIntents.includes(intent as OpenAssistantIntent)) {
    return intent as OpenAssistantIntent;
  }
  return "general_assistance"; // Safe default
}

function validateConfidence(confidence: unknown): "high" | "medium" | "low" {
  const validConfidences = ["high", "medium", "low"];
  if (typeof confidence === "string" && validConfidences.includes(confidence)) {
    return confidence as "high" | "medium" | "low";
  }
  return "medium";
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
 * Determine if clarification is needed before proceeding.
 * 
 * Returns a clarification prompt ONLY when:
 * 1. User clearly references a specific interaction AND
 * 2. Answering without meeting context would likely be misleading
 * 
 * Otherwise returns null (proceed without clarification).
 */
export function needsClarification(classification: IntentClassification): string | null {
  if (classification.suggestedClarification && 
      classification.confidence === "low" &&
      classification.meetingRelevance.referencesSpecificInteraction) {
    return classification.suggestedClarification;
  }
  return null;
}
