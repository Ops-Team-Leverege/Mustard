import { z } from "zod";
import type { Capability, CapabilityResult } from "../types";
import { storage } from "../../storage";

type AttendeeResult = {
  answer: string;
  citations: unknown[];
};

/**
 * getMeetingAttendees capability
 * 
 * Returns the list of attendees for a meeting. This is a data retrieval
 * capability, not a summary variant - attendee questions are a first-class intent.
 * 
 * Input priority:
 * 1. meetingId (preferred) - direct lookup
 * 2. companyId (fallback) - finds latest meeting for company
 * 3. companyName (last resort) - resolves company, then finds meeting
 */
export const getMeetingAttendees: Capability = {
  name: "get_meeting_attendees",
  description:
    "Get the list of attendees/participants for a meeting. Use this when asked who attended, who was in the meeting, or about participants.",
  inputSchema: z.object({
    companyName: z.string().optional().describe("The name of the company (used to find their most recent meeting)"),
    companyId: z.string().optional().describe("Pre-resolved company ID from thread context"),
    meetingId: z.string().optional().describe("Pre-resolved meeting/transcript ID from thread context"),
  }),
  handler: async ({ db }, { companyName, companyId: providedCompanyId, meetingId: providedMeetingId }): Promise<CapabilityResult<AttendeeResult>> => {
    console.log(`[getMeetingAttendees] Input: companyName=${companyName}, companyId=${providedCompanyId}, meetingId=${providedMeetingId}`);

    let companyId: string | undefined = providedCompanyId;
    let meetingId: string | undefined = providedMeetingId;
    let resolvedName: string = "Unknown Company";

    // Step 1: Resolve company if needed
    if (!companyId && !meetingId) {
      if (!companyName) {
        return {
          result: {
            answer: `Could you please provide the name of the company you're asking about?`,
            citations: [],
          },
        };
      }

      // Resolve company name
      const companyRows = await db.query(
        `SELECT id, name FROM companies WHERE name ILIKE $1`,
        [`%${companyName}%`]
      );

      if (!companyRows || companyRows.length === 0) {
        return {
          result: {
            answer: `I couldn't find a company matching "${companyName}". Please check the spelling or try a different name.`,
            citations: [],
          },
        };
      }

      if (companyRows.length > 1) {
        const names = companyRows.map((c: { name: string }) => c.name).join(", ");
        return {
          result: {
            answer: `I found multiple companies matching "${companyName}": ${names}. Please be more specific about which company you mean.`,
            citations: [],
          },
        };
      }

      companyId = companyRows[0].id;
      resolvedName = companyRows[0].name;
    } else if (companyId) {
      // Look up company name for display
      const companyRow = await db.query(
        `SELECT name FROM companies WHERE id = $1`,
        [companyId]
      );
      resolvedName = companyRow?.[0]?.name || "Unknown Company";
    }

    // Step 2: Get meeting/transcript info
    let transcriptData: { id: string; createdAt: Date; leverageTeam: string | null; customerNames: string | null } | null = null;

    if (meetingId) {
      // Direct lookup by meeting ID - query the transcript directly
      const transcriptRows = await db.query(
        `SELECT id, created_at, leverage_team, customer_names, company_id FROM transcripts WHERE id = $1`,
        [meetingId]
      );
      if (transcriptRows && transcriptRows.length > 0) {
        const row = transcriptRows[0];
        transcriptData = {
          id: row.id,
          createdAt: new Date(row.created_at),
          leverageTeam: row.leverage_team,
          customerNames: row.customer_names,
        };
        // Also get company name for display if not already resolved
        if (resolvedName === "Unknown Company" && row.company_id) {
          const companyRow = await db.query(
            `SELECT name FROM companies WHERE id = $1`,
            [row.company_id]
          );
          resolvedName = companyRow?.[0]?.name || "Unknown Company";
          companyId = row.company_id;
        }
      }
    } else if (companyId) {
      // Find latest meeting for company using storage helper
      const transcriptInfo = await storage.getLastTranscriptIdForCompany(companyId);
      if (transcriptInfo) {
        transcriptData = {
          id: transcriptInfo.id,
          createdAt: transcriptInfo.createdAt,
          leverageTeam: (transcriptInfo as { leverageTeam?: string | null }).leverageTeam ?? null,
          customerNames: (transcriptInfo as { customerNames?: string | null }).customerNames ?? null,
        };
        meetingId = transcriptInfo.id;
      }
    }

    if (!transcriptData) {
      return {
        result: {
          answer: `I couldn't find any meeting transcripts for ${resolvedName}.`,
          citations: [],
        },
        resolvedEntities: companyId ? { companyId } : undefined,
      };
    }

    // Step 3: Format attendee list
    const lines: string[] = [];
    lines.push(`*[${resolvedName}] Meeting Attendees*`);
    lines.push(`_Meeting: ${new Date(transcriptData.createdAt).toLocaleDateString()}_`);
    lines.push("");

    // Parse attendees (stored as pipe-delimited strings)
    const leverageTeamList = transcriptData.leverageTeam?.split("|").filter(Boolean) || [];
    const customerNamesList = transcriptData.customerNames?.split("|").filter(Boolean) || [];

    // Leverege team attendees
    if (leverageTeamList.length > 0) {
      lines.push("*Leverege Team*");
      leverageTeamList.forEach((name) => lines.push(`• ${name.trim()}`));
    }

    // Customer attendees
    if (customerNamesList.length > 0) {
      lines.push("");
      lines.push(`*${resolvedName} Team*`);
      customerNamesList.forEach((name) => lines.push(`• ${name.trim()}`));
    }

    // Handle case where we don't have attendee info
    if (leverageTeamList.length === 0 && customerNamesList.length === 0) {
      lines.push("_Attendee information was not recorded for this meeting._");
    }

    return {
      result: {
        answer: lines.join("\n"),
        citations: [],
      },
      resolvedEntities: { 
        companyId: companyId!, 
        meetingId: transcriptData.id 
      },
    };
  },
};
