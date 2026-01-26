/**
 * Open Assistant Evidence Source Classifier
 * 
 * Purpose:
 * Classifies which EVIDENCE SOURCES are appropriate for answering, NOT the task type.
 * The assistant is fully open-ended in what it helps with (write email, prep call, etc.)
 * - we only constrain which sources may back the response and what claims are allowed.
 * 
 * Evidence Sources:
 * - meeting_data: Claims must be backed by meeting artifacts (read-only or transcript)
 * - external_research: Claims must be backed by fetched sources with citations
 * - general_assistance: General knowledge (with appropriate disclaimers)
 * - hybrid: Combines sources (each claim traced to its source)
 * 
 * Key Principles:
 * - Default to general_assistance when evidence requirements are unclear (low friction)
 * - Only trigger meeting_data when user clearly references interactions
 * - This is NOT task-type routing - the assistant helps with any task
 * 
 * Uses GPT-5 for accuracy since this gates meeting data access.
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

const INTENT_CLASSIFICATION_PROMPT = `You are an intent classifier for PitCrew's internal Sales Assistant.

CONTEXT ABOUT PITCREW:
PitCrew is a B2B SaaS company that sells vision AI solutions to automotive service businesses (tire shops, oil change chains, car washes). The assistant helps PitCrew's Business Development team by providing insights from their customer/prospect meetings.

DATA SOURCES AVAILABLE:
1. **Meeting Transcripts Database**: Contains transcripts from BD calls with prospects/customers like:
   - Automotive companies: Les Schwab, Jiffy Lube, ACE Hardware, Discount Tire, Valvoline, etc.
   - Customer contacts: Names like Tyler Wiggins, Randy Hentschke, Robert Colongo, etc.
   - Extracted artifacts: customer questions, action items, meeting summaries, attendees
   
2. **External Web Search**: For public company information, industry research, competitor analysis

3. **General Knowledge**: For drafting, explanations, and non-data-dependent help

YOUR TASK: Classify into ONE of these intents:
- "meeting_data": Questions about what happened in meetings, what customers said, asked, or agreed to
- "external_research": Questions requiring public/external information (stock prices, news, industry data)
- "general_assistance": Drafting help, explanations, or tasks not requiring specific meeting/external data
- "hybrid": Questions needing BOTH meeting data AND external research

KEY DECISION RULES:

**USE meeting_data when the question:**
- Asks what someone SAID, MENTIONED, ASKED, SUGGESTED, or AGREED TO
- References a specific person by name (these are likely customer contacts from meetings)
- References a specific company that could be a prospect/customer
- Asks about meeting outcomes, action items, next steps, or follow-ups
- Uses phrases: "what did", "did they", "what concerns", "what questions", "what feedback"
- Asks to summarize or find information from meetings
- Compares what different customers said

**USE general_assistance when:**
- It's a generic question with NO reference to specific people/companies
- It's asking for help drafting something without referencing meeting content
- It's asking to explain a concept or answer a general knowledge question
- It's a greeting or meta-question about the assistant itself

**USE external_research when:**
- Asking about PUBLIC information (stock prices, funding, news, industry reports)
- The answer requires searching the internet for current/external data
- It's market research or competitor analysis from public sources

**CRITICAL: When in doubt, PREFER meeting_data over general_assistance if:**
- ANY specific person name appears (assume they're a customer contact)
- ANY company name appears that could be a prospect/customer
- The question pattern matches "What did X say/mention/ask about..."

EXAMPLES:
- "What did Tyler Wiggins say about the new TV?" → meeting_data (person name = likely customer contact)
- "What did Les Schwab say about the dashboard?" → meeting_data (company = likely customer)
- "What concerns has ACE raised about pricing?" → meeting_data (customer feedback question)
- "What did Randy Hentschke suggest about dashboard terminology?" → meeting_data (person + "suggest")
- "Compare what Les Schwab and ACE said about TV dashboards" → meeting_data (multi-customer comparison)
- "What cameras does PitCrew recommend for ACE?" → meeting_data (recommendation discussed in meeting)
- "Find all meetings with Walmart and summarize" → meeting_data (meeting search)
- "What concerns have customers raised about competitors?" → meeting_data (aggregated customer feedback)
- "What objections might come up in a call with IT?" → meeting_data (likely discussed in past meetings)
- "What's the ROI of PitCrew for Jiffy Lube franchises?" → meeting_data (customer-specific value prop)
- "Research Acme Corp's recent funding" → external_research (public info)
- "What's the stock price of Discount Tire?" → external_research (public financial data)
- "Help me draft a generic follow-up email template" → general_assistance (no meeting reference)
- "What's the difference between REST and GraphQL?" → general_assistance (general explanation)
- "Hello, what can you help me with?" → general_assistance (greeting/meta)

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
