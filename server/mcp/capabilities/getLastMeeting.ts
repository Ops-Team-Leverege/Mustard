import { z } from "zod";
import type { Capability } from "../types";
import { getLastMeetingChunks } from "../../rag/retriever";
import {
  composeMeetingSummary,
  selectRepresentativeQuotes,
  answerMeetingQuestion,
  extractMeetingActionStates,
  type TranscriptChunk as ComposerChunk,
  type QuoteSelectionResult,
  type MeetingActionItem,
} from "../../rag/composer";
import { storage } from "../../storage";

/**
 * Detect if the user explicitly requested quotes.
 * Quotes are opt-in: only shown when user asks for them.
 */
function detectQuoteIntent(question: string): boolean {
  const q = question.toLowerCase();
  const quotePatterns = [
    /\bquote/,
    /\bsaid\b/,
    /\bsay\b/,
    /\bwhat did .* say/,
    /\bwhat were .* words/,
    /\bexact words/,
    /\btheir words/,
    /\bcustomer feedback/,
    /\bnotable .* said/,
    /\bdirect .* statement/,
  ];
  return quotePatterns.some((p) => p.test(q));
}

/**
 * Detect if the question is a specific extractive question vs a summary request.
 * Specific questions route to extractive Q&A for grounded answers.
 */
function isSpecificQuestion(question: string): boolean {
  const q = question.toLowerCase();
  
  // Summary-style requests (return false = use summary)
  const summaryPatterns = [
    /\bsummar/,           // summary, summarize
    /\boverview/,
    /\bwhat was .* about/,
    /\bwhat happened/,
    /\bwhat did we discuss/,
    /\bkey takeaways/,
    /\bhighlights/,
    /\bbrief me/,
    /\bcatch me up/,
    /\blast meeting$/,    // just "last meeting" with no specific question
  ];
  
  if (summaryPatterns.some((p) => p.test(q))) {
    return false;
  }

  // Specific extractive questions (return true = use extractive Q&A)
  const specificPatterns = [
    /\bhow many/,
    /\bhow much/,
    /\bwhere did/,
    /\bwhere do/,
    /\bwhen did/,
    /\bwhen do/,
    /\bwhat .* did they/,
    /\bwhat .* do they/,
    /\bwhat metrics/,
    /\bwhat data/,
    /\bwhat system/,
    /\bwhat software/,
    /\bwhat pos/,
    /\bwhat timeline/,
    /\bwhat budget/,
    /\bwhat price/,
    /\bwhat cost/,
    /\bdid they mention/,
    /\bdid they say/,
    /\bany mention of/,
    /\bwhat about/,
    /\b\d+/,              // contains numbers (often specific)
    /\bpilot/,
    /\brollout/,
    /\bstores?/,
    /\blocations?/,
    /\bcameras?/,
    /\bsensors?/,
    /\bdevices?/,
  ];
  
  return specificPatterns.some((p) => p.test(q));
}

/**
 * Strip MCP scaffolding to extract the core user question.
 * MCP wraps questions with prefixes like "Plan:", "Tool instructions:", etc.
 */
function stripMcpScaffolding(question: string): string {
  // Remove common MCP prefixes/wrappers
  let cleaned = question
    .replace(/^plan:\s*/i, "")
    .replace(/^tool instructions?:\s*/i, "")
    .replace(/^context:\s*/i, "")
    .replace(/^query:\s*/i, "")
    .replace(/^user question:\s*/i, "")
    .replace(/^question:\s*/i, "");
  
  // Also try to find quoted user question if present
  const quotedMatch = cleaned.match(/"([^"]+)"/);
  if (quotedMatch) {
    cleaned = quotedMatch[1];
  }
  
  return cleaned.trim();
}

/**
 * Detect if the user is asking for action items / next steps / commitments.
 * 
 * First strips MCP scaffolding, then applies precise patterns with word boundaries
 * to avoid false positives on generic questions.
 */
function isCommitmentRequest(question: string): boolean {
  const stripped = stripMcpScaffolding(question);
  const q = stripped.toLowerCase();
  
  // Also check full question in case stripping missed something
  const fullQ = question.toLowerCase();
  
  const commitmentPatterns = [
    // Core patterns with word boundaries to avoid false positives
    /\bnext\s*steps?\b/,       // "next steps", "next step"
    /\baction\s*items?\b/,     // "action items", "action item"
    /\bto-?dos?\b/,            // "todos", "to-dos", "todo"
    /\bfollow[\s-]*ups?\b/,    // "follow ups", "follow-ups", "followups"
    /\bcommitments?\b/,        // "commitment", "commitments"
    /\baction\s*points?\b/,    // "action points"
    
    // Question patterns - commitment-specific
    /what did we agree/,
    /what was agreed/,
    /what were the agreements/,
    /who is doing what/,
    /who'?s responsible/,
    /what needs to happen/,
    /what'?s next\b/,          // word boundary to avoid "what's next door"
    /what do we need to do/,
    /agreed to do/,
    /supposed to do/,
    /who will\b/,              // "who will send..."
    /what will .* do/,         // "what will Corey do?"
  ];
  
  // Check both stripped and full question
  return commitmentPatterns.some((p) => p.test(q) || p.test(fullQ));
}

export const getLastMeeting: Capability = {
  name: "get_last_meeting",
  description:
    "Get information about the last/most recent meeting with a company. Use this when asked about what was discussed in the last meeting, recent meeting topics, or latest conversation with a company.",
  inputSchema: z.object({
    companyName: z.string().describe("The name of the company to get the last meeting for"),
    question: z.string().describe("The specific question about the meeting"),
  }),
  handler: async ({ db }, { companyName, question }) => {
    // Detect intent
    const wantsQuotes = detectQuoteIntent(question);
    const wantsSpecificAnswer = isSpecificQuestion(question);
    const wantsCommitments = isCommitmentRequest(question);

    // Debug logging for intent routing
    const strippedQ = stripMcpScaffolding(question);
    console.log(`[getLastMeeting] Raw question (${question.length} chars): "${question.substring(0, 200)}${question.length > 200 ? '...' : ''}"`);
    console.log(`[getLastMeeting] Stripped question: "${strippedQ.substring(0, 150)}"`);
    console.log(`[getLastMeeting] Intent: wantsCommitments=${wantsCommitments}, wantsSpecificAnswer=${wantsSpecificAnswer}, wantsQuotes=${wantsQuotes}`);

    // Step 1: Resolve company name with case-insensitive partial match
    const companyRows = await db.query(
      `SELECT id, name FROM companies WHERE name ILIKE $1`,
      [`%${companyName}%`]
    );

    if (!companyRows || companyRows.length === 0) {
      return {
        answer: `I couldn't find a company matching "${companyName}". Please check the spelling or try a different name.`,
        citations: [],
      };
    }

    if (companyRows.length > 1) {
      const names = companyRows.map((c: { name: string }) => c.name).join(", ");
      return {
        answer: `I found multiple companies matching "${companyName}": ${names}. Please be more specific about which company you mean.`,
        citations: [],
      };
    }

    const companyId = companyRows[0].id;
    const resolvedName = companyRows[0].name;

    // Step 2: Retrieve last meeting transcript chunks (deterministic)
    // For action items/commitments, we need ALL chunks because next steps
    // are typically discussed at the end of meetings (not in first 50 chunks!)
    // Longest transcript seen: ~500 chunks. Using 5000 for future-proofing.
    const chunkLimit = wantsCommitments ? 5000 : 50;
    const result = await getLastMeetingChunks(companyId, chunkLimit);

    if (!result || result.chunks.length === 0) {
      return {
        answer: `I couldn't find any meeting transcripts for ${resolvedName}.`,
        citations: [],
      };
    }

    const { chunks: rawChunks, transcriptId, transcriptCreatedAt, contentType, attendees } = result;

    // Map retriever's snake_case to composer's camelCase format
    const composerChunks: ComposerChunk[] = rawChunks.map((c) => ({
      chunkIndex: c.chunk_index,
      speakerRole: c.speaker_role,
      speakerName: c.speaker_name,
      text: c.content,
    }));

    // ─────────────────────────────────────────────────────────────────
    // ROUTE: Commitment request → Action items / Next steps
    // ─────────────────────────────────────────────────────────────────
    if (wantsCommitments) {
      // Pass attendee names for speaker normalization
      const { primary, secondary } = await extractMeetingActionStates(composerChunks, {
        leverageTeam: attendees.leverageTeam ?? undefined,
        customerNames: attendees.customerNames ?? undefined,
      });

      const lines: string[] = [];
      lines.push(`*[${resolvedName}] Next Steps*`);
      lines.push(`_Meeting: ${new Date(transcriptCreatedAt).toLocaleDateString()}_`);

      // Helper to format a single action item
      const formatActionItem = (a: MeetingActionItem): string[] => {
        const formatted: string[] = [];
        let item = `• ${a.action} — ${a.owner}`;
        if (a.deadline && a.deadline !== "Not specified") {
          item += ` _(${a.deadline})_`;
        }
        formatted.push(item);
        formatted.push(`  _"${a.evidence}"_`);
        return formatted;
      };

      if (primary.length === 0 && secondary.length === 0) {
        lines.push("\nNo explicit action items were identified in this meeting.");
      } else {
        // Primary actions (high confidence ≥0.85)
        if (primary.length > 0) {
          lines.push("");
          primary.forEach((a) => {
            lines.push(...formatActionItem(a));
          });
        }

        // Secondary actions (confidence 0.70-0.85)
        if (secondary.length > 0) {
          lines.push("\n*Follow-Ups to Track*");
          secondary.forEach((a) => {
            lines.push(...formatActionItem(a));
          });
        }
      }

      return {
        answer: lines.join("\n"),
        citations: [],
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // ROUTE: Specific question → Extractive Q&A
    // ─────────────────────────────────────────────────────────────────
    if (wantsSpecificAnswer) {
      const extractive = await answerMeetingQuestion(composerChunks, question);

      const lines: string[] = [];
      lines.push(`*[${resolvedName}]*`);
      lines.push(`_Meeting: ${new Date(transcriptCreatedAt).toLocaleDateString()}_`);
      lines.push("");
      lines.push(extractive.answer);

      if (extractive.wasFound && extractive.evidence) {
        lines.push(`\n_"${extractive.evidence}"_`);
      }

      return {
        answer: lines.join("\n"),
        citations: [],
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // ROUTE: Summary request → Full meeting summary
    // ─────────────────────────────────────────────────────────────────
    const summary = await composeMeetingSummary(composerChunks);

    // Quotes are opt-in: only fetch if user explicitly requested them
    let quoteResult: QuoteSelectionResult = { quotes: [] };
    if (wantsQuotes) {
      quoteResult = await selectRepresentativeQuotes(composerChunks, contentType);
    }

    // Persist the artifact for later reuse
    await storage.saveMeetingSummary({
      companyId,
      transcriptId,
      meetingTimestamp: transcriptCreatedAt,
      artifact: { summary, quotes: quoteResult.quotes },
    });

    // Render response
    const lines: string[] = [];

    lines.push(`*[${resolvedName}] ${summary.title}*`);
    lines.push(`_${new Date(transcriptCreatedAt).toLocaleDateString()}_`);

    if (summary.purpose) {
      lines.push("\n*Purpose*");
      lines.push(`• ${summary.purpose}`);
    }

    if (summary.focusAreas?.length) {
      lines.push("\n*Focus Areas*");
      summary.focusAreas.forEach((f) => lines.push(`• ${f}`));
    }

    if (summary.keyTakeaways.length) {
      lines.push("\n*Key Takeaways*");
      summary.keyTakeaways.forEach((t) => lines.push(`• ${t}`));
    }

    if (summary.risksOrOpenQuestions.length) {
      lines.push("\n*Risks / Open Questions*");
      summary.risksOrOpenQuestions.forEach((r) => lines.push(`• ${r}`));
    }

    if (summary.recommendedNextSteps.length) {
      lines.push("\n*Recommended Next Steps*");
      summary.recommendedNextSteps.forEach((n) => lines.push(`• ${n}`));
    }

    // Only show quotes section if user explicitly requested them
    if (wantsQuotes) {
      if (quoteResult.quotes.length) {
        lines.push("\n*Representative Quotes*");
        quoteResult.quotes.forEach((q) => {
          lines.push(`• "${q.quote}" — customer`);
        });
      } else if (quoteResult.quoteNotice) {
        lines.push(`\n_${quoteResult.quoteNotice}_`);
      }
    }

    return {
      answer: lines.join("\n"),
      citations: [],
    };
  },
};
