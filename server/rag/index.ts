/**
 * RAG Main Entry Point
 * 
 * Purpose:
 * Provides the main answerQuestion function that retrieves transcript chunks
 * and formats responses for display. Handles speaker role formatting.
 * 
 * Layer: RAG (entry point)
 */

import { getLastMeetingChunks } from "./retriever";
import { storage } from "../storage";

/**
 * Format speaker role for display in Slack.
 * - leverege → [leverege]
 * - customer → [customer]
 * - unknown → [customer – <Company Name>]
 */
function formatSpeakerRole(
  role: string | null | undefined,
  companyName: string
): string {
  if (role === "leverege") return "[leverege]";
  if (role === "customer") return "[customer]";
  // unknown or null → show as customer with company name for context
  return `[customer – ${companyName}]`;
}

export async function answerQuestion(params: {
  question: string;
  companyId: string;
  mode?: "last_meeting" | "summary";
}) {
  const mode = params.mode ?? "last_meeting";

  if (mode === "last_meeting") {
    const chunks = await getLastMeetingChunks(params.companyId, 50);

    if (chunks.length === 0) {
      return {
        answer: "No transcript data found for the most recent meeting.",
        citations: [],
      };
    }

    // Look up company name for display (use "PitCrew" as default product)
    const company = await storage.getCompany("PitCrew", params.companyId);
    const companyName = company?.name ?? "Unknown Company";

    const lines = chunks.slice(0, 15).map((c) => {
      const roleDisplay = formatSpeakerRole(c.speaker_role, companyName);
      const speakerName = c.speaker_name ?? "Unknown";
      return `${roleDisplay} ${speakerName}: ${c.content}`;
    });

    return {
      answer:
        "Here are the first discussion turns from the most recent meeting:\n\n" +
        lines.join("\n"),
      citations: chunks.slice(0, 10).map((c) => ({
        transcriptId: c.transcript_id,
        chunkIndex: c.chunk_index,
      })),
    };
  }

  return {
    answer: "Mode not implemented yet.",
    citations: [],
  };
}
