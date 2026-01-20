import OpenAI from "openai";
import { storage } from "../storage";
import type { CustomerQuestion, MeetingActionItem, TranscriptChunk } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000,
  maxRetries: 1,
});

export type SemanticAnswerResult = {
  answer: string;
  confidence: "high" | "medium" | "low";
  evidenceSources: string[];
};

interface MeetingContext {
  meetingId: string;
  companyName: string;
  meetingDate?: Date | null;
  leverageTeam: string[];
  customerNames: string[];
  customerQuestions: CustomerQuestion[];
  actionItems: MeetingActionItem[];
  transcriptChunks: TranscriptChunk[];
}

const SYSTEM_PROMPT = `You are answering a user's question about a single meeting.

RULES:
- You may ONLY use the provided meeting data.
- Do NOT infer facts that are not stated or strongly implied.
- If the answer is uncertain, say so explicitly.
- Do NOT summarize the entire meeting unless asked.
- Do NOT mention other meetings.
- Prefer precise, factual phrasing.
- Always quote evidence from the meeting when possible.
- Use Slack markdown formatting (*bold* for emphasis, _italics_ for quotes).

If relevant information exists, explain it clearly with supporting quotes.
If not, say what was discussed instead, without speculation.

CONFIDENCE ASSESSMENT:
At the end of your response, on a new line, add exactly one of:
[CONFIDENCE: high] - Answer is directly supported by meeting data
[CONFIDENCE: medium] - Answer is reasonably inferred from context
[CONFIDENCE: low] - Answer is uncertain or partially supported`;

function formatMeetingDate(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildContextWindow(ctx: MeetingContext): string {
  const sections: string[] = [];
  const dateSuffix = ctx.meetingDate ? ` (${formatMeetingDate(ctx.meetingDate)})` : "";
  
  sections.push(`# Meeting with ${ctx.companyName}${dateSuffix}`);
  
  if (ctx.leverageTeam.length > 0 || ctx.customerNames.length > 0) {
    sections.push(`\n## Attendees`);
    if (ctx.leverageTeam.length > 0) {
      sections.push(`Leverege Team: ${ctx.leverageTeam.join(", ")}`);
    }
    if (ctx.customerNames.length > 0) {
      sections.push(`Customer: ${ctx.customerNames.join(", ")}`);
    }
  }
  
  if (ctx.customerQuestions.length > 0) {
    sections.push(`\n## Customer Questions (Verbatim)`);
    ctx.customerQuestions.forEach((q, i) => {
      let entry = `${i + 1}. "${q.questionText}"`;
      if (q.askedByName) {
        entry += ` — ${q.askedByName}`;
      }
      sections.push(entry);
      if (q.status === "ANSWERED" && q.answerEvidence) {
        sections.push(`   Answer: "${q.answerEvidence}"`);
        if (q.answeredByName) {
          sections.push(`   — ${q.answeredByName}`);
        }
      } else if (q.status === "OPEN") {
        sections.push(`   (Left open in meeting)`);
      }
    });
  }
  
  if (ctx.actionItems.length > 0) {
    sections.push(`\n## Action Items / Next Steps`);
    ctx.actionItems.forEach((item, i) => {
      sections.push(`${i + 1}. ${item.actionText} — ${item.ownerName}`);
      if (item.deadline && item.deadline !== "Not specified") {
        sections.push(`   Deadline: ${item.deadline}`);
      }
      sections.push(`   Evidence: "${item.evidenceQuote}"`);
    });
  }
  
  if (ctx.transcriptChunks.length > 0) {
    sections.push(`\n## Relevant Transcript Excerpts`);
    ctx.transcriptChunks.slice(0, 5).forEach((chunk, i) => {
      const speaker = chunk.speakerName || "Unknown";
      const content = chunk.content.length > 500 
        ? chunk.content.substring(0, 500) + "..." 
        : chunk.content;
      sections.push(`\n[${i + 1}] ${speaker}:\n"${content}"`);
    });
  }
  
  return sections.join("\n");
}

function parseConfidence(response: string): { answer: string; confidence: "high" | "medium" | "low" } {
  const confidenceMatch = response.match(/\[CONFIDENCE:\s*(high|medium|low)\]/i);
  let confidence: "high" | "medium" | "low" = "medium";
  let answer = response;
  
  if (confidenceMatch) {
    confidence = confidenceMatch[1].toLowerCase() as "high" | "medium" | "low";
    answer = response.replace(/\[CONFIDENCE:\s*(high|medium|low)\]/i, "").trim();
  }
  
  return { answer, confidence };
}

export async function semanticAnswerSingleMeeting(
  meetingId: string,
  companyName: string,
  userQuestion: string,
  meetingDate?: Date | null,
): Promise<SemanticAnswerResult> {
  console.log(`[SemanticAnswer] Starting for meeting ${meetingId}`);
  const startTime = Date.now();
  
  const [transcript, customerQuestions, actionItems, chunks] = await Promise.all([
    storage.getTranscriptById(meetingId),
    storage.getCustomerQuestionsByTranscript(meetingId),
    storage.getMeetingActionItemsByTranscript(meetingId),
    storage.getChunksForTranscript(meetingId, 10),
  ]);
  
  console.log(`[SemanticAnswer] Data fetch: ${Date.now() - startTime}ms`);
  
  const leverageTeam = transcript?.leverageTeam 
    ? transcript.leverageTeam.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const customerNames = transcript?.customerNames
    ? transcript.customerNames.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  
  const context: MeetingContext = {
    meetingId,
    companyName,
    meetingDate,
    leverageTeam,
    customerNames,
    customerQuestions,
    actionItems,
    transcriptChunks: chunks,
  };
  
  const contextWindow = buildContextWindow(context);
  console.log(`[SemanticAnswer] Context window: ${contextWindow.length} chars`);
  
  const evidenceSources: string[] = [];
  if (customerQuestions.length > 0) evidenceSources.push("customer_questions");
  if (actionItems.length > 0) evidenceSources.push("action_items");
  if (chunks.length > 0) evidenceSources.push("transcript_chunks");
  if (leverageTeam.length > 0 || customerNames.length > 0) evidenceSources.push("attendees");
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      max_completion_tokens: 500,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `MEETING DATA:\n${contextWindow}\n\n---\n\nUSER QUESTION: ${userQuestion}`,
        },
      ],
    });
    
    console.log(`[SemanticAnswer] LLM call: ${Date.now() - startTime}ms`);
    
    const rawAnswer = response.choices[0]?.message?.content || "I couldn't generate an answer.";
    const { answer, confidence } = parseConfidence(rawAnswer);
    
    console.log(`[SemanticAnswer] Complete | confidence=${confidence} | sources=${evidenceSources.join(",")}`);
    
    return {
      answer,
      confidence,
      evidenceSources,
    };
  } catch (error) {
    console.error(`[SemanticAnswer] LLM error:`, error);
    throw error;
  }
}
