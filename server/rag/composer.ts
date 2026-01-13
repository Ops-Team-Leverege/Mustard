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
 */
export async function selectRepresentativeQuotes(
  chunks: TranscriptChunk[],
  maxQuotes = 5,
): Promise<SelectedQuote[]> {
  const transcript = formatTranscript(chunks);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You select representative quotes from a customer meeting.

Rules:
- Use ONLY the provided transcript.
- Prefer customer quotes when possible.
- Select quotes that capture priorities, concerns, or decisions.
- Do NOT rewrite quotes; use exact phrasing.
- Be neutral and factual.
        `.trim(),
      },
      {
        role: "user",
        content: `
Select up to ${maxQuotes} representative quotes.

Return valid JSON only as an array with this shape:
[
  {
    "chunkIndex": number,
    "speakerRole": "customer" | "leverege" | "unknown",
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
  return JSON.parse(jsonStr) as SelectedQuote[];
}
