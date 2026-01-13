/**
 * RAG composition layer.
 *
* Purpose:
 * This module uses an LLM to transform retrieved, factual data
 * into human-readable summaries with a neutral-but-direct stance.
 *
 * What this file IS:
 * - An interpretation layer over retrieved content
 * - Allowed to prioritize, surface risks, and recommend next steps
 * - Produces structured outputs suitable for storage and display
 *
 * What this file is NOT:
 * - NOT responsible for retrieval or querying
 * - NOT allowed to fetch additional data
 * - NOT allowed to route or select MCP capabilities
 *
 * Architectural rule:
 * - Input = retrieved data only
 * - Output = structured summaries only
 *
 * Canonical output from this file may be stored and reused later.
 *
 * Layer: RAG – Composition (LLM-only)
 */

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * Input shape coming from the retriever.
 * We stay aligned with how ingestion + retriever already work.
 */
export type TranscriptChunk = {
  chunkIndex: number;
  speakerRole: "leverege" | "customer" | "unknown";
  speakerName?: string | null;
  text: string;
};

/**
 * Canonical, storable artifact.
 */
export type MeetingSummary = {
  title: string;
  purpose: string; // Why the meeting happened (one sentence)
  focusAreas: string[]; // 2-5 recurring themes that dominated discussion
  keyTakeaways: string[];
  risksOrOpenQuestions: string[];
  recommendedNextSteps: string[];
};

export type SelectedQuote = {
  chunkIndex: number;
  speakerRole: "customer" | "leverege" | "unknown";
  quote: string;
  reason: string; // why this quote matters
};

export type QuoteSelectionResult = {
  quotes: SelectedQuote[];
  quoteNotice?: string; // Friendly disclosure when quotes are suppressed
};

/**
 * Result from extractive Q&A.
 */
export type ExtractiveAnswer = {
  answer: string;
  evidence?: string; // Supporting quote or reference from transcript
  wasFound: boolean; // True if answer was found in transcript
};

/**
 * Confidence gate for quote selection.
 * 
 * Epistemic safety: We only generate quotes when speaker attribution is reliable.
 * A chunk is considered "attributed" if speakerName is non-null OR speakerRole !== "unknown".
 * If < 70% of chunks are attributed, confidence is low and quotes are suppressed.
 */
function computeSpeakerAttributionConfidence(chunks: TranscriptChunk[]): {
  isHigh: boolean;
  ratio: number;
} {
  if (chunks.length === 0) {
    return { isHigh: false, ratio: 0 };
  }

  const attributedCount = chunks.filter(
    (c) => c.speakerName != null || c.speakerRole !== "unknown"
  ).length;

  const ratio = attributedCount / chunks.length;
  return { isHigh: ratio >= 0.7, ratio };
}

function formatTranscript(chunks: TranscriptChunk[]): string {
  return chunks
    .map(c => {
      const role =
        c.speakerRole === "customer"
          ? "Customer"
          : c.speakerRole === "leverege"
          ? "Leverege"
          : "Unknown";
      return `[${c.chunkIndex}] ${role}: ${c.text}`;
    })
    .join("\n");
}

/**
 * Compose a neutral-but-direct meeting summary.
 * Output is structured and suitable for storage.
 */
export async function composeMeetingSummary(
  chunks: TranscriptChunk[],
): Promise<MeetingSummary> {
  const transcript = formatTranscript(chunks);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You are an internal assistant summarizing a customer meeting.

Stance: neutral but direct.

Rules:
- Use ONLY the provided transcript.
- Do NOT invent product capabilities or facts.
- Do NOT infer emotions or intent unless explicitly stated.
- Prefer stating uncertainty over guessing.
- Be concise and factual.
        `.trim(),
      },
      {
        role: "user",
        content: `
Produce a structured meeting summary with:
- A short, factual title
- Purpose: one sentence explaining WHY this meeting happened (not what was discussed)
- Focus areas: 2-5 recurring themes that dominated the discussion (not one-off comments)
- Key takeaways (prioritized, non-redundant)
- Risks or open questions
- Recommended next steps grounded in the discussion

Return valid JSON only with this shape:
{
  "title": string,
  "purpose": string,
  "focusAreas": string[],
  "keyTakeaways": string[],
  "risksOrOpenQuestions": string[],
  "recommendedNextSteps": string[]
}

Transcript:
${transcript}
        `.trim(),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty meeting summary");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  return JSON.parse(jsonStr) as MeetingSummary;
}

/**
 * Select representative quotes useful for:
 * - follow-up emails
 * - sales context
 * - internal alignment
 * 
 * Includes confidence gate: quotes are only generated when speaker attribution is reliable.
 */
export async function selectRepresentativeQuotes(
  chunks: TranscriptChunk[],
  contentType: "transcript" | "notes",
  maxQuotes = 5,
): Promise<QuoteSelectionResult> {
  // Gate 1: Notes don't have reliable speaker attribution
  if (contentType !== "transcript") {
    return {
      quotes: [],
      quoteNotice: "I didn't include direct quotes because this was meeting notes rather than a transcript, which makes speaker attribution unreliable.",
    };
  }

  // Gate 2: Check speaker attribution confidence
  const confidence = computeSpeakerAttributionConfidence(chunks);
  if (!confidence.isHigh) {
    return {
      quotes: [],
      quoteNotice: "I didn't include direct quotes from this meeting because the transcript doesn't consistently label speakers, which makes quotes hard to interpret out of context.",
    };
  }

  // Gate 3: Filter to customer-only chunks for quote selection
  const customerChunks = chunks.filter((c) => c.speakerRole === "customer");
  if (customerChunks.length === 0) {
    return {
      quotes: [],
      quoteNotice: "I didn't include direct quotes because no customer statements were clearly attributed in this transcript.",
    };
  }

  // Confidence is high and we have customer chunks - proceed with LLM quote selection
  const transcript = formatTranscript(customerChunks);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You select representative quotes from customer speakers in a meeting.

Rules:
- Use ONLY the provided transcript (which contains only customer statements).
- Select quotes that capture customer priorities, concerns, pain points, or decisions.
- Do NOT rewrite quotes; use exact phrasing.
- Be neutral and factual.
        `.trim(),
      },
      {
        role: "user",
        content: `
Select up to ${maxQuotes} representative customer quotes.

Return valid JSON only as an array with this shape:
[
  {
    "chunkIndex": number,
    "speakerRole": "customer",
    "quote": string,
    "reason": string
  }
]

Transcript:
${transcript}
        `.trim(),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty quote selection");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  return { quotes: JSON.parse(jsonStr) as SelectedQuote[] };
}

/**
 * Extractive Q&A from a single meeting transcript.
 * 
 * This is NOT RAG - we answer from already-retrieved content.
 * Designed to match Google Meet's post-meeting Q&A quality.
 * 
 * Behavior:
 * - Answers only if supported by the transcript
 * - Returns "not mentioned" if answer is not clearly present
 * - Provides supporting evidence when found
 */
export async function answerMeetingQuestion(
  chunks: TranscriptChunk[],
  question: string,
): Promise<ExtractiveAnswer> {
  const transcript = formatTranscript(chunks);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You are answering specific questions about a meeting transcript.

STRICT RULES:
1. Only answer if the transcript EXPLICITLY supports the answer.
2. If the information was NOT mentioned, say: "This wasn't mentioned in the meeting."
3. Do NOT guess, infer, or extrapolate beyond what was said.
4. Prefer exact quantities, names, locations, and decisions when present.
5. Keep answers concise and factual (1-3 sentences).
6. If you find supporting evidence, include a brief quote or reference.

Return valid JSON only with this shape:
{
  "answer": string,
  "evidence": string | null,
  "wasFound": boolean
}

Set wasFound=true only if the answer is explicitly supported by the transcript.
Set wasFound=false and answer="This wasn't mentioned in the meeting." if not found.
        `.trim(),
      },
      {
        role: "user",
        content: `
Question: ${question}

Transcript:
${transcript}
        `.trim(),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty extractive answer");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const parsed = JSON.parse(jsonStr) as { answer: string; evidence?: string | null; wasFound: boolean };
  
  return {
    answer: parsed.answer,
    evidence: parsed.evidence ?? undefined,
    wasFound: parsed.wasFound,
  };
}
